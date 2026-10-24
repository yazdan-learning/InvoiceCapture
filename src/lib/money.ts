// Amounts look the same everywhere, whatever the UI language: comma thousands
// separators and the currency's usual decimals — "1,250,000 IRR", "12.50 EUR".
const LOCALE = 'en-US';

/** The decimals a currency is written with (0 for IRR and JPY, 2 for most). */
export function currencyDecimals(currency: string | null | undefined): number {
  if (!currency) return 2;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2; // not an ISO code (e.g. "IRT" before conversion)
  }
}

/** "1,250,000 IRR"; without a currency code when `withCode` is false (table cells under a currency column). */
export function formatAmount(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
  { withCode = true } = {}
): string {
  if (amount == null || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  const decimals = currencyDecimals(currency);
  const formatted = value.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency && withCode ? `${formatted} ${currency}` : formatted;
}

/** Quantities: separators, and only the decimals there are (2, 1.5, 1,200). */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(LOCALE, { maximumFractionDigits: 3 }) : String(value);
}

/** What an amount field shows while typing: "1250000.5" → "1,250,000.5" (decimals left as typed). */
export function groupDigits(raw: string): string {
  const [whole, fraction] = raw.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + digits + (fraction !== undefined ? `.${fraction}` : '');
}

/** The other way: typed text (with separators, spaces, stray characters) → a plain number string. */
export function stripGrouping(text: string): string {
  const cleaned = text.replace(/[^\d.-]/g, '');
  const sign = cleaned.startsWith('-') ? '-' : '';
  const [whole, ...rest] = cleaned.replace(/-/g, '').split('.');
  return sign + whole + (rest.length ? `.${rest.join('')}` : '');
}

/** A stored Decimal ("1250000.00") as an amount field's starting value ("1250000"). */
export function toAmountInput(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}
