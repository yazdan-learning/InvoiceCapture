import { ExtractedInvoiceData } from '../expenses/ports';
import { Calendar } from '../countries/calendars';
import { CurrencyUnit } from '../countries/country-profile';

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
/** A date as printed (in the country's calendar) → "YYYY-MM-DD" Gregorian, converted here, not by the model. */
const date = (v: unknown, calendar: Calendar) => {
  const s = text(v) && westernDigits(text(v)!);
  return s ? calendar.toIsoDate(s) : null;
};

/**
 * Units without a currency code (a Toman invoice is read as "IRT") are stored
 * as the real currency they stand for, with the printed total kept in the notes.
 */
export function applyCurrencyUnits(data: ExtractedInvoiceData, units: CurrencyUnit[]): ExtractedInvoiceData {
  const currency = data.currency?.toUpperCase() ?? '';
  const unit = units.find((u) => u.code === currency || u.aliases.includes(currency));
  if (!unit) return data;
  const scale = (v: number | null | undefined) => (typeof v === 'number' ? v * unit.factor : null);
  return {
    ...data,
    items: data.items.map((item) => ({ ...item, unitPrice: scale(item.unitPrice), totalPrice: scale(item.totalPrice) })),
    subtotal: scale(data.subtotal),
    discount: scale(data.discount),
    taxAmount: scale(data.taxAmount),
    totalAmount: scale(data.totalAmount),
    currency: unit.storeAs,
    notes: [data.notes, `Converted from ${unit.name} (x${unit.factor})${data.totalAmount !== null ? `: invoice total ${data.totalAmount.toLocaleString('en')} ${unit.name}` : ''}`].filter(Boolean).join(' - ')
  };
}

export function toInvoiceData(data: Record<string, unknown>, calendar: Calendar): ExtractedInvoiceData {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    invoiceNumber: text(data.invoiceNumber),
    invoiceDate: date(data.invoiceDate, calendar),
    dueDate: date(data.dueDate, calendar),
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

/** A bank transfer receipt scanned with the invoice (only countries whose profile asks for "transfer"). */
export type TransferReceipt = { amount: number; currency: string | null; date: string | null; payee: string | null };

export function toTransfer(data: Record<string, unknown>, calendar: Calendar): TransferReceipt | null {
  const transfer = data.transfer;
  if (!transfer || typeof transfer !== 'object') return null;
  const t = transfer as Record<string, unknown>;
  const amount = num(t.amount);
  if (!amount || amount <= 0) return null;
  return { amount, currency: text(t.currency)?.toUpperCase() ?? null, date: date(t.date, calendar), payee: text(t.payee) };
}
