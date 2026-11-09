import type { OcrPage } from '@yazdan-learning/ai';
import { checkReading, CheckOptions, linesWithDiscountOrTax } from '@yazdan-learning/ai';
import { westernDigits } from '../ai/replies';
import type { ExtractedInvoiceData, ExtractionResult } from '../expenses/ports';
import { printedAmount, printedDate, regionText, wordsInRegion } from './box-text';
import { isPickableField, PICKABLE_FIELDS } from './fields';
import type { TemplateMatch } from './template-finder';
import { guideLines, guideProblems } from './form-guide';
import { moveLayout } from './template-match';
import { distrusted, ruledFields, StoredTemplate, TemplateBox, taxIdKey, valueAfter, vendorKey } from './templates';

// Reading with a template's help (template-guided reader, on upload), and
// checking that reading carefully before it is used:
// - hints: where the form prints each value and which printed words stand
//   next to it, added to the reading's prompt (the model still reads every
//   value from the document);
// - checks: each value the OCR is sure of inside the template's box (Tesseract)
//   agrees with the reading; the vendor is the template's (when found by the
//   vendor); the main values are there; the lines add up; one invoice;
// - while the template is new (TRUSTED_AFTER clean sends), the reading without
//   hints is made too and is the one used: the two are compared, to learn
//   whether the template's reading can be trusted.

/** A template is trusted after this many invoices sent with it without its boxes moved. */
export const TRUSTED_AFTER = 3;

/** Whether the template's guided reading is used on its own (else the plain reading is made as well, and used). */
export const isTrusted = (t: Pick<StoredTemplate, 'timesSent' | 'timesCorrected'>) => t.timesSent - t.timesCorrected >= TRUSTED_AFTER && !distrusted(t);

/** A box's words are compared when the OCR is this sure of them on average (a text PDF's are 1). */
const SURE_WORDS = 0.8;

/** Printed words on the same row this close (page fraction) to a box are its label. */
const LABEL_REACH = 0.3;
const ARABIC = /[؀-ۿ]/;

/** Where on the page a box is, in words. */
function place(box: TemplateBox): string {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const vertical = cy < 0.33 ? 'top' : cy < 0.66 ? 'middle' : 'bottom';
  const horizontal = cx < 0.33 ? 'left' : cx < 0.66 ? 'centre' : 'right';
  return `${vertical} ${horizontal}${box.page ? ` of page ${box.page + 1}` : ''} (about ${Math.round(cy * 100)}% down, ${Math.round(cx * 100)}% across)`;
}

/** The template's printed words on the box's row, nearest first (at most two): what the form prints next to the value. */
function labelOf(template: StoredTemplate, box: TemplateBox): string | null {
  const near = template.words
    .filter((w) => w.page === box.page && w.y >= box.y - 0.01 && w.y <= box.y + box.height + 0.01)
    .map((w) => ({ w, d: w.x < box.x ? box.x - w.x : w.x > box.x + box.width ? w.x - box.x - box.width : 0 }))
    .filter(({ d }) => d <= LABEL_REACH)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map(({ w }) => w);
  if (!near.length) return null;
  const rtl = near.some((w) => ARABIC.test(w.text));
  return near
    .sort((a, b) => (rtl ? b.x - a.x : a.x - b.x))
    .map((w) => w.text)
    .join(' ');
}

/** The prompt block that tells the model what is known about the document's form. */
/**
 * `withImage`: the model sees the page (handwriting, the image fallback), so
 * places on the page help; a reading of OCR text has no places — there only
 * the printed labels and the user's rules are given (places in text confused
 * it: a receipt's line items came back empty).
 */
