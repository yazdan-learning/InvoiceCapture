import { printedAmount, printedDate } from './box-text';
import { PICKABLE_FIELDS } from './fields';
import { findableText, labelKey, labelledAmounts, labelsBefore, valueAfter } from './templates';

// The form guide: what a form prints before each of its values, learned from
// the OCR text of every invoice sent from it — not only the fields the user
// corrected (those are the rules, `chosen`). The reading of OCR text (a text
// model: no page, no places) gets it as text it can follow ("the date after
// 'تاریخ و ساعت ارسال'"), and the guided reading is checked against it. A
// label is learned only where the sent value is printed right after it, so a
// wrong value sent (a total the OCR made up) teaches nothing. Labels and
// counts only, never a value: the guide is shared with the template.

/** One label a field's value was printed after, and on how many sent invoices. */
export type GuideLabel = { label: string; seen: number };

export type FormGuide = {
  /** Sent invoices the guide was learned from (the ones with OCR text). */
  sends: number;
  /** Per field, the labels its sent value was printed after (most seen first). */
  labels: Record<string, GuideLabel[]>;
  /** Per field the user corrected: the label before the value the reading wrongly took. */
  notAfter: Record<string, GuideLabel[]>;
  /** The labelled amounts printed with the total that add up to it ("هزینه پایه" + "هزینه مازاد" + …). */
  totalParts: { labels: string[]; seen: number } | null;
  /** Sent invoices without line items. */
  noItems: number;
  /** Per field the form may not print at all (tax, discount): on how many sent invoices it was empty, of how many. */
  empty: Record<string, { none: number; of: number }>;
  /**
   * Sent invoices whose line items were the total's parts, named as printed (ونوس: "هزینه پایه",
   * "هزینه مازاد" — form text, not products), and of those, how many left out the parts that were 0.
   */
  itemsFromParts: { seen: number; skipZero: number };
};

export const EMPTY_GUIDE: FormGuide = { sends: 0, labels: {}, notAfter: {}, totalParts: null, noItems: 0, empty: {}, itemsFromParts: { seen: 0, skipZero: 0 } };

/** Fields a form may not print at all: told so, the model doesn't make one up. */
const ABSENT_FIELDS = ['taxAmount', 'discountAmount'] as const;

/** A label goes into the prompt and the checks once the sent value followed it on this many invoices … */
export const GUIDE_AFTER = 2;

/** The fields a guide learns: the ones printed after a label. Not the vendor's name (a heading or stamp) or address (often the customer's). */
export const GUIDE_FIELDS = ['invoiceNumber', 'invoiceDate', 'dueDate', 'vendorTaxId', 'totalAmount', 'subtotal', 'taxAmount', 'discountAmount'] as const;
export type GuideField = (typeof GUIDE_FIELDS)[number];

/** Words of a total's label: where the total is printed after several labels (its parts too), this one is it. */
const TOTAL_WORDS = /کل|جمع|پرداخت|نهایی|total|summe|gesamt|betrag|toplam|razem|suma|do zapłaty/iu;

export function guideOf(value: unknown): FormGuide {
  const g = (value ?? {}) as Partial<FormGuide>;
  return {
    sends: g.sends ?? 0,
    labels: g.labels ?? {},
    notAfter: g.notAfter ?? {},
    totalParts: g.totalParts ?? null,
    noItems: g.noItems ?? 0,
    empty: g.empty ?? {},
    itemsFromParts: g.itemsFromParts ?? { seen: 0, skipZero: 0 }
  };
}

/** A sent invoice, as the guide learns from it. */
export type SentInvoice = {
  ocrText: string;
  /** The values sent: amounts in stored units, dates as YYYY-MM-DD. */
  values: Partial<Record<GuideField, string | number | null>>;
  /** The values as first read, before the user's changes (same units). */
  read: Partial<Record<GuideField, string | number | null>>;
  /** The line items' names: a value after one of them is a line, not a label. */
  itemNames: string[];
  /** Printed amount = stored ÷ factor: [1], or [1, 10] where Toman is stored as Rial. */
  amountFactors: number[];
};

const present = (v: unknown): v is string | number => v !== null && v !== undefined && v !== '';
const kindOf = (field: string) => PICKABLE_FIELDS[field].kind;

/** The labels a field's value is printed after in the text, and for an amount the value as printed. */
function labelsOf(field: GuideField, value: string | number, invoice: SentInvoice): string[] {
  return printedLabels(field, value, invoice).labels;
}

