import { lineFlags, parsePrintedSavings, smallGapCents, suggestCorrections, totalGapCents } from '@yazdan-learning/ai';
import { LlmClient } from '../ai/gateway/llm';
import { LocateTarget } from '../ai/prompts/field-boxes';
import { num, westernDigits } from '../ai/replies';
import { getCalendar } from '../countries/calendars';
import { getCountryProfile } from '../countries/registry';
import { FileStorage } from '../expenses/ports';
import { Actor } from '../expenses/expenses.service';
import { BadRequestError, NotFoundError } from '../shared/errors';
import { isPickableField, itemField, PICKABLE_FIELDS } from './fields';
import { documentPages, PageImage, Region } from './page-images';
import { readingRepository as prismaReadingRepository, ReadingRepository } from './reading.repository';
import { showsFieldBoxes } from './registry';
import { locateFields, readRegionValue } from './vision-fields';

// The field boxes on the review page (where each value was read) and "pick
// from photo" (the user draws a box, the value is read from that region).
// Only for organizations on the template-guided reader; the stable reading
// path is never touched. Boxes are located the first time the review page
// asks for them, not during the upload, so uploads stay as fast as before
// and older invoices get boxes too.

type Amount = { toString(): string } | null;

/** What this needs of an expense; expensesService.getById returns it (and checks the actor may see it). */
export type ReadableExpense = {
  id: string;
  status: string;
  filePath: string | null;
  mimeType: string | null;
  rawExtraction: unknown;
  boxesLocatedAt: Date | null;
  currency: string | null;
  originalCurrency: string | null;
  exchangeRate: Amount;
  items: { description: string; totalPrice: Amount; quantity?: Amount; unitPrice?: Amount }[];
} & Record<string, unknown>;

type Deps = {
  expenses: { getById(organizationId: string, id: string, actor: Actor): Promise<ReadableExpense> };
  fileStorage: FileStorage;
  /** The vision model; built per call so a missing key fails the request, not the boot. */
  vision: () => LlmClient;
  repository?: ReadingRepository;
};

/** What the shared checks say about each line item, for the review page (template-guided reader only). */
export type ReadingChecksResponse = {
  enabled: boolean;
  lines: {
    index: number;
    /** quantity × unit price disagrees with the line's total. */
    quantityTimesPrice?: { quantity: number; unitPrice: number; expected: number };
    /** A one-digit misread that makes the lines add up to the total (0,65 → 0,85). */
    suggested?: number;
    level?: 'confirmed' | 'likely';
    /** The gap may be on this line: compare it with the document. */
    compare?: boolean;
  }[];
  /** The photo is very small, so digits may be misread. */
  smallImage: boolean;
};

const amount = (value: Amount | undefined): number | null => (value === null || value === undefined ? null : Number(value.toString()));

export type FieldBoxesResponse = {
  enabled: boolean;
  pages: { index: number; width: number; height: number }[];
  boxes: { field: string; source: 'MODEL' | 'USER'; page: number; x: number; y: number; width: number; height: number; value: string | null }[];
  /** Set when locating the fields failed; asked again next time. */
  error?: string;
};

/** Statuses in which the review page lets the fields be edited. */
const EDITABLE = ['EXTRACTED', 'FAILED', 'REJECTED'];

/** The pages of the last few documents: the review page asks for each page image right after the boxes. */
const PAGE_CACHE_SIZE = 10;

/** The reading's own JSON (in the units printed on the invoice), when the extractor stored one. */
function readingData(expense: ReadableExpense): Record<string, unknown> {
  const raw = expense.rawExtraction as { data?: unknown } | null;
  return raw?.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : {};
}

/**
 * A total read without some of its trailing zeros (handwritten "۱۶۹٬۲۰۰—", the
 * dash standing for 000) is the sum of the line items when adding zeros makes
 * it exactly that; anything else is left as read. In stored units.
 */
export function withZerosFromLines(field: string, amount: number, expense: ReadableExpense): number {
  if (field !== 'totalAmount' && field !== 'subtotal') return amount;
  const lines = expense.items.map((item) => (item.totalPrice === null ? null : Number(item.totalPrice)));
  if (!lines.length || lines.some((v) => v === null)) return amount;
  const sum = lines.reduce((s, v) => s! + v!, 0)!;
  return [10, 100, 1000].some((k) => amount * k === sum) ? sum : amount;
}

