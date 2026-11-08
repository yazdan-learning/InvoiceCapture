// Where on the page each field was read (for the boxes on the review page),
// and reading one region the user drew ("pick from photo"). Both look at the
// page images of backend/src/reading/page-images.ts.

import { FieldKind } from '../../reading/fields';

/** Model settings for locating the fields: one answer with a box per field and line item. */
export const LOCATE_FIELDS = {
  model: 'fast',
  system: 'Locate invoice fields on page images. Output JSON only.',
  temperature: 0,
  maxTokens: 4096
} as const;

export type LocateTarget = { field: string; label: string; value: string };

export function locateFieldsPrompt(fields: LocateTarget[], items: LocateTarget[], pageCount: number): string {
  const list = (targets: LocateTarget[]) => targets.map((t) => `- ${t.field} (${t.label}): ${JSON.stringify(t.value)}`).join('\n');
  return `The attached image${pageCount > 1 ? `s are pages 0 to ${pageCount - 1}` : ' is page 0'} of one invoice document${
    pageCount > 1 ? ', in order' : ''
  }. For each field below, find where its value is printed or handwritten and return a tight box around the
value itself, not around its label. The value given is what was read: it may be slightly wrong, or written
with other digits (Persian ۱۲۳ or Western 123) and with or without thousands separators, so find the field by
its meaning and its label too.${items.length ? ' For each line item, return one box around that whole row of the items table.' : ''}
Leave out any field you cannot find on the page; never guess a position.
Emit ONLY compact JSON (no markdown fences): {"boxes": [{"field": string, "page": number, "box_2d": [ymin, xmin, ymax, xmax]}]}
with box_2d in 0-1000 of that page's height and width.
Fields:
${list(fields)}${items.length ? `\nLine items:\n${list(items)}` : ''}`;
}

/** Model settings for reading one drawn region. */
export const READ_REGION = {
  model: 'fast',
  system: 'Read one field from a cropped invoice region. Output JSON only.',
  temperature: 0,
  maxTokens: 256
} as const;

const KIND_RULES: Record<FieldKind, string> = {
  text: 'Copy the text as written: keep Persian or other text as it is, and write any digits as Western digits (0-9).',
  amount: `Return the amount as a plain number with Western digits (0-9) and no separators: ",", "٬", "." or "/"
between groups of three digits are thousands separators (۱.۲۵۰.۰۰۰ = 1250000); a "," or "." before only two digits
at the end is the decimal mark (14,97 = 14.97). Digits may be written one per box:
read every box, including each 0. A dash after digits ("۴۵—") stands for trailing zeros.`,
  date: `Return the date as printed: "YYYY/MM/DD" with the Shamsi year for a Shamsi date (۱۴۰۳/۱۱/۰۸ = "1403/11/08"),
or "YYYY-MM-DD" for a Gregorian date. Never convert between calendars.`
};

/** What a framed region can hold, when it isn't what the user framed it as (`looksLike`): shown to the user. */
export const LOOKS_LIKE = [
  'vendorName',
  'vendorAddress',
  'vendorTaxId',
  'customerName',
  'customerAddress',
  'invoiceNumber',
  'date',
  'amount',
  'phone',
  'other'
] as const;
export type LooksLike = (typeof LOOKS_LIKE)[number];

/**
 * Printed invoices: the region framed in red with some of the page around it
 * (its label shows what it is), enlarged. Handwritten (`withPage`): first the
 * whole page with the region framed, then the region enlarged, since a crop
 * alone loses what helps read handwriting (the total in words, the column
 * sums, the other dates). `handwriting` is the country's handwriting rules;
 * `today` is in the country's calendar. The model reads the value and says
 * whether it fits what the user framed it as.
 */
export function readRegionPrompt(kind: FieldKind, label: string, today: string, options: { withPage: boolean; handwriting?: string }): string {
  const { withPage, handwriting } = options;
  const images = withPage
    ? `The first attached image is a page of an invoice${handwriting ? ' filled in by hand' : ''} on which the user framed a region in red; the
second image is that region enlarged.`
    : `The attached image is part of an invoice page, enlarged, with a region the user framed in red.`;
  const context = withPage
    ? `Use the rest of the page only to read the framed characters better, never take a value from outside the frame: for
an amount, the line totals and the total in words show which digits are right; for a date, today is ${today} and an
invoice is almost always from the last few months, so a year far from today's is most likely a misread digit.`
    : `Never take a value from outside the frame. For a date, today is ${today} and an invoice is almost always from the
last few months, so a year far from today's is most likely a misread digit.`;
  return `${images} The user framed it as ${label}: read what is written inside the red frame.
${KIND_RULES[kind]}
${context}${handwriting ? `\nHandwriting:\n${handwriting}` : ''}
Always give the value, even if it seems to be something else. Also say whether it fits: "fits" is false only when the
framed text is clearly something other than ${label} — its printed label or what it says shows that (for example the
customer's name or address where the seller's is asked for, a phone number where an amount is asked for); then
"looksLike" is what it is, one of: ${LOOKS_LIKE.join(', ')}. When in doubt, it fits.
value is null only when nothing is written inside the frame${kind === 'text' ? '' : ` or it holds no ${kind}`}.
Emit ONLY compact JSON (no markdown fences): {"value": string|null, "fits": boolean, "looksLike": string|null}`;
}