export function templateHints(match: TemplateMatch, { withImage = false }: { withImage?: boolean } = {}): string {
  const { template, by } = match;
  const lines: string[] = [];
  const vendor = template.vendorName ? `"${template.vendorName}"` : 'a known vendor';
  lines.push(
    by === 'vendor'
      ? `KNOWN FORM: this invoice is on the layout of ${vendor}'s invoices, seen before (the vendor is most likely ${vendor}).`
      : `KNOWN FORM: this invoice is printed on the same form as ${vendor}'s invoices seen before; the vendor may be another one using the same printed form — read its name from this document.`
  );
  const ruled = ruledFields(template);
  const fieldLines: string[] = [];
  for (const [field, box] of Object.entries(template.fields)) {
    if (!isPickableField(field)) continue;
    const label = labelOf(template, box);
    const key = PICKABLE_FIELDS[field].readingKey;
    if (ruled.includes(field)) {
      const chosen = template.chosen[field];
      const where = chosen.label ? `the value printed right after "${chosen.label}"` : withImage ? `the value printed at ${place(box)}` : null;
      if (where) fieldLines.push(`- ${key}: RULE — on ${chosen.times} earlier invoices of this form the user chose ${where}. Take exactly that value, even when another value has a label that seems to fit better.`);
    } else if (withImage) {
      fieldLines.push(`- ${key}: ${place(box)}${label ? `, next to the printed words "${label}"` : ''}`);
    }
    // Reading OCR text: only the user's rules. Labels from word OCR are guesses on Persian scans ("هنگام هیچگونه").
  }
  if (withImage && template.items) {
    const { y, rowHeight } = template.items;
    fieldLines.push(`- items: a table starting about ${Math.round(y * 100)}% down the page, one line item per row (rows about ${Math.round(rowHeight * 1000) / 10}% of the page high)`);
  }
  if (fieldLines.length) {
    lines.push(
      withImage
        ? 'Where this form prints its values (use it to find them; read every value from this document itself; where the document differs, the document is right):'
        : "The user's choices for this form:",
      ...fieldLines
    );
  }
  // What the form prints before each value, learned from every invoice sent from it: text a text model can follow.
  const guide = guideLines(template.guide, ruled);
  if (guide.length) {
    lines.push(`How this form prints its values (learned from ${template.guide.sends} invoices sent from it; read each value from this document):`, ...guide);
  }
  // Without this the model read only the fields named here and left the line items out.
  lines.push('Read every other value and every line item as you normally would.');
  return `\n\n${lines.join('\n')}`;
}