function printedLabels(field: GuideField, value: string | number, invoice: SentInvoice): { labels: string[]; printed: number | null } {
  const { ocrText, itemNames, amountFactors } = invoice;
  if (kindOf(field) === 'amount') {
    const stored = Number(value);
    if (!Number.isFinite(stored) || stored === 0) return { labels: [], printed: null };
    for (const factor of amountFactors) {
      const printed = Math.round((stored / factor) * 100) / 100;
      const labels = labelsBefore(ocrText, String(printed), { amount: true, skip: itemNames });
      if (labels.length) return { labels, printed };
    }
    return { labels: [], printed: null };
  }
  return { labels: otherLabels(field, value, invoice), printed: null };
}

function otherLabels(field: GuideField, value: string | number, invoice: SentInvoice): string[] {
  const { ocrText, itemNames } = invoice;
  const kind = kindOf(field);
  if (kind === 'date') {
    const iso = String(value).slice(0, 10);
    const labels: string[] = [];
    for (const m of findableText(ocrText).matchAll(/\d{1,4}\s*[./\-]\s*\d{1,2}\s*[./\-]\s*\d{1,4}/g)) {
      if (printedDate(m[0]) !== iso) continue;
      for (const label of labelsBefore(ocrText, m[0])) if (!labels.includes(label)) labels.push(label);
    }
    return labels;
  }
  const text = String(value).trim();
  return text.length >= 2 ? labelsBefore(ocrText, text, { skip: itemNames }) : [];
}

/** The one label to learn for a value printed after several: a total's own label (its words, else the last: totals follow their parts), else the first. */
function oneLabel(field: GuideField, labels: string[]): string | null {
  if (!labels.length) return null;
  if (field !== 'totalAmount') return labels[0];
  return labels.find((l) => TOTAL_WORDS.test(l)) ?? labels[labels.length - 1];
}

/** One more sighting of a label among a field's labels, most seen first. */
function counted(list: GuideLabel[] | undefined, label: string): GuideLabel[] {
  const key = labelKey(label);
  const rest = (list ?? []).filter((l) => labelKey(l.label) !== key);
  const seen = ((list ?? []).find((l) => labelKey(l.label) === key)?.seen ?? 0) + 1;
  return [...rest, { label, seen }].sort((a, b) => b.seen - a.seen).slice(0, 4);
}

/** The labelled amounts that add up to the total, printed with labels like its own ("هزینه …" with "هزینه کل"). */
function partsOf(ocrText: string, totalLabel: string, printedTotal: number): { label: string; cents: number }[] | null {
  const first = labelKey(totalLabel).split(' ')[0];
  const parts = labelledAmounts(ocrText)
    .filter((a) => labelKey(a.label) !== labelKey(totalLabel) && labelKey(a.label).split(' ')[0] === first)
    .map((a) => ({ label: a.label, cents: Math.round((printedAmount(a.text) ?? NaN) * 100) }));
  if (new Set(parts.map((p) => labelKey(p.label))).size !== parts.length || parts.length < 2) return null;
  return parts.reduce((s, p) => s + p.cents, 0) === Math.round(printedTotal * 100) ? parts : null;
}

/** A label without its unit ("هزینه پایه (ریال)" → "هزینه پایه"), to compare with a line item's name. */
const bare = (label: string) => labelKey(label).replace(/\s*\([^)]*\)\s*$/, '').trim();

/** The guide after one more invoice sent from the form. */
export function learnGuide(before: FormGuide, invoice: SentInvoice): FormGuide {
  const guide: FormGuide = { ...before, labels: { ...before.labels }, notAfter: { ...before.notAfter }, sends: before.sends + 1 };
  for (const field of GUIDE_FIELDS) {
    const value = invoice.values[field];
    if (!present(value)) continue;
    const found = printedLabels(field, value, invoice);
    const label = oneLabel(field, found.labels);
    if (label) guide.labels[field] = counted(guide.labels[field], label);

    // The user corrected it: what the reading took is printed after another label, which is not this field's.
    const read = invoice.read[field];
    if (present(read) && String(read) !== String(value)) {
      const wrong = labelsOf(field, read, invoice).find((l) => !label || labelKey(l) !== labelKey(label));
      if (wrong) guide.notAfter[field] = counted(guide.notAfter[field], wrong);
    }

    if (field === 'totalAmount' && label && found.printed !== null) {
      const parts = partsOf(invoice.ocrText, label, found.printed);
      if (parts) {
        const labels = parts.map((p) => p.label);
        const same = before.totalParts && before.totalParts.labels.map(labelKey).join('|') === labels.map(labelKey).join('|');
        guide.totalParts = { labels, seen: same ? before.totalParts!.seen + 1 : 1 };
        // The line items sent were these parts by name: the form's charges are its lines.
        const names = invoice.itemNames.map(bare);
        if (names.length && names.every((n) => parts.some((p) => bare(p.label) === n))) {
          const nonZero = parts.filter((p) => p.cents !== 0).length;
          const skippedZero = parts.length > nonZero && names.length === nonZero;
          const was = guideOf(before).itemsFromParts;
          guide.itemsFromParts = { seen: was.seen + 1, skipZero: was.skipZero + (skippedZero ? 1 : 0) };
        }
      }
    }
  }
  if (!invoice.itemNames.length) guide.noItems = before.noItems + 1;
  guide.empty = { ...guideOf(before).empty };
  for (const field of ABSENT_FIELDS) {
    const value = invoice.values[field];
    const none = !present(value) || Number(value) === 0;
    const was = guide.empty[field] ?? { none: 0, of: 0 };
    guide.empty[field] = { none: was.none + (none ? 1 : 0), of: was.of + 1 };
  }
  return guide;
}

