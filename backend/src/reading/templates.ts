import { westernDigits } from '../ai/replies';
import { isItemField, isPickableField, itemField } from './fields';
import type { PageLook, TemplateWord } from './template-match';
import { LocatedBox } from './vision-fields';
import type { FormGuide } from './form-guide';

// Invoice templates: where a vendor's (or a form's) fields are on the page,
// learned from an invoice the user sent and used to place the boxes on the
// next one — also for other organizations. A template is layout only: box
// positions in 0–1 page fractions and the vendor's keys; never a value, a
// customer, an amount or a page image.

export type TemplateBox = { page: number; x: number; y: number; width: number; height: number };
/** The line-items table: rows of rowHeight from its top, one per line item. */
export type TemplateItems = TemplateBox & { rowHeight: number };
export type TemplateLayout = { pageAspects: number[]; fields: Record<string, TemplateBox>; items: TemplateItems | null };
export type StoredTemplate = TemplateLayout & {
  id: string;
  organizationId: string;
  shared: boolean;
  vendorTaxId: string | null;
  vendorKey: string | null;
  vendorName: string | null;
  timesSent: number;
  timesCorrected: number;
  updatedAt: Date;
  /** The form's fixed printed words, and how many invoices they were learned from. */
  words: TemplateWord[];
  samples: number;
  /** The first page's layout fingerprint, or null (learned before it was kept). */
  look: PageLook | null;
  /** The fields whose value the user chose from a box over what was read (see RULE_AFTER). */
  chosen: Record<string, ChosenField>;
  /** What the form prints before each value, learned from every sent invoice (form-guide.ts). */
  guide: FormGuide;
  /** Short hashes of the receipts learned from (the same one sent again teaches nothing); absent = none. */
  learnedFrom?: string[];
  /** The cheaper model's readings of this form, and how many failed a check. */
  cheapReads?: number;
  cheapFailed?: number;
};

/**
 * A field the user chose the value of: on how many sent invoices, and the
 * printed words just before that value in the OCR text ("شماره خروج" before
 * "SF9903"; form text, not a value), when there are any.
 */
export type ChosenField = { times: number; label: string | null };

/** From this many invoices on which the user chose the value in a field's box, that box is the rule for the field. */
export const RULE_AFTER = 2;

/** The fields whose box is the rule: the user chose its value on RULE_AFTER invoices or more. */
export const ruledFields = (t: Pick<StoredTemplate, 'chosen'>) => Object.keys(t.chosen ?? {}).filter((f) => (t.chosen[f]?.times ?? 0) >= RULE_AFTER);

/** Words of a label kept at most (the words right before the value). */
const LABEL_WORDS = 4;
/** Western digits, Persian ي/ك unified, for finding a value or label in OCR text. */
const findable = (s: string) => westernDigits(s.normalize('NFKC')).replace(/ي/g, 'ی').replace(/ك/g, 'ک');

/** Where a value is printed in OCR text: an amount's digits with any separators between them ("45000000" in "۴۵,۰۰۰,۰۰۰"), else the text itself. */
function occurrences(text: string, value: string, amount: boolean): number[] {
  const v = findable(value).trim();
  if (v.length < 2) return [];
  const pattern = amount
    ? new RegExp(`(?<![\\d.,])${v.replace(/\.0+$/, '').replace(/\D/g, '').split('').join('[,.٬\\s]?')}(?![\\d]|[.,]\\d)`, 'g')
    : new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return [...text.matchAll(pattern)].map((m) => m.index!);
}

/**
 * The printed words just before a value in an invoice's OCR text, in the same
 * table cell or line ("| شماره خروج SF9903 |" → "شماره خروج", "هزینه کل (ریال) :
 * ۴۵,۰۰۰,۰۰۰" → "هزینه کل (ریال)"); where it is printed more than once, the first
 * label not in `skip` (a line item's name). Null when the value isn't found or
 * nothing stands before it.
 */
export function labelBefore(text: string, value: string, options: { amount?: boolean; skip?: string[] } = {}): string | null {
  return labelsBefore(text, value, options)[0] ?? null;
}

