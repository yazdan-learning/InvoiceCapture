import { ExtractedInvoiceData } from '../expenses/ports';
import { jalaliToIso } from './jalali';

// Model output is untrusted: parsed defensively and every field re-typed here.

/** The model's answer → object. Throws with a message fit for the user. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  let payload: unknown;
  try {
    payload = JSON.parse(start >= 0 && end > start ? s.substring(start, end + 1) : s);
  } catch {
    throw new Error('The AI returned an incomplete or invalid answer - please try again');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The AI returned an empty answer - please try again');
  return payload as Record<string, unknown>;
}

/** Persian (۰-۹) and Arabic (٠-٩) digits → 0-9. */
export const westernDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

export const num = (v: unknown) => {
  // Models sometimes answer "76,000,000" or Persian digits despite the schema.
  const n = typeof v === 'string' && v.trim() ? Number(westernDigits(v).replace(/\s/g, '').replace(/[,٬](?=\d{3}(\D|$))/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
// Gregorian as is; a Shamsi date (Persian invoices) is converted here, not by the model.
const date = (v: unknown) => {
  const s = text(v) && westernDigits(text(v)!);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1900 ? s : jalaliToIso(s);
};

/**
 * Toman has no currency code: a Toman invoice (read as "IRT") is stored as IRR,
 * 1 Toman = 10 Rial, with the printed Toman total kept in the notes.
 */
export function tomanToRial(data: ExtractedInvoiceData): ExtractedInvoiceData {
  if (!/^(IRT|TOMAN|تومان)$/i.test(data.currency ?? '')) return data;
  const x10 = (v: number | null | undefined) => (typeof v === 'number' ? v * 10 : null);
  return {
    ...data,
    items: data.items.map((item) => ({ ...item, unitPrice: x10(item.unitPrice), totalPrice: x10(item.totalPrice) })),
    subtotal: x10(data.subtotal),
    discount: x10(data.discount),
    taxAmount: x10(data.taxAmount),
    totalAmount: x10(data.totalAmount),
    currency: 'IRR',
    notes: [data.notes, `Converted from Toman (x10)${data.totalAmount !== null ? `: invoice total ${data.totalAmount.toLocaleString('en')} Toman` : ''}`].filter(Boolean).join(' - ')
  };
}

export function toInvoiceData(data: Record<string, unknown>): ExtractedInvoiceData {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    invoiceNumber: text(data.invoiceNumber),
    invoiceDate: date(data.invoiceDate),
    dueDate: date(data.dueDate),
    vendorName: text(data.vendorName),
    vendorAddress: text(data.vendorAddress),
    vendorTaxId: text(data.vendorTaxId),
    customerName: text(data.customerName),
    customerAddress: text(data.customerAddress),
    items: items
      .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
      .map((i) => ({ description: String(i.description ?? ''), quantity: num(i.quantity), unitPrice: num(i.unitPrice), totalPrice: num(i.totalPrice) })),
    subtotal: num(data.subtotal),
    discount: num(data.discount),
    taxRate: num(data.taxRate),
    taxAmount: num(data.taxAmount),
    totalAmount: num(data.totalAmount),
    currency: text(data.currency)?.toUpperCase() ?? null,
    paymentMethod: text(data.paymentMethod),
    paymentTerms: text(data.paymentTerms),
    notes: text(data.notes)
  };
}