/** The reading's own JSON, in the units printed on the invoice. */
const printedData = (result: ExtractionResult): Record<string, unknown> => {
  const data = (result.raw as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
};

/** Letters and Western digits only, lower case ("۸۱۲۳۴" and "81234" are the same number). */
const compact = (s: string) => westernDigits(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Whether the text in a box and the value read agree, for the field's kind. Null when the box says nothing useful. */
function agrees(field: string, boxText: string, result: ExtractionResult): boolean | null {
  const { kind, readingKey } = PICKABLE_FIELDS[field];
  if (kind === 'amount') {
    const printed = printedAmount(boxText);
    const read = Number(printedData(result)[readingKey]);
    if (printed === null) return null;
    return Number.isFinite(read) && Math.round(Math.abs(printed) * 100) === Math.round(Math.abs(read) * 100);
  }
  if (kind === 'date') {
    const printed = printedDate(boxText);
    if (printed === null) return null;
    return printed === result.data?.[field as 'invoiceDate'];
  }
  if (field === 'invoiceNumber') {
    const read = compact(String(result.data?.invoiceNumber ?? ''));
    const box = compact(boxText);
    if (box.length < 2) return null;
    return read.length > 0 && (box.includes(read) || read.includes(box));
  }
  return null;
}

/** The main values every invoice of a form has: one the template has a box for but the reading lacks is a problem. */
const MAIN_FIELDS = ['totalAmount', 'invoiceDate', 'invoiceNumber'] as const;

const CHECKS: CheckOptions = { totalMatches: linesWithDiscountOrTax };

/**
 * Why a reading guided by a template can't be used as it is (none: it can).
 * `pages`: the word OCR of the document (null: no box comparisons — handwriting, no word OCR).
 */
export function checkGuidedReading(
  result: ExtractionResult,
  match: TemplateMatch,
  pages: OcrPage[] | null,
  /** The OCR text the reading was made from, to compare with what the form prints after its learned labels. */
  text?: { ocrText: string | null; storedAmount: (printed: string) => number | null }
): string[] {
  const data = result.data;
  if (!data) return ['nothing was read'];
  const problems: string[] = [];
  if (result.more?.length) problems.push('several invoices in the file');

  if (match.by === 'vendor') {
    const { vendorTaxId, vendorKey: key } = match.template;
    const taxId = taxIdKey(data.vendorTaxId);
    const name = vendorKey(data.vendorName);
    const sameTaxId = taxId !== null && vendorTaxId !== null && taxId === vendorTaxId;
    const sameName = name !== null && key !== null && (name === key || name.includes(key) || key.includes(name));
    if (!sameTaxId && !sameName) problems.push(`vendor read as "${data.vendorName ?? ''}", the template is ${match.template.vendorName ?? 'another vendor'}'s`);
  }

  for (const field of MAIN_FIELDS) {
    if (match.template.fields[field] && (data[field] === null || data[field] === undefined || data[field] === '')) problems.push(`${field} missing`);
  }

  if (pages) {
    const moved = moveLayout(match.template, match.transforms);
    // A field the user made a rule of is taken from its box afterwards (withRuledFields): not a disagreement.
    const ruled = ruledFields(match.template);
    for (const [field, box] of Object.entries(moved.fields)) {
      if (!isPickableField(field) || ruled.includes(field) || !pages[box.page]) continue;
      const inside = wordsInRegion(pages[box.page], box);
      if (!inside.length || inside.reduce((sum, w) => sum + w.confidence, 0) / inside.length < SURE_WORDS) continue;
      const text = regionText(inside);
      if (agrees(field, text, result) === false) problems.push(`${field}: the form's box shows "${text}"`);
    }
  }

  if (text) problems.push(...guideProblems(match.template.guide, data as unknown as Record<string, unknown>, text.ocrText, text.storedAmount, ruledFields(match.template)));

  if (checkReading(data, CHECKS).problems.some((p) => p.code === 'total_mismatch')) problems.push("the lines don't add up to the total");
  return problems;
}

const sameText = (a: string | null | undefined, b: string | null | undefined) => compact(a ?? '') === compact(b ?? '');
const sameAmount = (a: number | null | undefined, b: number | null | undefined) => Math.round((a ?? 0) * 100) === Math.round((b ?? 0) * 100) && (a == null) === (b == null);

/** The fields where two readings of the same document differ (guided vs plain, while a template is new). */
export function differences(a: ExtractedInvoiceData | undefined, b: ExtractedInvoiceData | undefined): string[] {
  if (!a || !b) return a === b ? [] : ['everything'];
  const diff: string[] = [];
  if (vendorKey(a.vendorName) !== vendorKey(b.vendorName)) diff.push('vendorName');
  for (const f of ['invoiceNumber', 'invoiceDate', 'vendorTaxId'] as const) if (!sameText(a[f], b[f])) diff.push(f);
  for (const f of ['totalAmount', 'subtotal', 'taxAmount', 'discount'] as const) if (!sameAmount(a[f], b[f])) diff.push(f);
  if (a.items.length !== b.items.length) diff.push('items');
  else if (a.items.some((item, i) => !sameAmount(item.totalPrice, b.items[i].totalPrice))) diff.push('items');
  return diff;
}

/**
 * A ruled box's words are taken only when the OCR is this sure of them on average:
 * small print on a low-resolution scan comes out as garbage ("F-LO-005" read as
 * "T 303" at 0.36–0.65). Below it the model's reading, told the rule, stands.
 */
const RULE_WORDS = SURE_WORDS;

/**
 * The reading with the fields the user made a rule of (chosen on RULE_AFTER
 * invoices) taken from the document: the value after the rule's label in the
 * OCR text (exact), else the words in its box when word OCR is sure of them.
 * The user's choice beats the model's. Returns the fields it changed.
 */
export function withRuledFields(
  result: ExtractionResult,
  match: TemplateMatch,
  pages: OcrPage[] | null,
  ocrText: string | null,
  /** An amount as printed in the form's stored units (Toman as Rial); null when it isn't one. */
  storedAmount: (printed: string) => number | null = (printed) => printedAmount(printed)
): { result: ExtractionResult; ruled: string[] } {
  const ruled = ruledFields(match.template);
  if (!result.data || !ruled.length) return { result, ruled: [] };
  const moved = moveLayout(match.template, match.transforms);
  const data = { ...result.data } as Record<string, unknown>;
  const set: string[] = [];
  for (const field of ruled) {
    const { label } = match.template.chosen[field];
    let text = label && ocrText ? valueAfter(ocrText, label) : null;
    const box = moved.fields[field];
    if (!text && box && pages?.[box.page]) {
      const inside = wordsInRegion(pages[box.page], box);
      if (inside.length && inside.reduce((sum, w) => sum + w.confidence, 0) / inside.length >= RULE_WORDS) text = regionText(inside).trim() || null;
    }
    if (!text) continue;
    if (PICKABLE_FIELDS[field].kind === 'amount') {
      const value = storedAmount(text);
      if (value === null) continue;
      if (Math.round(value * 100) !== Math.round(Number(data[field] ?? NaN) * 100)) set.push(field);
      data[field === 'discountAmount' ? 'discount' : field] = value;
      continue;
    }
    if (compact(text) !== compact(String(data[field] ?? ''))) set.push(field);
    data[field] = text;
  }
  return { result: set.length ? { ...result, data: data as ExtractedInvoiceData } : result, ruled: set };
}

/** What the template did for a reading, kept in rawExtraction.template.match (the review page uses its boxes when the reading held). */
export type GuidedOutcome = {
  id: string;
  by: TemplateMatch['by'];
  vendorName: string | null;
  /**
   * used: the guided reading passed every check and was used. fell-back: it failed one, the plain
   * reading was made and used. compared: the template is new, both were made, the plain one used.
   */
  outcome: 'used' | 'fell-back' | 'compared';
  problems: string[];
  /** compared: the fields where the guided reading differs from the plain one. */
  differences?: string[];
  /** The fields taken from their box by the user's rule (withRuledFields), overriding what was read. */
  ruled?: string[];
  /** The guided reading was made with the cheaper model (LLM_MODEL_TEMPLATE). */
  cheapModel?: boolean;
};