/** A field's learned label: the one its value followed on GUIDE_AFTER invoices or more, and on most of those it was found on; null if none or two tie. */
export function learnedLabel(given: FormGuide | undefined, field: string): string | null {
  const labels = guideOf(given).labels[field] ?? [];
  const [best, next] = labels;
  // Most of the invoices where the value was found at all: one sent with a wrong value (not printed) is no vote.
  const found = labels.reduce((sum, l) => sum + l.seen, 0);
  if (!best || best.seen < GUIDE_AFTER || best.seen * 2 <= found) return null;
  return next && next.seen === best.seen ? null : best.label;
}

/** The labels the reading must not take a field's value from. */
const learnedNotAfter = (guide: FormGuide, field: string) => (guideOf(guide).notAfter[field] ?? []).filter((l) => l.seen >= 1).map((l) => l.label);

/** The fields with a learned label. */
export const guidedFields = (guide: FormGuide | undefined) => GUIDE_FIELDS.filter((f) => learnedLabel(guide, f));

/** Whether the guide has something to say: any learned label. */
export const hasGuide = (guide: FormGuide | undefined) => guidedFields(guide).length > 0;

const NAMES: Record<GuideField, string> = {
  invoiceNumber: 'invoiceNumber',
  invoiceDate: 'invoiceDate',
  dueDate: 'dueDate',
  vendorTaxId: 'vendorTaxId',
  totalAmount: 'totalAmount',
  subtotal: 'subtotal',
  taxAmount: 'taxAmount',
  discountAmount: 'discount'
};

/** The prompt lines that describe the form in text: the label before each value and the total's parts. `skip`: fields with a user rule (said already). */
export function guideLines(given: FormGuide | undefined, skip: string[] = []): string[] {
  const guide = guideOf(given);
  const lines: string[] = [];
  for (const field of GUIDE_FIELDS) {
    if (skip.includes(field)) continue;
    const label = learnedLabel(guide, field);
    const not = learnedNotAfter(guide, field).filter((l) => !label || labelKey(l) !== labelKey(label));
    if (!label && !not.length) continue;
    const what = kindOf(field) === 'date' ? 'the date' : kindOf(field) === 'amount' ? 'the amount' : 'the value';
    let line = `- ${NAMES[field]}: ${label ? `${what} printed right after "${label}"` : ''}`;
    if (not.length) line += `${label ? ', ' : ''}not the one after ${not.map((l) => `"${l}"`).join(' or ')}`;
    if (field === 'totalAmount' && label && guide.totalParts && guide.totalParts.seen >= GUIDE_AFTER) {
      line += `. The form adds ${guide.totalParts.labels.map((l) => `"${l}"`).join(' + ')} up to it: take the printed total, don't add it up yourself`;
    }
    lines.push(line);
  }
  // What the form doesn't print, on every invoice sent: said, so the model doesn't make one up.
  const absent = ABSENT_FIELDS.filter((f) => !skip.includes(f) && !learnedLabel(guide, f)).filter((f) => {
    const e = guide.empty[f];
    return e && e.of >= GUIDE_AFTER && e.none === e.of;
  });
  if (absent.length) {
    const of = Math.min(...absent.map((f) => guide.empty[f].of));
    lines.push(`- ${absent.map((f) => NAMES[f]).join(' and ')}: this form has printed none on its last ${of} invoices: leave ${absent.length > 1 ? 'them' : 'it'} empty unless this one clearly prints one.`);
  }
  // Its line items, when they were the total's parts by name (form text, so it can be said).
  const items = guide.itemsFromParts;
  if (guide.totalParts && items.seen >= GUIDE_AFTER) {
    const names = guide.totalParts.labels.map((l) => `"${bare(l)}"`).join(', ');
    lines.push(`- items: one line per charge printed with the total (${names}), named as printed, with its amount${items.skipZero >= GUIDE_AFTER ? '; leave out the charges that are 0' : ''}.`);
  }
  // noItems is not said: told so, the model leaves lines out, and the checks need them (the charges are its lines).
  return lines;
}

