import {
  enlargeSmallImage,
  lineFlags,
  parsePrintedSavings,
  smallGapCents,
  suggestCorrections,
  totalGapCents,
  type OcrPage,
  type OcrWord,
  type PdfRenderer,
  type PositionedOcrClient
} from '@yazdan-learning/ai';
import { LlmClient } from '../ai/gateway/llm';
import { LocateTarget } from '../ai/prompts/field-boxes';
import { num, westernDigits } from '../ai/replies';
import { getCalendar } from '../countries/calendars';
import { getCountryProfile } from '../countries/registry';
import { FileStorage } from '../expenses/ports';
import { Actor } from '../expenses/expenses.service';
import { BadRequestError, NotFoundError } from '../shared/errors';
import { isPickableField, itemField, PICKABLE_FIELDS } from './fields';
import { printedAmount, printedDate, regionText, wordsInRegion } from './box-text';
import { cropForOcr, documentPages, PageImage, Region } from './page-images';
import { readingRepository as prismaReadingRepository, ReadingRepository } from './reading.repository';
import { bestTemplate, fitsPages, layoutFromBoxes, placeFromTemplate, StoredTemplate, taxIdKey, vendorKey } from './templates';
import { templatesRepository as prismaTemplatesRepository, TemplatesRepository } from './templates.repository';
import { showsFieldBoxes } from './registry';
import { LocatedBox, locateFields, readRegionValue } from './vision-fields';
import { locateFromWords, WordTargets } from './word-boxes';

// The field boxes on the review page (where each value was read) and "pick
// from photo" (the user draws a box, the value is read from that region).
// Only for organizations on the template-guided reader; the stable reading
// path is never touched. Boxes are located the first time the review page
// asks for them, not during the upload, so uploads stay as fast as before
// and older invoices get boxes too. Word positions (free, no model) place the
// boxes; only when they place less than half (Persian scans, handwriting) does
// one vision-model call place the rest. The user moves, draws or removes any box.
// A drawn box is read from the words inside it (free); the vision model reads a
// box only when the user asks ("Read with AI").

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
  /** OCR with word positions (the Tesseract service) for the boxes; null or absent: the vision model locates everything. */
  words?: () => PositionedOcrClient | null;
  /** Draws a PDF made from text as page images (the Tesseract service); null or absent: such a PDF has no viewer. */
  renderer?: () => PdfRenderer | null;
  repository?: ReadingRepository;
  templates?: TemplatesRepository;
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
  boxes: { field: string; source: 'MODEL' | 'USER' | 'TEMPLATE'; page: number; x: number; y: number; width: number; height: number; value: string | null }[];
  /** The invoice template whose boxes were used: the vendor's, from this organization or shared by another one. */
  template?: { vendorName: string | null; shared: boolean; timesSent: number };
  /**
   * What each template box of a form field holds, read from the words inside it
   * when the boxes were placed: the value in the form's units (null when nothing
   * printed could be read there). The review page compares it with the field.
   */
  templateValues?: { field: string; value: string | number | null; text: string | null }[];
  /** Fields with a value but no box: the user can draw one. */
  missing: string[];
  /** Set when locating the fields failed; asked again next time. */
  error?: string;
  /** A scanned PDF below LOW_SCAN_DPI: its dpi, for a "rescan sharper" note. */
  lowResolutionDpi?: number;
};

/** Below this a scan's small print is hard to read, for the user and the OCR. */
export const LOW_SCAN_DPI = 150;

/** Statuses in which the review page lets the fields be edited. */
const EDITABLE = ['EXTRACTED', 'FAILED', 'REJECTED'];

/** The pages of the last few documents: the review page asks for each page image right after the boxes. */
const PAGE_CACHE_SIZE = 10;
/** A template box's words are trusted (compared with the reading) at this average OCR confidence or more; a text PDF's are 1. */
const SURE_WORDS = 0.8;

/** Word positions that place at least this share of the values are enough; below it the vision model places the rest. */
const WORDS_ENOUGH = 0.5;

/** The page words of the last few documents, for "read from box" right after opening. */
const WORD_CACHE_SIZE = 20;

/** Why a box gave no value: handwriting (word OCR can't read it), nothing printed in it, or no word OCR configured. */
export type BoxReadReason = 'handwritten' | 'empty' | 'unavailable';

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