const isHandwritten = (expense: ReadableExpense) => (expense.rawExtraction as { mode?: unknown } | null)?.mode === 'handwritten';

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text ? text : null;
};

/** What to look for: each field's value as read (printed units, the date as printed), else as saved. */
export function locateTargets(expense: ReadableExpense): { fields: LocateTarget[]; items: LocateTarget[] } {
  const data = readingData(expense);
  const fields = Object.entries(PICKABLE_FIELDS).flatMap(([field, { label, readingKey }]) => {
    const value = asText(data[readingKey]) ?? asText(expense[field]);
    return value ? [{ field, label, value }] : [];
  });
  const readItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const items = expense.items.map((item, index) => {
    const total = asText(readItems[index]?.totalPrice) ?? asText(item.totalPrice);
    return { field: itemField(index), label: 'line item', value: total ? `${item.description} … ${total}` : item.description };
  });
  return { fields, items };
}

export function createReadingService({ expenses, fileStorage, vision, repository = prismaReadingRepository }: Deps) {
  const pageCache = new Map<string, Promise<PageImage[]>>();
  const locating = new Map<string, Promise<void>>();

  function pagesOf(expense: ReadableExpense): Promise<PageImage[]> {
    const { filePath, mimeType } = expense;
    if (!filePath || !mimeType) return Promise.resolve([]);
    let pages = pageCache.get(filePath);
    if (!pages) {
      pages = fileStorage.read(filePath).then((buffer) => documentPages(buffer, mimeType));
      pages.catch(() => pageCache.delete(filePath));
      pageCache.set(filePath, pages);
      if (pageCache.size > PAGE_CACHE_SIZE) pageCache.delete(pageCache.keys().next().value!);
    }
    return pages;
  }

  /** Once per expense, also when the review page asks twice at the same moment. */
  function locateOnce(expense: ReadableExpense, pages: PageImage[]): Promise<void> {
    let running = locating.get(expense.id);
    if (!running) {
      const { fields, items } = locateTargets(expense);
      running = locateFields(vision(), pages, fields, items)
        .then((boxes) => repository.saveModelBoxes(expense.id, boxes))
        .finally(() => locating.delete(expense.id));
      locating.set(expense.id, running);
    }
    return running;
  }

  async function enabledFor(organizationId: string) {
    const settings = await repository.getReadingSettings(organizationId);
    return { enabled: showsFieldBoxes(settings.invoiceReader), country: getCountryProfile(settings.country) };
  }

  return {
    async getFieldBoxes(organizationId: string, id: string, actor: Actor): Promise<FieldBoxesResponse> {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled } = await enabledFor(organizationId);
      if (!enabled) return { enabled: false, pages: [], boxes: [] };

      const pages = await pagesOf(expense);
      let error: string | undefined;
      if (pages.length && !expense.boxesLocatedAt) {
        await locateOnce(expense, pages).catch((err: Error) => {
          error = err.message || 'Could not locate the fields on the document';
        });
      }
      return {
        enabled: true,
        pages: pages.map(({ width, height }, index) => ({ index, width, height })),
        boxes: await repository.listBoxes(id),
        ...(error ? { error } : {})
      };
    },

    /**
     * The checks on the line items as they are now (after the user's edits):
     * quantity × unit price per line, and — when the lines are a little off the
     * total — the likely misread digit. Line items are never converted, so
     * they are compared with the total before the exchange rate.
     */
    async getReadingChecks(organizationId: string, id: string, actor: Actor): Promise<ReadingChecksResponse> {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled } = await enabledFor(organizationId);
      if (!enabled) return { enabled: false, lines: [], smallImage: false };
      const raw = expense.rawExtraction as { ocrText?: unknown; template?: { smallImage?: unknown } } | null;
      const reading = {
        totalAmount: amount((expense.originalTotalAmount ?? expense.totalAmount) as Amount),
        items: expense.items.map((item) => ({
          description: item.description,
          quantity: amount(item.quantity),
          unitPrice: amount(item.unitPrice),
          totalPrice: amount(item.totalPrice)
        }))
      };
      const lines = new Map<number, ReadingChecksResponse['lines'][number]>();
      const at = (index: number) => lines.get(index) ?? (lines.set(index, { index }), lines.get(index)!);
      for (const f of lineFlags(reading)) {
        at(f.line).quantityTimesPrice = { quantity: f.quantity, unitPrice: f.unitPriceCents / 100, expected: f.expectedCents / 100 };
      }
      // Digit suggestions only for a small gap: a big one is lines shifted or missed, or net prices.
      const gap = totalGapCents(reading);
      if (gap !== null && smallGapCents({ problems: [{ code: 'total_mismatch', message: '', detail: { diffCents: gap, totalCents: Math.round((reading.totalAmount ?? 0) * 100) } }] }) !== null) {
        const ocrText = typeof raw?.ocrText === 'string' ? raw.ocrText : undefined;
        const { suggestions, checkLines } = suggestCorrections(reading, { printedSavingsCents: parsePrintedSavings(ocrText) });
        for (const s of suggestions) Object.assign(at(s.line), { suggested: s.toCents / 100, level: s.level });
        for (const index of checkLines) at(index).compare = true;
      }
      return { enabled: true, lines: [...lines.values()].sort((a, b) => a.index - b.index), smallImage: raw?.template?.smallImage === true };
    },

    async getPageImage(organizationId: string, id: string, page: number, actor: Actor): Promise<Buffer> {
      const expense = await expenses.getById(organizationId, id, actor);
      const image = (await pagesOf(expense))[page];
      if (!image) throw new NotFoundError('This document has no such page');
      return image.buffer;
    },

    /**
     * The value of one field, read from the region the user drew, in the form's
     * units: amounts in the stored unit (Toman as Rial) and, when the invoice was
     * converted, in the converted currency; dates as YYYY-MM-DD. The region is
     * kept as the field's USER box.
     */
    async readRegion(organizationId: string, id: string, actor: Actor, input: { field: string; page: number; region: Region }) {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled, country } = await enabledFor(organizationId);
      if (!enabled) throw new BadRequestError('Picking from the photo is not enabled for your organization');
      if (!isPickableField(input.field)) throw new BadRequestError(`"${input.field}" cannot be picked from the photo`);
      if (!EDITABLE.includes(expense.status)) throw new BadRequestError('This document can no longer be edited');
      const image = (await pagesOf(expense))[input.page];
      if (!image) throw new BadRequestError('This document has no such page');

      const { kind, label } = PICKABLE_FIELDS[input.field];
      const calendar = getCalendar(country.calendar);
      const today = calendar.today();
      // The same handwriting rules the reading itself used (digit shapes, zeros, the total in words).
      const handwriting = isHandwritten(expense) ? country.invoice.handwriting?.promptRules(today) : undefined;
      const read = await readRegionValue(vision(), image, input.region, kind, label, { today, handwriting });

      let value: string | number | null = read;
      if (read !== null && kind === 'date') {
        value = calendar.toIsoDate(westernDigits(read));
      } else if (read !== null && kind === 'amount') {
        const amount = num(read);
        // The reading's unit (e.g. Toman, read as "IRT") is what the invoice prints; the form shows the stored unit.
        const printed = String(readingData(expense).currency ?? '').toUpperCase();
        const unit = country.invoice.currencyUnits.find((u) => u.code === printed || u.aliases.includes(printed));
        const converted = expense.originalCurrency && expense.exchangeRate && expense.currency !== expense.originalCurrency;
        // The line items are never converted: they are compared before the exchange rate.
        const stored = amount === null ? null : withZerosFromLines(input.field, amount * (unit?.factor ?? 1), expense);
        value = stored === null ? null : Math.round(stored * (converted ? Number(expense.exchangeRate) : 1) * 100) / 100;
      }

      const box = { field: input.field, page: input.page, ...input.region };
      await repository.saveUserBox(expense.id, box, read);
      return { field: input.field, value, read, box: { ...box, source: 'USER' as const, value: read } };
    }
  };
}

export type ReadingService = ReturnType<typeof createReadingService>;