/** The learned labels the OCR text of an invoice of the form should have (printed on every one): a text without one missed part of the page. */
export const guideRequiredLabels = (guide: FormGuide | undefined): string[] => (['totalAmount', 'invoiceNumber', 'invoiceDate'] as const).map((f) => learnedLabel(guide, f)).filter((l): l is string => !!l);

/** What the form prints after each learned label in this document's OCR text: the text, and the value it stands for (null: not readable as one). */
function printedValues(
  guide: FormGuide | undefined,
  ocrText: string | null,
  storedAmount: (printed: string) => number | null,
  skip: string[]
): { field: GuideField; label: string; text: string; value: number | string | null }[] {
  if (!ocrText) return [];
  const found: { field: GuideField; label: string; text: string; value: number | string | null }[] = [];
  for (const field of guidedFields(guide)) {
    if (skip.includes(field)) continue;
    const label = learnedLabel(guide, field)!;
    const text = valueAfter(ocrText, label);
    if (!text) continue;
    const kind = kindOf(field);
    const value = kind === 'amount' ? storedAmount(text) : kind === 'date' ? printedDate(text) : norm(text) ? text : null;
    found.push({ field, label, text, value });
  }
  return found;
}

const norm = (s: unknown) => findableText(String(s ?? '')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Whether a read value is the printed one. */
function same(field: GuideField, value: number | string, read: unknown): boolean {
  const kind = kindOf(field);
  if (kind === 'amount') return Math.round(Number(value) * 100) === Math.round(Number(read ?? NaN) * 100);
  if (kind === 'date') return value === String(read ?? '').slice(0, 10);
  return norm(value) === norm(read);
}

/**
 * Where a guided reading disagrees with what the form prints after a learned
 * label in this document's OCR text (none when the label isn't there).
 * `storedAmount`: an amount as printed, in stored units.
 */
export function guideProblems(
  guide: FormGuide | undefined,
  data: Record<string, unknown>,
  ocrText: string | null,
  storedAmount: (printed: string) => number | null,
  skip: string[] = []
): string[] {
  return printedValues(guide, ocrText, storedAmount, skip)
    .filter((p) => p.value !== null && !same(p.field, p.value, data[NAMES[p.field]]))
    .map((p) => `${p.field}: the form prints "${p.text}" after "${p.label}"`);
}

/**
 * The reading with each learned field set to what the form prints after its
 * label (fix instead of a second reading: free and exact). Returns the fields it changed.
 */
export function withGuideFields(
  guide: FormGuide | undefined,
  data: Record<string, unknown>,
  ocrText: string | null,
  storedAmount: (printed: string) => number | null,
  skip: string[] = []
): { data: Record<string, unknown>; fixed: GuideField[] } {
  const fixed: GuideField[] = [];
  const next = { ...data };
  for (const p of printedValues(guide, ocrText, storedAmount, skip)) {
    if (p.value === null || same(p.field, p.value, data[NAMES[p.field]])) continue;
    next[NAMES[p.field]] = p.value;
    fixed.push(p.field);
  }
  return { data: next, fixed };
}

/** The cheaper model is judged on a form after this many readings of it. */
export const CHEAP_JUDGED_AFTER = 4;

/** Whether the cheaper model usually fails this form's checks (more than half of its readings, after CHEAP_JUDGED_AFTER). */
export const cheapUsuallyFails = (t: { cheapReads?: number; cheapFailed?: number }) =>
  (t.cheapReads ?? 0) >= CHEAP_JUDGED_AFTER && (t.cheapFailed ?? 0) * 2 > (t.cheapReads ?? 0);

/**
 * The reading without the form's 0 charges as lines, when the invoices sent from
 * it left them out (the model keeps them even when told): done in code, exact.
 */
export function withoutZeroCharges<T extends { items: { description: string; totalPrice: number | null }[] }>(given: FormGuide | undefined, data: T): T {
  const guide = guideOf(given);
  if (!guide.totalParts || guide.itemsFromParts.skipZero < GUIDE_AFTER) return data;
  const charges = new Set(guide.totalParts.labels.map(bare));
  const items = data.items.filter((i) => !(charges.has(bare(i.description ?? '')) && Math.round((i.totalPrice ?? 0) * 100) === 0));
  return items.length === data.items.length || !items.length ? data : { ...data, items };
}
