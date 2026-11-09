import {
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
import { EMPTY_GUIDE, GUIDE_FIELDS, learnGuide, type FormGuide, type GuideField, type SentInvoice } from './form-guide';
import { printedAmount, printedDate, regionText, wordsInRegion } from './box-text';
import { cropForOcr, documentPages, PageImage, Region } from './page-images';
import {
  alignTemplate,
  findTemplate,
  readPageWords,
  READABLE_PAGE,
  TemplateMatch,
  WORDS_MATCH,
  WORDS_OTHER_FORM,
  WORDS_TEMPLATE_MIN
} from './template-finder';
import { readingRepository as prismaReadingRepository, ReadingRepository } from './reading.repository';
import {
  fixedWordsOf,
  IDENTITY,
  matchWords,
  mergeWords,
  moveLayout,
  PageLook,
  pageLook,
  readableWords
} from './template-match';
import {
  bestTemplate,
  ChosenField,
  distrusted,
  labelBefore,
  fitsPages,
  layoutFromBoxes,
  placeFromTemplate,
  sameLayout,
  StoredTemplate,
  TemplateMatchKind,
  taxIdKey,
  vendorKey
} from './templates';
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
  /**
   * The invoice template whose boxes were used: the vendor's, from this
   * organization or shared by another one. matchedBy: found by the vendor, or
   * by the form itself (its printed words, its look) — then maybe another
   * vendor's template of the same printed form, so the page asks to check.
   */
  template?: { vendorName: string | null; shared: boolean; timesSent: number; matchedBy: TemplateMatchKind };
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

/** The template an invoice's boxes came from, and how it was found. */
type UsedTemplate = { id: string; by: TemplateMatchKind };

/** What learning from a sent invoice did: its vendor's template created or updated (null: nothing to learn). */
export type TemplateLearned = { vendorName: string | null; created: boolean } | null;

/** The keys an invoice's template is found by: the vendor's tax ID and name. */
const templateKeys = (expense: ReadableExpense) => ({ taxId: taxIdKey(expense.vendorTaxId), key: vendorKey(expense.vendorName) });
const lookup = (keys: { taxId: string | null; key: string | null }) => ({ taxIds: keys.taxId ? [keys.taxId] : [], keys: keys.key ? [keys.key] : [] });

/** A box whose centre moved this far (page fraction) from where the template put it was put right by the user. */
const MOVED = 0.02;

/**
 * Whether the user corrected the template's boxes on an invoice: moved one of
 * them clearly elsewhere, or removed one the template had. Drawing a box where
 * the template's already was (to fill its field), or for a field the template
 * didn't have, is no correction.
 */
export function correctedTemplate(used: StoredTemplate, boxes: { field: string; source: string; x: number; y: number; width: number; height: number }[], removed: string[]): boolean {
  if (removed.some((field) => used.fields[field])) return true;
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  return boxes.some((user) => {
    if (user.source !== 'USER') return false;
    const placed = boxes.find((b) => b.source === 'TEMPLATE' && b.field === user.field);
    if (!placed) return false;
    const [a, b] = [centre(user), centre(placed)];
    return Math.abs(a.x - b.x) > MOVED || Math.abs(a.y - b.y) > MOVED;
  });
}

/** The fields a chosen-value rule can hold: text read as it is printed, and the amounts the user picked out. */
const CHOOSABLE = ['invoiceNumber', 'vendorName', 'vendorTaxId', 'vendorAddress', 'totalAmount', 'subtotal', 'taxAmount', 'discountAmount'];

const plain = (value: unknown) => (value === null || value === undefined ? '' : westernDigits(String(value)).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
const amountOf = (value: unknown) => (value === null || value === undefined || value === '' ? null : Math.round(Number(value) * 100));

/**
 * The template's chosen fields after a sent invoice: a field the user changed
 * from what was read to the value in a box they drew counts once more (from one
 * again when the box is somewhere else than the template's), with the printed
 * label before that value in the OCR text (not a line item's name); one they
 * changed without a box loses its rule. Counts and labels only, never the values.
 */
export function chosenFields(
  expense: ReadableExpense,
  boxes: { field: string; source: string; x: number; y: number; width: number; height: number; value: string | null }[],
  before: Record<string, ChosenField>,
  template: { fields: Record<string, { x: number; y: number; width: number; height: number }> } | null
): Record<string, ChosenField> {
  const initial = (expense.initialReading ?? {}) as Record<string, unknown>;
  const ocrText = (expense.rawExtraction as { ocrText?: unknown } | null)?.ocrText;
  const items = expense.items.map((i) => i.description);
  const chosen = { ...before };
  for (const field of CHOOSABLE) {
    const amount = PICKABLE_FIELDS[field].kind === 'amount';
    const initialValue = initial[PICKABLE_FIELDS[field].readingKey];
    const box = boxes.find((b) => b.source === 'USER' && b.field === field);
    let changed: boolean;
    let inBox: boolean;
    if (amount) {
      const now = amountOf(expense[field] as Amount | undefined);
      if (now === null || now === amountOf(initialValue)) continue;
      changed = true;
      const printed = box?.value ? printedAmount(box.value) : null;
      inBox = printed !== null && Math.round(printed * 100) === now;
    } else {
      const now = plain(expense[field]);
      if (!now || now === plain(initialValue)) continue;
      changed = true;
      inBox = !!box?.value && (plain(box.value).includes(now) || now.includes(plain(box.value)));
    }
    if (!changed) continue;
    if (!box || !inBox) {
      delete chosen[field];
      continue;
    }
    const was = template?.fields[field];
    const samePlace = was && Math.abs(was.x + was.width / 2 - (box.x + box.width / 2)) <= MOVED && Math.abs(was.y + was.height / 2 - (box.y + box.height / 2)) <= MOVED;
    const label = typeof ocrText === 'string' ? labelBefore(ocrText, String(expense[field]), { amount, skip: items }) : null;
    chosen[field] = samePlace ? { times: (chosen[field]?.times ?? 0) + 1, label: label ?? chosen[field]?.label ?? null } : { times: 1, label };
  }
  return chosen;
}

/** A stored value as the guide compares it: dates as YYYY-MM-DD, amounts as numbers, text as it is. */
function guideValue(field: GuideField, value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  const kind = PICKABLE_FIELDS[field].kind;
  if (kind === 'date') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (kind === 'amount') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value);
}

/**
 * The sent invoice as the form guide learns from it (form-guide.ts): its OCR
 * text, the values sent and as first read; null without OCR text (handwriting
 * read from the photo, an old invoice).
 */
export function sentInvoice(expense: ReadableExpense, amountFactors: number[]): SentInvoice | null {
  const ocrText = (expense.rawExtraction as { ocrText?: unknown } | null)?.ocrText;
  if (typeof ocrText !== 'string' || !ocrText.trim()) return null;
  const initial = (expense.initialReading ?? {}) as Record<string, unknown>;
  const values: SentInvoice['values'] = {};
  const read: SentInvoice['read'] = {};
  for (const field of GUIDE_FIELDS) {
    values[field] = guideValue(field, expense[field]);
    read[field] = guideValue(field, initial[PICKABLE_FIELDS[field].readingKey]);
  }
  return { ocrText, values, read, itemNames: expense.items.map((i) => i.description).filter(Boolean), amountFactors };
}

/** The template's guide after this invoice was sent. */
function guideAfter(before: FormGuide | undefined, expense: ReadableExpense, amountFactors: number[]): FormGuide | undefined {
  const sent = sentInvoice(expense, amountFactors);
  return sent ? learnGuide(before ?? EMPTY_GUIDE, sent) : before;
}

/** The template the upload's reading was guided by (rawExtraction.template.match), when its reading held: the boxes use it too. */
function uploadTemplate(expense: ReadableExpense): UsedTemplate | null {
  const match = (expense.rawExtraction as { template?: { match?: { id?: unknown; by?: unknown; outcome?: unknown } } } | null)?.template?.match;
  if (!match || typeof match.id !== 'string' || match.outcome === 'fell-back') return null;
  return { id: match.id, by: (match.by as TemplateMatchKind) ?? 'vendor' };
}
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
  const locating = new Map<string, Promise<UsedTemplate | null>>();
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
      const pdf = pages.length && pages.every((p) => p.rendered) && expense.filePath ? await fileStorage.read(expense.filePath) : null;
      return await readPageWords(ocr, pages, pdf, languages);
    } catch (err) {
      console.warn(`field boxes: word OCR failed, using the vision model: ${(err as Error).message}`);
      return null;
    }
  }

  /** The first page's look, once per document (only needed when the words don't tell the form). */
  const lookCache = new Map<Buffer, Promise<PageLook | null>>();
  function lookOf(pages: PageImage[]): Promise<PageLook | null> {
    const page = pages[0];
    if (!page) return Promise.resolve(null);
    let look = lookCache.get(page.buffer);
    if (!look) {
      look = pageLook(page.buffer).catch(() => null);
      lookCache.set(page.buffer, look);
      if (lookCache.size > PAGE_CACHE_SIZE) lookCache.delete(lookCache.keys().next().value!);
    }
    return look;
  }

  /**
   * The template for the boxes: the one the upload's reading was guided by
   * (aligned to this scan), else found by the vendor as read, the form's
   * printed words or the page's look (template-finder.ts).
   */
  async function matchTemplate(organizationId: string, expense: ReadableExpense, pages: PageImage[], read: OcrPage[] | null): Promise<TemplateMatch | null> {
    const fromUpload = uploadTemplate(expense);
    const template = fromUpload ? await templates.findById(fromUpload.id) : null;
    if (fromUpload && template) return { template, by: fromUpload.by, transforms: await alignTemplate(template, read, await lookOf(pages)) };
    const keys = templateKeys(expense);
    return findTemplate(templates, {
      organizationId,
      aspects: aspectsOf(pages),
      vendor: lookup(keys),
      read: keys,
      words: async () => read,
      look: () => lookOf(pages)
    });
  }

  /**
   * Boxes from the OCR's word positions first (exact; no model, about a second
   * a page), then the matching template for what the words didn't place
   * (aligned to this scan). When together they place less than half of the
   * values — Persian scans and tables, handwriting (word OCR can't read it),
   * blurry photos, a form without a template — one vision model call places
   * the rest (rougher; the user moves them). When it fails, the boxes found so
   * far are kept. A handwritten invoice's words are read only to find its form.
   */
  async function locateBoxes(organizationId: string, expense: ReadableExpense, pages: PageImage[], languages: string) {
    const read = await pageWords(expense, pages, languages);
    if (read) rememberWords(expense, read);
    const handwritten = isHandwritten(expense);
    const match = await matchTemplate(organizationId, expense, pages, read).catch((err: Error) => {
      console.warn(`field boxes: template lookup failed: ${err.message}`);
      return null;
    });
    const template = match ? moveLayout(match.template, match.transforms) : null;
    const fromWords = read && !handwritten ? locateFromWords(read, wordTargets(expense)) : [];
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
    const t = match?.template;
    console.log(
      `field boxes ${expense.id}: ${fromWords.length} of ${total} from words` +
        (t ? `, ${fromTemplate.length} from the template (${t.vendorName ?? t.id}, by ${match!.by}${t.organizationId === organizationId ? '' : ', shared'})` : '') +
        (needsVision ? `, ${fromVision.length} from the vision model` : ' (vision model not needed)')
    );
    // What each template box holds, from the words inside it (free): compared with the reading on the review page.
    // Only text the OCR is sure of: garbled Persian on a blurry scan would raise false disagreements. Not on handwriting.
    const boxText = (b: LocatedBox) => {
      if (handwritten || !read?.[b.page] || !isPickableField(b.field)) return null;
      const inside = wordsInRegion(read[b.page], b);
      if (!inside.length || inside.reduce((sum, w) => sum + w.confidence, 0) / inside.length < SURE_WORDS) return null;
      return regionText(inside) || null;
    };
    return {
      boxes: [...fromWords, ...fromTemplate.map((b) => ({ ...b, source: 'TEMPLATE' as const, value: boxText(b) })), ...fromVision],
      template: match && fromTemplate.length ? { id: match.template.id, by: match.by } : null
    };
  }

  /** Once per expense, also when the review page asks twice at the same moment. Resolves to the template it used. */
  function locateOnce(organizationId: string, expense: ReadableExpense, pages: PageImage[], languages: string): Promise<UsedTemplate | null> {
    let running = locating.get(expense.id);
    if (!running) {
      running = locateBoxes(organizationId, expense, pages, languages)
        .then(async ({ boxes, template }) => {
          await repository.saveModelBoxes(expense.id, boxes, template);
          return template;
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

  async function response(organizationId: string, expense: ReadableExpense, pages: PageImage[], used: UsedTemplate | null, error?: string): Promise<FieldBoxesResponse> {
    const dpi = Math.min(...pages.map((p) => p.dpi ?? Infinity));
    const missing = await missingTargets(expense);
    const template = used ? await templates.findById(used.id) : null;
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
      ...(template
        ? { template: { vendorName: template.vendorName, shared: template.organizationId !== organizationId, timesSent: template.timesSent, matchedBy: used!.by } }
        : {}),
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
      let used: UsedTemplate | null =
        typeof expense.templateId === 'string' ? { id: expense.templateId, by: (expense.templateMatch as TemplateMatchKind | null) ?? 'vendor' } : null;
      if (pages.length && !expense.boxesLocatedAt) {
        used = await locateOnce(organizationId, expense, pages, languagesFor(expense, country)).catch((err: Error) => {
          error = err.message || 'Could not locate the fields on the document';
          return null;
        });
      }
      return response(organizationId, expense, pages, used, error);
    },

    /**
     * An invoice was sent (or an expense submitted): the user checked it, so its
     * boxes — found, from a template or drawn — are its vendor's layout, and the
     * printed words outside them (and the page's look) are its form. The
     * organization's template for the vendor's form is created or updated with
     * them; the template used to place them (maybe another organization's, or
     * another vendor's on the same printed form) counts one more use, and one
     * more correction when the user had to move a box. A trusted template whose
     * boxes nearly all moved, or whose printed words are missing, is another
     * form of the vendor: a new template, the old one stays.
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

      // The form: printed words outside the boxes (from the words read on open, else read again; free) and the look.
      const read = wordCache.get(expense.id) ?? (await pageWords(expense, pages, languagesFor(expense, getCountryProfile(settings.country))));
      const words = read ? fixedWordsOf(read, layout) : [];
      const look = await lookOf(pages);

      const used = typeof expense.templateId === 'string' ? await templates.findById(expense.templateId) : null;
      // Fields the user removed the box of on this invoice (Remove): the template forgets them.
      const removed = (await repository.listRemovedFields(expense.id)).filter((field) => !boxes.some((b) => b.field === field));
      if (used) await templates.recordUse(used.id, correctedTemplate(used, boxes, removed));

      // The organization's template for this vendor and form: the one used when it is the vendor's, else the vendor's whose words are here.
      const ofVendor = (t: StoredTemplate) => (keys.taxId !== null && t.vendorTaxId === keys.taxId) || (keys.key !== null && t.vendorKey === keys.key);
      const candidates =
        used && used.organizationId === organizationId && ofVendor(used)
          ? [used]
          : (await templates.findCandidates(organizationId, lookup(keys))).filter((t) => t.organizationId === organizationId && fitsPages(t, layout.pageAspects));
      const scored = candidates.map((template) => ({ template, words: read && template.words.length ? matchWords(template.words, read) : null }));
      const readable = read ? readableWords(read) : 0;
      const own =
        scored.filter((c) => c.words && c.words.score >= WORDS_MATCH).sort((a, b) => b.words!.score - a.words!.score)[0]?.template ??
        bestTemplate(candidates, organizationId, keys);
      const vendorName = typeof expense.vendorName === 'string' ? expense.vendorName : null;
      // Amounts as printed: stored ÷ the currency unit's factor (Toman is stored as Rial).
      const factors = [1, ...getCountryProfile(settings.country).invoice.currencyUnits.map((u) => u.factor).filter((f) => f !== 1)];

      if (own) {
        // The template's places on this scan: what it keeps is moved here, so old and new boxes and words agree.
        const transforms = await alignTemplate(own, read, await lookOf(pages));
        const moved = moveLayout(own, transforms);
        const ownWords = scored.find((c) => c.template === own)?.words;
        const wordsMissing = !!ownWords && own.words.length >= WORDS_TEMPLATE_MIN && readable >= READABLE_PAGE && ownWords.score < WORDS_OTHER_FORM;
        const trusted = own.timesSent >= 2 && !distrusted(own);
        const otherForm = wordsMissing || (trusted && !sameLayout(moved, layout) && Object.keys(layout.fields).filter((f) => moved.fields[f]).length >= 3);
        if (!otherForm) {
          // This invoice's boxes win; fields it didn't have keep the template's (another invoice may have had a due date),
          // except the ones the user removed from it.
          const kept = Object.fromEntries(Object.entries(moved.fields).filter(([field]) => !removed.includes(field)));
          const merged = mergeWords(own.words, own.samples, words, (w) => {
            const t = transforms[w.page] ?? IDENTITY;
            return { ...w, x: t.ax * w.x + t.bx, y: t.ay * w.y + t.by };
          });
          await templates.update(own.id, {
            fields: { ...kept, ...layout.fields },
            items: layout.items ?? moved.items,
            pageAspects: layout.pageAspects.length >= own.pageAspects.length ? layout.pageAspects : own.pageAspects,
            ...merged,
            look: look ?? own.look,
            chosen: chosenFields(expense, boxes, own.chosen, moved),
            guide: guideAfter(own.guide, expense, factors),
            vendorTaxId: keys.taxId,
            vendorKey: keys.key,
            vendorName
          });
          return { vendorName: vendorName ?? own.vendorName, created: false };
        }
      }
      await templates.create({
        ...layout,
        words,
        samples: 1,
        look,
        chosen: chosenFields(expense, boxes, {}, null),
        guide: guideAfter(undefined, expense, factors),
        organizationId,
        shared: settings.shareTemplates,
        vendorTaxId: keys.taxId,
        vendorKey: keys.key,
        vendorName
      });
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