/** A receipt the template reader found to be foreign (no Persian text in an Iranian organization): its words are Latin. */
const foreignReceipt = (expense: ReadableExpense, country: { id: string }) =>
  country.id === 'IR' && (expense.rawExtraction as { template?: { foreignReceipt?: unknown } } | null)?.template?.foreignReceipt === true;

/** The OCR languages for an expense: the country's, or the international ones for a foreign receipt. */
const languagesFor = (expense: ReadableExpense, country: ReturnType<typeof getCountryProfile>) =>
  foreignReceipt(expense, country) ? getCountryProfile('INTL').ocrLanguages : country.ocrLanguages;

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

/** The same values as locateTargets, kept apart (kind; a line's description and amount) for matching words. */
export function wordTargets(expense: ReadableExpense): WordTargets {
  const { fields } = locateTargets(expense);
  const readItems = Array.isArray(readingData(expense).items) ? (readingData(expense).items as Record<string, unknown>[]) : [];
  return {
    fields: fields.map((t) => ({ ...t, kind: PICKABLE_FIELDS[t.field].kind })),
    items: expense.items.map((item, index) => ({
      field: itemField(index),
      description: item.description,
      total: asText(readItems[index]?.totalPrice) ?? asText(item.totalPrice)
    }))
  };
}

/** What learning from a sent invoice did: its vendor's template created or updated (null: nothing to learn). */
export type TemplateLearned = { vendorName: string | null; created: boolean } | null;

/** The keys an invoice's template is found by: the vendor's tax ID and name. */
const templateKeys = (expense: ReadableExpense) => ({ taxId: taxIdKey(expense.vendorTaxId), key: vendorKey(expense.vendorName) });
const aspectsOf = (pages: PageImage[]) => pages.map((p) => p.height / p.width);

