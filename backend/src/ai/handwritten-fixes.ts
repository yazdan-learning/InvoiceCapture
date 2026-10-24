import { CurrencyUnit } from '../countries/country-profile';
import { ExtractedInvoiceData, ExtractedInvoiceItem } from '../expenses/ports';

// Deterministic fixes for handwritten readings. A vision model drops zeros
// from amount columns written one digit per box (12,000,000 read as
// 1,200,000), so the lines are checked against the total written in words
// (parsed by the country's own number-words parser).

const lineAmount = (item: ExtractedInvoiceItem) => item.totalPrice ?? (item.unitPrice !== null ? item.unitPrice * (item.quantity ?? 1) : null);

/**
 * The lines with dropped zeros restored, when there is exactly one way to make
 * them add up to `total` by multiplying some lines by 10, 100 or 1000. Null when
 * they already add up, or when no single explanation exists (left to the user).
 */
export function restoreDroppedZeros(items: ExtractedInvoiceItem[], total: number): ExtractedInvoiceItem[] | null {
  const amounts = items.map(lineAmount);
  if (!items.length || items.length > 12 || amounts.some((a) => a === null)) return null;
  const sum = amounts.reduce((s, a) => s! + a!, 0)!;
  if (sum === total) return null;

  const matches: { mask: number; factor: number }[] = [];
  for (const factor of [10, 100, 1000]) {
    for (let mask = 1; mask < 1 << items.length; mask++) {
      const fixed = amounts.reduce((s, a, i) => s! + (mask & (1 << i) ? a! * factor : a!), 0);
      if (fixed === total) matches.push({ mask, factor });
    }
  }
  if (matches.length !== 1) return null;
  const { mask, factor } = matches[0];
  return items.map((item, i) =>
    mask & (1 << i)
      ? { ...item, unitPrice: item.unitPrice !== null ? item.unitPrice * factor : null, totalPrice: item.totalPrice !== null ? item.totalPrice * factor : null }
      : item
  );
}

/**
 * The reading against the amount actually paid: a bank transfer receipt scanned
 * with the invoice is printed, so its digits are exact, while the handwritten
 * ones lose zeros and rarely say Toman or Rial. Returns the reading in the unit
 * the payment fits (its own first), with the total and dropped zeros fixed when
 * exactly one way makes the lines add up; null when nothing fits (a transfer can
 * pay several invoices, or part of one).
 */
export function fitToPaidAmount(
  data: ExtractedInvoiceData,
  paid: { amount: number; currency: string | null },
  units: CurrencyUnit[]
): ExtractedInvoiceData | null {
  const unitOf = (code: string | null) => units.find((u) => u.code === code || (code !== null && u.aliases.includes(code)));
  const paidStored = paid.amount * (unitOf(paid.currency)?.factor ?? 1);
  const codes = [...new Set([data.currency, ...units.map((u) => u.storeAs), ...units.map((u) => u.code), paid.currency])].filter(
    (code): code is string => !!code
  );
  const amounts = data.items.map(lineAmount);
  const lines = data.items.length && amounts.every((a) => a !== null) ? amounts.reduce((s, a) => s! + a!, 0) : null;

  const targets = codes
    .map((currency) => ({ currency, target: paidStored / (unitOf(currency)?.factor ?? 1) }))
    .filter(({ target }) => Number.isInteger(target));
  const withTotal = (currency: string, target: number, fixed: Partial<ExtractedInvoiceData> = {}) => ({
    ...data,
    ...fixed,
    currency,
    totalAmount: target,
    subtotal: data.subtotal === null || data.subtotal === data.totalAmount ? target : data.subtotal
  });

  // The amounts as written, in whichever unit fits (lines that don't add up are left to the checks).
  for (const { currency, target } of targets) {
    if (data.totalAmount === target) return { ...data, currency };
    if (lines === target) return withTotal(currency, target);
  }
  for (const { currency, target } of targets) {
    // Every amount off by the same power of ten: a unit misread ("۵۰۰٬۰۰۰ هزار تومان") or zeros added or dropped throughout.
    const scale = lines ? [10, 100, 1000, 0.1, 0.01, 0.001].find((k) => Math.round(lines * k) === target) : undefined;
    if (scale) {
      const by = (v: number | null) => (v === null ? null : Math.round(v * scale));
      return withTotal(currency, target, { items: data.items.map((item) => ({ ...item, unitPrice: by(item.unitPrice), totalPrice: by(item.totalPrice) })) });
    }
    const restored = restoreDroppedZeros(data.items, target);
    if (restored) return withTotal(currency, target, { items: restored });
  }
  return null;
}

/**
 * Which invoices of a split file one bank transfer paid: the only set of their
 * totals that adds up to it (in stored units). Null when none or several do —
 * the transfer may then pay something else.
 */
export function paidByTransfer(
  invoices: { totalAmount: number | null; currency: string | null }[],
  paid: { amount: number; currency: string | null },
  units: CurrencyUnit[]
): boolean[] | null {
  if (invoices.length > 16) return null;
  const stored = (amount: number, code: string | null) =>
    Math.round(amount * (units.find((u) => u.code === code || (code !== null && u.aliases.includes(code)))?.factor ?? 1));
  const totals = invoices.map((invoice) => (invoice.totalAmount === null ? null : stored(invoice.totalAmount, invoice.currency)));
  const target = stored(paid.amount, paid.currency);
  const masks: number[] = [];
  for (let mask = 1; mask < 1 << totals.length && masks.length < 2; mask++) {
    const sum = totals.reduce<number | null>((s, t, i) => (mask & (1 << i) ? (s === null || t === null ? null : s + t) : s), 0);
    if (sum === target) masks.push(mask);
  }
  return masks.length === 1 ? totals.map((_, i) => Boolean(masks[0] & (1 << i))) : null;
}
