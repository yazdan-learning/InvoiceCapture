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
between groups of three digits are thousands separators (۱.۲۵۰.۰۰۰ = 1250000). Digits may be written one per box:
read every box, including each 0. A dash after digits ("۴۵—") stands for trailing zeros.`,
  date: `Return the date as printed: "YYYY/MM/DD" with the Shamsi year for a Shamsi date (۱۴۰۳/۱۱/۰۸ = "1403/11/08"),
or "YYYY-MM-DD" for a Gregorian date. Never convert between calendars.`
};

/**
 * The first image is the whole page with the user's region framed in red, the
 * second that region enlarged: a crop alone loses what helps read handwriting
 * (the total in words, the column sums, the other dates). `handwriting` is the
 * country's handwriting rules for a handwritten invoice; `today` is in the
 * country's calendar.
 */
export function readRegionPrompt(kind: FieldKind, label: string, today: string, handwriting?: string): string {
  return `The first attached image is a page of an invoice${handwriting ? ' filled in by hand' : ''} on which the user framed a region in red; the
second image is that region enlarged. Read ${label} written inside the red frame. ${KIND_RULES[kind]}
Use the rest of the page only to read the framed value better, never take a value from outside the frame: for an
amount, the line totals and the total in words show which digits are right; for a date, today is ${today} and an
invoice is almost always from the last few months, so a year far from today's is most likely a misread digit.${
    handwriting ? `\nHandwriting:\n${handwriting}` : ''
  }
If the frame holds no such value, value is null.
Emit ONLY compact JSON (no markdown fences): {"value": string|null}`;
}