export function createReadingService({
  expenses,
  fileStorage,
  vision,
  words,
  renderer,
  repository = prismaReadingRepository,
  templates = prismaTemplatesRepository
}: Deps) {
  const pageCache = new Map<string, Promise<PageImage[]>>();
  const locating = new Map<string, Promise<string | null>>();
  const wordCache = new Map<string, OcrPage[]>();

  function rememberWords(expense: ReadableExpense, read: OcrPage[]) {
    wordCache.delete(expense.id);
    wordCache.set(expense.id, read);
    if (wordCache.size > WORD_CACHE_SIZE) wordCache.delete(wordCache.keys().next().value!);
  }

  function pagesOf(expense: ReadableExpense): Promise<PageImage[]> {
    const { filePath, mimeType } = expense;
    if (!filePath || !mimeType) return Promise.resolve([]);
    let pages = pageCache.get(filePath);
    if (!pages) {
      pages = fileStorage.read(filePath).then((buffer) => documentPages(buffer, mimeType, renderer?.()));
      pages.catch(() => pageCache.delete(filePath));
      pageCache.set(filePath, pages);
      if (pageCache.size > PAGE_CACHE_SIZE) pageCache.delete(pageCache.keys().next().value!);
    }
    return pages;
  }

  /** Each page image's words with their boxes; null when there's no word OCR or it failed (the vision model then does it all). */
  async function pageWords(expense: ReadableExpense, pages: PageImage[], languages: string): Promise<OcrPage[] | null> {
    const ocr = words?.();
    if (!ocr) return null;
    try {
      // A PDF made from text: its own words, exact, in the same page fractions as the drawn pages.
      if (pages.length && pages.every((p) => p.rendered) && expense.filePath) {
        const pdf = await fileStorage.read(expense.filePath);
        return (await ocr.readWords({ buffer: pdf, filename: 'document.pdf', contentType: 'application/pdf' }, { languages })).pages.slice(0, pages.length);
      }
      const read: OcrPage[] = [];
      for (const [index, page] of pages.entries()) {
        // The page image itself (not the original file), so the boxes fit what the review page shows; small ones enlarged (boxes are fractions).
        const file = await enlargeSmallImage({ buffer: page.buffer, filename: `page-${index}.jpg`, contentType: 'image/jpeg' });
        const [first] = (await ocr.readWords(file, { languages })).pages;
        read.push(first ?? { index, width: page.width, height: page.height, source: 'ocr', text: '', words: [] });
      }
      return read;
    } catch (err) {
      console.warn(`field boxes: word OCR failed, using the vision model: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The vendor's template (step 1: found by the vendor's tax ID or name as read):
   * this organization's own first, else one another organization shares; only
   * when the document's pages have the template's shape.
   */
  async function matchTemplate(organizationId: string, expense: ReadableExpense, pages: PageImage[]): Promise<StoredTemplate | null> {
    const keys = templateKeys(expense);
    const candidates = (await templates.findCandidates(organizationId, keys)).filter((t) => fitsPages(t, aspectsOf(pages)));
    return bestTemplate(candidates, organizationId, keys);
  }

  /**
   * Boxes from the OCR's word positions first (exact; no model, about a second
   * a page), then the vendor's template for what the words didn't place. When
   * together they place less than half of the values — Persian scans and
   * tables, handwriting (word OCR can't read it), blurry photos, a vendor
   * without a template — one vision model call places the rest (rougher; the
   * user moves them). When it fails, the boxes found so far are kept.
   */
  async function locateBoxes(organizationId: string, expense: ReadableExpense, pages: PageImage[], languages: string) {
    const template = await matchTemplate(organizationId, expense, pages).catch((err: Error) => {
      console.warn(`field boxes: template lookup failed: ${err.message}`);
      return null;
    });
    const read = isHandwritten(expense) ? null : await pageWords(expense, pages, languages);
    if (read) rememberWords(expense, read);
    const fromWords = read ? locateFromWords(read, wordTargets(expense)) : [];
    const { fields, items } = locateTargets(expense);
    const total = fields.length + items.length;
    const placed = new Set(fromWords.map((b) => b.field));
    // Every field the template knows, also the ones the reading left empty: it says where that value is on this form.
    const templateFields = template ? [...new Set([...fields.map((t) => t.field), ...Object.keys(template.fields).filter(isPickableField)])] : [];
    const fromTemplate = template ? placeFromTemplate(template, { fields: templateFields, items: items.length }, placed) : [];
    for (const b of fromTemplate) placed.add(b.field);
    const targetsPlaced = [...fields, ...items].filter((t) => placed.has(t.field)).length;
    let fromVision: LocatedBox[] = [];
    const needsVision = total > 0 && targetsPlaced < total * WORDS_ENOUGH;
    if (needsVision) {
      try {
        fromVision = await locateFields(vision(), pages, fields.filter((t) => !placed.has(t.field)), items.filter((t) => !placed.has(t.field)));
      } catch (err) {
        if (!placed.size) throw err;
        console.warn(`field boxes: vision model failed, keeping ${placed.size} boxes: ${(err as Error).message}`);
      }
    }
    console.log(
      `field boxes ${expense.id}: ${fromWords.length} of ${total} from words` +
        (template ? `, ${fromTemplate.length} from the template (${template.vendorName ?? template.id}${template.organizationId === organizationId ? '' : ', shared'})` : '') +
        (needsVision ? `, ${fromVision.length} from the vision model` : ' (vision model not needed)')
    );
    // What each template box holds, from the words inside it (free): compared with the reading on the review page.
    // Only text the OCR is sure of: garbled Persian on a blurry scan would raise false disagreements.
    const boxText = (b: LocatedBox) => {
      if (!read?.[b.page] || !isPickableField(b.field)) return null;
      const inside = wordsInRegion(read[b.page], b);
      if (!inside.length || inside.reduce((sum, w) => sum + w.confidence, 0) / inside.length < SURE_WORDS) return null;
      return regionText(inside) || null;
    };
    return {
      boxes: [...fromWords, ...fromTemplate.map((b) => ({ ...b, source: 'TEMPLATE' as const, value: boxText(b) })), ...fromVision],
      templateId: template && fromTemplate.length ? template.id : null
    };
  }

  /** Once per expense, also when the review page asks twice at the same moment. Resolves to the template it used. */
  function locateOnce(organizationId: string, expense: ReadableExpense, pages: PageImage[], languages: string): Promise<string | null> {
    let running = locating.get(expense.id);
    if (!running) {
      running = locateBoxes(organizationId, expense, pages, languages)
        .then(async ({ boxes, templateId }) => {
          await repository.saveModelBoxes(expense.id, boxes, templateId);
          return templateId;
        })
        .finally(() => locating.delete(expense.id));
      locating.set(expense.id, running);
    }
    return running;
  }

  /** The targets with a value but no box of either kind. */
  async function missingTargets(expense: ReadableExpense) {
    const boxed = new Set((await repository.listBoxes(expense.id)).map((b) => b.field));
    const { fields, items } = locateTargets(expense);
    return { fields: fields.filter((t) => !boxed.has(t.field)), items: items.filter((t) => !boxed.has(t.field)) };
  }

  async function response(organizationId: string, expense: ReadableExpense, pages: PageImage[], templateId: string | null, error?: string): Promise<FieldBoxesResponse> {
    const dpi = Math.min(...pages.map((p) => p.dpi ?? Infinity));
    const missing = await missingTargets(expense);
    const template = templateId ? await templates.findById(templateId) : null;
    const boxes = await repository.listBoxes(expense.id);
    const country = getCountryProfile((await repository.getReadingSettings(organizationId)).country);
    const templateValues = boxes
      .filter((b) => b.source === 'TEMPLATE' && isPickableField(b.field))
      .map(({ field, value: text }) => {
        const { kind } = PICKABLE_FIELDS[field];
        const printed = text === null ? null : kind === 'amount' ? printedAmount(text) : kind === 'date' ? printedDate(text) : text;
        return { field, text, value: printed === null ? null : toFormValue(expense, country, field, String(printed)) };
      });
    return {
      enabled: true,
      pages: pages.map(({ width, height }, index) => ({ index, width, height })),
      boxes,
      ...(templateValues.length ? { templateValues } : {}),
      missing: pages.length ? [...missing.fields, ...missing.items].map((t) => t.field) : [],
      ...(template ? { template: { vendorName: template.vendorName, shared: template.organizationId !== organizationId, timesSent: template.timesSent } } : {}),
      ...(error ? { error } : {}),
      ...(dpi < LOW_SCAN_DPI ? { lowResolutionDpi: dpi } : {})
    };
  }

  /** A field that has a box: a form field with a box on the photo, or a line item that exists. */
  function checkBoxField(expense: ReadableExpense, field: string) {
    const item = /^items\.(\d+)$/.exec(field);
    if (item ? Number(item[1]) >= expense.items.length : !isPickableField(field)) throw new BadRequestError(`"${field}" has no box on the document`);
  }

  function checkEditable(expense: ReadableExpense) {
    if (!EDITABLE.includes(expense.status)) throw new BadRequestError('This document can no longer be edited');
  }

  /**
   * The words inside a region: from the page words read when the invoice was
   * opened, else (after a restart, or an invoice opened before) a text PDF's
   * own words, or word OCR of just that region. Null without word OCR.
   */
  async function wordsForBox(expense: ReadableExpense, pages: PageImage[], index: number, region: Region, languages: string): Promise<OcrWord[] | null> {
    const ocr = words?.();
    if (!ocr) return null;
    const cached = wordCache.get(expense.id)?.[index];
    if (cached) return wordsInRegion(cached, region);
    if (pages[index].rendered) {
      const read = await pageWords(expense, pages, languages);
      if (!read?.[index]) return null;
      rememberWords(expense, read);
      return wordsInRegion(read[index], region);
    }
    const { buffer, frame } = await cropForOcr(pages[index], region);
    const [page] = (await ocr.readWords({ buffer, filename: 'box.jpg', contentType: 'image/jpeg' }, { languages })).pages;
    if (!page) return [];
    // Back from the crop's fractions to the page's.
    const onPage = page.words.map((w) => ({
      ...w,
      box: { x: frame.x + w.box.x * frame.width, y: frame.y + w.box.y * frame.height, width: w.box.width * frame.width, height: w.box.height * frame.height }
    }));
    return wordsInRegion({ ...page, words: onPage }, region);
  }

  /**
   * A value as read (printed on the invoice) in the form's units: amounts in the
   * stored unit (Toman as Rial) and, when the invoice was converted, in the
   * converted currency; dates as YYYY-MM-DD.
   */
  function toFormValue(expense: ReadableExpense, country: ReturnType<typeof getCountryProfile>, field: string, read: string): string | number | null {
    const { kind } = PICKABLE_FIELDS[field];
    if (kind === 'date') return getCalendar(country.calendar).toIsoDate(westernDigits(read));
    if (kind !== 'amount') return read;
    const amount = num(read);
    // The reading's unit (e.g. Toman, read as "IRT") is what the invoice prints; the form shows the stored unit.
    const printed = String(readingData(expense).currency ?? '').toUpperCase();
    const unit = country.invoice.currencyUnits.find((u) => u.code === printed || u.aliases.includes(printed));
    const converted = expense.originalCurrency && expense.exchangeRate && expense.currency !== expense.originalCurrency;
    // The line items are never converted: they are compared before the exchange rate.
    const stored = amount === null ? null : withZerosFromLines(field, amount * (unit?.factor ?? 1), expense);
    return stored === null ? null : Math.round(stored * (converted ? Number(expense.exchangeRate) : 1) * 100) / 100;
  }

  async function enabledFor(organizationId: string) {
    const settings = await repository.getReadingSettings(organizationId);
    return { enabled: showsFieldBoxes(settings.invoiceReader), country: getCountryProfile(settings.country) };
  }

  return {
    async getFieldBoxes(organizationId: string, id: string, actor: Actor): Promise<FieldBoxesResponse> {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled, country } = await enabledFor(organizationId);
      if (!enabled) return { enabled: false, pages: [], boxes: [], missing: [] };

      const pages = await pagesOf(expense);
      let error: string | undefined;
      let templateId = typeof expense.templateId === 'string' ? expense.templateId : null;
      if (pages.length && !expense.boxesLocatedAt) {
        templateId = await locateOnce(organizationId, expense, pages, languagesFor(expense, country)).catch((err: Error) => {
          error = err.message || 'Could not locate the fields on the document';
          return null;
        });
      }
      return response(organizationId, expense, pages, templateId, error);
    },

    /**
     * An invoice was sent (or an expense submitted): the user checked it, so its
     * boxes — found, from a template or drawn — are its vendor's layout. The
     * organization's template for the vendor is created or updated with them;
     * the template used to place them (maybe another organization's) counts one
     * more use, and one more correction when the user had to move a box.
     * Template-guided reader only; nothing to learn without boxes or a vendor key.
     */
    async learnTemplate(organizationId: string, id: string, actor: Actor): Promise<TemplateLearned> {
      const expense = await expenses.getById(organizationId, id, actor);
      const settings = await repository.getReadingSettings(organizationId);
      if (!showsFieldBoxes(settings.invoiceReader)) return null;
      const keys = templateKeys(expense);
      if (!keys.taxId && !keys.key) return null;
      const boxes = await repository.listBoxes(expense.id);
      const pages = await pagesOf(expense);
      const layout = layoutFromBoxes(boxes, aspectsOf(pages));
      if (!layout) return null;

      const used = typeof expense.templateId === 'string' ? await templates.findById(expense.templateId) : null;
      // Fields the user removed the box of on this invoice (Remove): the template forgets them.
      const removed = (await repository.listRemovedFields(expense.id)).filter((field) => !boxes.some((b) => b.field === field));
      if (used) await templates.recordUse(used.id, removed.length > 0 || boxes.some((b) => b.source === 'USER'));
      const own =
        used?.organizationId === organizationId
          ? used
          : bestTemplate((await templates.findCandidates(organizationId, keys)).filter((t) => t.organizationId === organizationId), organizationId, keys);
      const vendorName = typeof expense.vendorName === 'string' ? expense.vendorName : null;
      if (own) {
        // This invoice's boxes win; fields it didn't have keep the template's (another invoice may have had a due date),
        // except the ones the user removed from it.
        const kept = Object.fromEntries(Object.entries(own.fields).filter(([field]) => !removed.includes(field)));
        const merged = {
          fields: { ...kept, ...layout.fields },
          items: layout.items ?? own.items,
          pageAspects: layout.pageAspects.length >= own.pageAspects.length ? layout.pageAspects : own.pageAspects
        };
        await templates.update(own.id, { ...merged, vendorTaxId: keys.taxId, vendorKey: keys.key, vendorName });
        return { vendorName: vendorName ?? own.vendorName, created: false };
      }
      await templates.create({ ...layout, organizationId, shared: settings.shareTemplates, vendorTaxId: keys.taxId, vendorKey: keys.key, vendorName });
      return { vendorName, created: true };
    },

    /** The user moved, resized or drew a field's box: it is kept as theirs (what was read from it, if anything, stays). */
    async moveFieldBox(organizationId: string, id: string, actor: Actor, input: { field: string; page: number; region: Region }) {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled } = await enabledFor(organizationId);
      if (!enabled) throw new BadRequestError('Field boxes are not enabled for your organization');
      checkEditable(expense);
      checkBoxField(expense, input.field);
      if (!(await pagesOf(expense))[input.page]) throw new BadRequestError('This document has no such page');
      await repository.moveUserBox(expense.id, { field: input.field, page: input.page, ...input.region });
      return { boxes: await repository.listBoxes(expense.id) };
    },

    /** The field's box is wrong and there is no right place: removed (both the found one and the user's). */
    async removeFieldBox(organizationId: string, id: string, actor: Actor, field: string) {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled } = await enabledFor(organizationId);
      if (!enabled) throw new BadRequestError('Field boxes are not enabled for your organization');
      checkEditable(expense);
      checkBoxField(expense, field);
      await repository.removeBoxes(expense.id, field);
      return { boxes: await repository.listBoxes(expense.id) };
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
     * "Read from box" (free): the value of the box the user drew, from the words
     * inside it, in the form's units (see toFormValue); kept as the field's USER
     * box. No value for handwriting, an empty box or without word OCR: the user
     * types it, or asks the vision model (readRegion).
     */
    async readBox(organizationId: string, id: string, actor: Actor, input: { field: string; page: number; region: Region }) {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled, country } = await enabledFor(organizationId);
      if (!enabled) throw new BadRequestError('Field boxes are not enabled for your organization');
      if (!isPickableField(input.field)) throw new BadRequestError(`"${input.field}" cannot be read from the document`);
      checkEditable(expense);
      const pages = await pagesOf(expense);
      if (!pages[input.page]) throw new BadRequestError('This document has no such page');

      let read: string | null = null;
      let reason: BoxReadReason | undefined;
      if (isHandwritten(expense)) reason = 'handwritten';
      else {
        const inside = await wordsForBox(expense, pages, input.page, input.region, languagesFor(expense, country)).catch((err: Error) => {
          console.warn(`read from box: word OCR failed: ${err.message}`);
          return null;
        });
        if (inside === null) reason = 'unavailable';
        else read = regionText(inside) || null;
      }
      const { kind } = PICKABLE_FIELDS[input.field];
      const printed = read === null ? null : kind === 'amount' ? printedAmount(read) : kind === 'date' ? printedDate(read) : read;
      const value = printed === null ? null : toFormValue(expense, country, input.field, String(printed));
      if (!reason && value === null) reason = 'empty';

      const box = { field: input.field, page: input.page, ...input.region };
      await repository.saveUserBox(expense.id, box, read);
      return { field: input.field, value, read, box: { ...box, source: 'USER' as const, value: read }, ...(reason ? { reason } : {}) };
    },

    /**
     * "Read with AI": the value of one field, read by the vision model from the
     * region the user drew (handwriting, or print the words missed), in the
     * form's units (see toFormValue). The region is kept as the field's USER box.
     */
    async readRegion(organizationId: string, id: string, actor: Actor, input: { field: string; page: number; region: Region }) {
      const expense = await expenses.getById(organizationId, id, actor);
      const { enabled, country } = await enabledFor(organizationId);
      if (!enabled) throw new BadRequestError('Picking from the photo is not enabled for your organization');
      if (!isPickableField(input.field)) throw new BadRequestError(`"${input.field}" cannot be picked from the photo`);
      checkEditable(expense);
      const image = (await pagesOf(expense))[input.page];
      if (!image) throw new BadRequestError('This document has no such page');

      const { kind, label } = PICKABLE_FIELDS[input.field];
      const today = getCalendar(country.calendar).today();
      // Handwriting: the whole page too, and the same rules the reading itself used (digit shapes, zeros, the total in words).
      const withPage = isHandwritten(expense);
      const handwriting = withPage ? country.invoice.handwriting?.promptRules(today) : undefined;
      const { value: read, looksLike } = await readRegionValue(vision(), image, input.region, kind, label, { today, withPage, handwriting });
      const value = read === null ? null : toFormValue(expense, country, input.field, read);

      const box = { field: input.field, page: input.page, ...input.region };
      await repository.saveUserBox(expense.id, box, read);
      // Clearly something else (a customer's name framed as the vendor's address): the page asks before filling the field.
      return { field: input.field, value, read, box: { ...box, source: 'USER' as const, value: read }, ...(looksLike ? { looksLike } : {}) };
    }
  };
}

export type ReadingService = ReturnType<typeof createReadingService>;
