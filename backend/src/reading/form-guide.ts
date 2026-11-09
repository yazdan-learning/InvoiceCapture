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
};

export const EMPTY_GUIDE: FormGuide = { sends: 0, labels: {}, notAfter: {}, totalParts: null, noItems: 0 };

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
    noItems: g.noItems ?? 0
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
function partsOf(ocrText: string, totalLabel: string, printedTotal: number): string[] | null {
  const first = labelKey(totalLabel).split(' ')[0];
  const parts = labelledAmounts(ocrText).filter((a) => labelKey(a.label) !== labelKey(totalLabel) && labelKey(a.label).split(' ')[0] === first);
  const labels = [...new Set(parts.map((p) => p.label))];
  if (labels.length < 2 || labels.length !== parts.length) return null;
  const sum = parts.reduce((s, p) => s + Math.round((printedAmount(p.text) ?? NaN) * 100), 0);
  return sum === Math.round(printedTotal * 100) ? labels : null;
}

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
        const same = before.totalParts && before.totalParts.labels.map(labelKey).join('|') === parts.map(labelKey).join('|');
        guide.totalParts = { labels: parts, seen: same ? before.totalParts!.seen + 1 : 1 };
      }
    }
  }
  if (!invoice.itemNames.length) guide.noItems = before.noItems + 1;
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
  // noItems is not said: told so, the model leaves lines out, and the checks need them (the charges are its lines).
  return lines;
}

/** The learned labels the OCR text of an invoice of the form should have (printed on every one): a text without one missed part of the page. */
export const guideRequiredLabels = (guide: FormGuide | undefined): string[] => (['totalAmount', 'invoiceNumber', 'invoiceDate'] as const).map((f) => learnedLabel(guide, f)).filter((l): l is string => !!l);

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
  if (!ocrText) return [];
  const problems: string[] = [];
  for (const field of guidedFields(guide)) {
    if (skip.includes(field)) continue;
    const label = learnedLabel(guide, field)!;
    const text = valueAfter(ocrText, label);
    if (!text) continue;
    const read = data[NAMES[field]];
    const kind = kindOf(field);
    let agrees: boolean | null;
    if (kind === 'amount') {
      const printed = storedAmount(text);
      agrees = printed === null ? null : Math.round(printed * 100) === Math.round(Number(read ?? NaN) * 100);
    } else if (kind === 'date') {
      const printed = printedDate(text);
      agrees = printed === null ? null : printed === String(read ?? '').slice(0, 10);
    } else {
      const norm = (s: unknown) => findableText(String(s ?? '')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      agrees = norm(text) === '' ? null : norm(text) === norm(read);
    }
    if (agrees === false) problems.push(`${field}: the form prints "${text}" after "${label}"`);
  }
  return problems;
}
