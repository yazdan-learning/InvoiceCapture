// OCR text (or, for handwriting, the photo) of a receipt or invoice → structured
// fields (vendor, date, lines, totals). Taken from Nestmate's receipt scanner
// (same origin: the former "Invoice OCR (Mistral) + Groq" n8n flow), with the
// fields this app stores. Country-specific rules (Persian invoices, Shamsi
// dates, handwriting) come from the organization's country profile.

import { HandwritingRules, InvoiceRules } from '../../countries/country-profile';

/** Model settings for the extraction calls. */
export const EXTRACT_INVOICE = {
  model: 'fast',
  system: 'Extract structured invoice fields. Output JSON only.',
  temperature: 0.2,
  maxTokens: 8192
} as const;

const schema = (rules: InvoiceRules) => `{
  "invoiceNumber": string|null,
  "invoiceDate": ${rules.dateFormat},
  "dueDate": "YYYY-MM-DD"|null,
  "vendorName": string|null,
  "vendorAddress": string|null,
  "vendorTaxId": string|null,
  "customerName": string|null,
  "customerAddress": string|null,
  "items": [{"description": string, "quantity": number|null, "unitPrice": number|null, "totalPrice": number|null}],
  "subtotal": number|null,
  "discount": number|null,
  "taxRate": number|null,
  "taxAmount": number|null,
  "totalAmount": number|null,
  "currency": string|null,
  "paymentMethod": string|null,
  "paymentTerms": string|null,
  "notes": string|null`;

const SHARED_RULES = `Rules:
- Normalize Gregorian dates to YYYY-MM-DD; if missing, set null.
- Infer currency if possible (€, EUR -> "EUR"; $ -> "USD"); else null.
- Populate what you can; do not return everything null unless text is empty.
- Numbers: "5,95" and "5.95" both mean 5.95; never treat a price as a quantity.
- Each item: quantity defaults to 1 when no quantity is printed. A line that shows a single amount
  (e.g. a small fee or deposit such as an environmental contribution "ΕΙΣΦΟΡΑ ΠΡΟΣΤ ΠΕΡΙΒ", "Pfand",
  "deposit", "service charge") is ONE item: quantity 1, unitPrice = totalPrice = that amount.
- Quantity and weight lines are NOT items. German receipts print them under the item they belong to,
  e.g. "Hä. Pollo Fino 7,98" then "2 * 3,99" (or "2 x 3,99"), or "Bananen 1,05" then
  "0,624 kg x 1,69 EUR/kg". Merge such a line into the item above it (quantity 2, unitPrice 3.99,
  totalPrice 7.98) and keep that item's own product name as description. Never use a quantity line,
  a price or an article number as an item's description.
- totalPrice = quantity x unitPrice. The items' totalPrice values must add up to totalAmount
  (the amount actually paid), after any discount and VAT; if they don't, re-read the lines before answering.
- totalAmount = amount paid incl. VAT. subtotal = amount before VAT (net); if prices include VAT,
  subtotal = totalAmount - taxAmount. discount = a discount on the whole invoice, as a positive number; else null.
- VAT: read it from VAT/tax lines ("ΦΠΑ", "MwSt", "USt", "VAT", "TVA", "IVA"). taxRate = percent as a
  number (24 for 24%); with several rates set taxRate null and taxAmount = their sum.
- paymentMethod: how it was paid if printed (e.g. "card", "cash"); else null.`;

/** The shared rules, then the country's own. */
const rulesFor = (rules: InvoiceRules) => (rules.promptRules ? `${SHARED_RULES}\n${rules.promptRules}` : SHARED_RULES);

export function invoiceStructurePrompt(ocrText: string, rules: InvoiceRules): string {
  return `You are an invoice parser. Given OCR text, emit ONLY valid, compact JSON (one line, no markdown fences, no explanation) with this schema:
${schema(rules)}
}
${rulesFor(rules)}
OCR text:
${ocrText}`;
}

/**
 * The second look when the first reading didn't add up: the same rules, what
 * was wrong, and — when there is one — the image itself, because OCR of a
 * curved or tilted receipt can put prices a row off their names.
 */
export function invoiceRereadPrompt(ocrText: string, problems: string[], withPhoto: boolean, rules: InvoiceRules): string {
  return `${invoiceStructurePrompt(ocrText, rules)}

A first reading of this invoice was wrong:
${problems.map((p) => `- ${p}`).join('\n')}
${
  withPhoto
    ? 'The OCR text above may have the prices shifted against the item names (the photo was taken curved or at an angle). Use the attached photo of the invoice: follow each printed line straight across from the item name to the price on that same line.'
    : 'Re-read the OCR text carefully: prices may be shifted against the item names.'
}
Only real purchases are items: never the sum, payment or VAT lines. Copy every number as it is printed: never
change or invent a number just to make the sum match. Answer with the complete JSON again.`;
}

/**
 * Handwritten invoices: read from the photo by a vision model, since OCR loses
 * handwritten digits. The total in words and the fields the model wasn't sure
 * of come back too, so the user is told what to check. Only for countries
 * whose profile has handwriting rules; `today` is in the country's calendar.
 */
export function invoiceHandwrittenPrompt(rules: InvoiceRules & { handwriting: HandwritingRules }, today: string): string {
  return `You are an invoice parser. The attached photo is a HANDWRITTEN invoice, often a printed form filled in by
hand. Read it from the photo and emit ONLY valid, compact JSON (one line, no markdown fences, no explanation) with
this schema:
${schema(rules)},
  "totalInWords": string|null,
  "totalInWordsValue": number|null,
  "uncertainFields": string[]
}
${rulesFor(rules)}
Handwriting:
${rules.handwriting.promptRules(today)}
- Never invent a number to make sums match. Put the name of every field you could not read with confidence
  (e.g. "invoiceDate", "vendorName", "totalAmount", "items") into uncertainFields. If the seller's name can't be
  read anywhere, set vendorName null and list it in uncertainFields.`;
}