/** Every label a value is printed after, in the order they come in the text (a total printed after "هزینه پایه" and "هزینه کل" alike). */
export function labelsBefore(text: string, value: string, options: { amount?: boolean; skip?: string[] } = {}): string[] {
  const t = findable(text);
  const skip = new Set((options.skip ?? []).map((s) => findable(s).replace(/\s+/g, ' ').trim()));
  const labels: string[] = [];
  for (const at of occurrences(t, value, options.amount ?? false)) {
    const start = Math.max(t.lastIndexOf('\n', at - 1), t.lastIndexOf('|', at - 1)) + 1;
    const wordsOf = (s: string) =>
      s
        .replace(/[:：#.\-–]+\s*$/u, '')
        .trim()
        .split(/\s+/)
        .filter((w) => /\p{L}/u.test(w));
    let words = wordsOf(t.slice(start, at));
    // A value alone in its table cell: the label is the cell before it ("| مبلغ پرداختی | ۲,۳۹۰,۰۰۰,۰۰۰ |"), when that holds only words.
    if (!words.length && t[start - 1] === '|') {
      const cellStart = Math.max(t.lastIndexOf('\n', start - 2), t.lastIndexOf('|', start - 2)) + 1;
      const cell = t.slice(cellStart, start - 1);
      if (!/\d/.test(cell) && wordsOf(cell).length <= LABEL_WORDS) words = wordsOf(cell);
    }
    const label = words.slice(-LABEL_WORDS).join(' ');
    const bare = label.replace(/\s*\([^)]*\)\s*$/, '');
    if (label.length >= 2 && !skip.has(label) && !skip.has(bare) && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * The amounts printed after a label in OCR text, each line or table cell that
 * is just "label : amount" ("هزینه پایه (ریال) : ۴۵,۰۰۰,۰۰۰"), in order.
 */
export function labelledAmounts(text: string): { label: string; text: string }[] {
  const found: { label: string; text: string }[] = [];
  for (const cell of findable(text).split(/[\n|]/)) {
    const m = cell.trim().match(/^([^\d]*\p{L}[^\d:：]*?)\s*[:：]?\s*(-?\d[\d,.٬\s]*\d|\d)\s*$/u);
    if (!m) continue;
    const label = m[1].replace(/[:：#.\-–]+\s*$/u, '').trim().split(/\s+/).slice(-LABEL_WORDS).join(' ');
    if (label.length >= 2) found.push({ label, text: m[2] });
  }
  return found;
}

/** Western digits and one spelling of ی/ک: how labels are compared. */
export const labelKey = (label: string) => findable(label).replace(/\s+/g, ' ').trim();

/** The text printed right after a label, as findable text (dates and amounts as Western digits). */
export const findableText = findable;

/** Whether OCR text has a label (the form's printed words) in it. */
export const hasLabel = (text: string, label: string) => findable(text).includes(findable(label));

/** The labels of the fields the user made a rule of: printed on every invoice of the form, so OCR text without one missed part of the page. */
export const requiredLabels = (t: Pick<StoredTemplate, 'chosen'>) =>
  ruledFields(t)
    .map((f) => t.chosen[f].label)
    .filter((l): l is string => !!l);

/**
 * The value printed right after a label in an invoice's OCR text: the first
 * word after it in its cell or line, or in the next cell when the label fills
 * its own ("| مبلغ پرداختی | ۲,۳۹۰,۰۰۰,۰۰۰ |"); null when the label isn't there.
 */
export function valueAfter(text: string, label: string): string | null {
  const t = findable(text);
  const l = findable(label);
  const clean = (s: string) => s.replace(/^[\s:：#.\-–]+/u, '');
  let from = 0;
  for (let at = t.indexOf(l, from); at >= 0; at = t.indexOf(l, from)) {
    from = at + l.length;
    const after = t.slice(from);
    const own = after.split(/[\n|]/)[0];
    let rest = clean(own);
    if (!rest.trim() && after[own.length] === '|') rest = clean(after.slice(own.length + 1).split(/[\n|]/)[0]);
    const value = rest.split(/\s+/)[0];
    if (value && /[\p{L}\p{N}]/u.test(value)) return value;
  }
  return null;
}

/** How a template was found for an invoice: its vendor's tax ID or name, the form's printed words, or the page's look. */
export type TemplateMatchKind = 'vendor' | 'words' | 'look';

/** A page whose height ÷ width differs more than this is another form (or another scan of it, cut differently). */
export const ASPECT_TOLERANCE = 0.12;

/** The vendor's tax ID as digits, when long enough to identify a vendor. */
export function taxIdKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = westernDigits(value).replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
}

/** Words that say what kind of company it is, not which one ("شرکت", "GmbH"): left out of the key. */
const LEGAL_WORDS = new Set(['شرکت', 'فروشگاه', 'گروه', 'موسسه', 'مؤسسه', 'تولیدی', 'بازرگانی', 'gmbh', 'co', 'kg', 'ag', 'ltd', 'inc', 'llc', 'sa', 'srl', 'bv', 'oy', 'ab', 'as', 'aş', 'ltdşti', 'şti', 'the']);

/** A name's words as compared: Persian ي/ك unified, joiners and diacritics dropped, lower case, legal words left out. */
function nameWords(value: string): string[] {
  return westernDigits(value.normalize('NFKC'))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍ً-ٟـ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !LEGAL_WORDS.has(w));
}

/** The vendor's name, normalized so the same vendor read twice gives the same key (Persian ي/ك, spacing, case, legal words). */
export function vendorKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = nameWords(value).join('');
  return key.length >= 3 ? key : null;
}

/** A name found in running text is at least this long: shorter keys ("abc") turn up by chance. */
const MIN_KEY_IN_TEXT = 4;
/** A vendor's name is at most this many words (legal words left out). */
const MAX_NAME_WORDS = 4;
/** Tax IDs and registration numbers are this many digits (Iran's national ID 11, economic code 12; DE 9 after "DE"). */
const TAX_ID_DIGITS = { min: 8, max: 16 };

/**
 * The keys a vendor's name could have in an invoice's text (before the reading
 * says which name is the vendor's): every run of up to four words, as vendorKey
 * makes them. The customer's name is among them too — the caller tells them apart.
 */
export function vendorKeysInText(text: string): string[] {
  const keys = new Set<string>();
  // Across lines too: a logo prints "HELIX" over "TOOLS".
  const words = nameWords(text);
  for (let i = 0; i < words.length; i++) {
    let key = '';
    for (let n = 0; n < MAX_NAME_WORDS && i + n < words.length; n++) {
      key += words[i + n];
      if (key.length >= MIN_KEY_IN_TEXT && /\p{L}/u.test(key)) keys.add(key);
    }
  }
  return [...keys];
}

/** The digit runs in an invoice's text that could be a tax ID ("411 111 111 111", "DE 123/456/789" → digits). */
export function taxIdsInText(text: string): string[] {
  const runs = westernDigits(text).match(/\d(?:[\d]|[ \-/.](?=\d))*/g) ?? [];
  const ids = runs.map((r) => r.replace(/\D/g, '')).filter((d) => d.length >= TAX_ID_DIGITS.min && d.length <= TAX_ID_DIGITS.max);
  return [...new Set(ids)];
}

type BoxWithSource = LocatedBox & { source: string };

/** One box per field: the user's wins, then one found on the page, then the template's. */
function finalBoxes(boxes: BoxWithSource[]): BoxWithSource[] {
  const rank = (source: string) => (source === 'USER' ? 0 : source === 'MODEL' ? 1 : 2);
  const byField = new Map<string, BoxWithSource>();
  for (const box of boxes) {
    const kept = byField.get(box.field);
    if (!kept || rank(box.source) < rank(kept.source)) byField.set(box.field, box);
  }
  return [...byField.values()];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The layout an invoice's final boxes show, or null without any. `pageAspects`: height ÷ width of each page. */
export function layoutFromBoxes(boxes: BoxWithSource[], pageAspects: number[]): TemplateLayout | null {
  const kept = finalBoxes(boxes);
  const fields: Record<string, TemplateBox> = {};
  for (const { field, page, x, y, width, height } of kept) {
    if (isPickableField(field)) fields[field] = { page, x, y, width, height };
  }
  const lines = kept.filter((b) => isItemField(b.field));
  let items: TemplateItems | null = null;
  if (lines.length) {
    // The page most lines are on; the table is what they cover there.
    const counts = new Map<number, number>();
    for (const l of lines) counts.set(l.page, (counts.get(l.page) ?? 0) + 1);
    const page = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const onPage = lines.filter((l) => l.page === page);
    const x = Math.min(...onPage.map((l) => l.x));
    const y = Math.min(...onPage.map((l) => l.y));
    const right = Math.max(...onPage.map((l) => l.x + l.width));
    const bottom = Math.max(...onPage.map((l) => l.y + l.height));
    // Row pitch: from the tops of consecutive lines when there are several, else the line's own height.
    const tops = onPage.map((l) => l.y).sort((a, b) => a - b);
    const steps = tops.slice(1).map((t, i) => t - tops[i]).filter((d) => d > 0.002);
    const rowHeight = steps.length ? median(steps) : median(onPage.map((l) => l.height));
    items = { page, x, y, width: right - x, height: bottom - y, rowHeight };
  }
  if (!Object.keys(fields).length && !items) return null;
  const used = Math.max(items?.page ?? 0, ...Object.values(fields).map((b) => b.page));
  return { pageAspects: pageAspects.slice(0, used + 1), fields, items };
}

/** Whether a document's pages fit the template: every page it uses is there, with about the same shape. */
export function fitsPages(layout: Pick<TemplateLayout, 'pageAspects'>, pageAspects: number[]): boolean {
  return layout.pageAspects.every((aspect, i) => pageAspects[i] !== undefined && Math.abs(pageAspects[i] - aspect) / aspect <= ASPECT_TOLERANCE);
}

/**
 * The template's boxes for the values this invoice has: each field where the
 * template has it, line item i as row i of the items table (rows may go past
 * the template's last one: this invoice can have more lines). Fields in
 * `skip` (already placed from the words) are left out.
 */
export function placeFromTemplate(layout: TemplateLayout, targets: { fields: string[]; items: number }, skip: Set<string> = new Set()): LocatedBox[] {
  const placed: LocatedBox[] = [];
  for (const field of targets.fields) {
    const box = layout.fields[field];
    if (box && !skip.has(field)) placed.push({ field, ...box });
  }
  const table = layout.items;
  if (table && table.rowHeight > 0) {
    for (let i = 0; i < targets.items; i++) {
      const y = table.y + i * table.rowHeight;
      if (y + table.rowHeight > 1) break;
      if (!skip.has(itemField(i))) placed.push({ field: itemField(i), page: table.page, x: table.x, y, width: table.width, height: table.rowHeight });
    }
  }
  return placed;
}

/**
 * The best template for an invoice among candidates (found by tax ID or name):
 * the tax ID beats the name, the organization's own beats a shared one, then
 * the most trusted (sent often, rarely corrected), then the newest.
 */
export function bestTemplate<T extends StoredTemplate>(candidates: T[], organizationId: string, keys: { taxId: string | null; key: string | null }): T | null {
  const score = (t: T) =>
    [
      keys.taxId && t.vendorTaxId === keys.taxId ? 1 : 0,
      keys.key && t.vendorKey === keys.key ? 1 : 0,
      t.organizationId === organizationId ? 1 : 0,
      t.timesSent - 2 * t.timesCorrected,
      t.updatedAt.getTime()
    ] as const;
  const better = (a: T, b: T) => {
    const [sa, sb] = [score(a), score(b)];
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i];
    return false;
  };
  return candidates.reduce<T | null>((best, t) => (!best || better(t, best) ? t : best), null);
}

/** A box's centre this far (page fraction) from the other's is another place. */
const SAME_PLACE = 0.03;

/**
 * Whether two templates place their fields alike: the same printed form (a
 * stationery shop's "فاکتور فروش" pad) used by different vendors. Needs three
 * fields in common, most of them in the same place.
 */
export function sameLayout(a: Pick<TemplateLayout, 'fields'>, b: Pick<TemplateLayout, 'fields'>): boolean {
  const common = Object.keys(a.fields).filter((f) => b.fields[f] && a.fields[f].page === b.fields[f].page);
  if (common.length < 3) return false;
  const centre = (box: TemplateBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const near = common.filter((f) => {
    const [p, q] = [centre(a.fields[f]), centre(b.fields[f])];
    return Math.abs(p.x - q.x) <= SAME_PLACE && Math.abs(p.y - q.y) <= SAME_PLACE;
  });
  return near.length * 3 >= common.length * 2;
}

/** A template whose boxes had to be moved on most invoices sent with it: not used when only the form (not the vendor) found it. */
export const distrusted = (t: Pick<StoredTemplate, 'timesSent' | 'timesCorrected'>) => t.timesSent >= 2 && t.timesCorrected * 2 > t.timesSent;
