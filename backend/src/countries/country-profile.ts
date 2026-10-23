// Everything that differs between the countries an organization can operate
// in: currency, calendar, text direction and how its invoices are read. One
// file per country (see ./registry.ts); code that needs a country-specific
// behaviour asks the organization's profile instead of checking the country.

export const COUNTRY_IDS = ['INTL', 'IR'] as const;
export type CountryId = (typeof COUNTRY_IDS)[number];

export type CalendarId = 'gregorian' | 'persian';

/**
 * A unit printed on invoices that has no ISO currency code, stored as a real
 * currency instead: Toman (read as "IRT") is kept as IRR, 1 Toman = 10 Rial.
 */
export type CurrencyUnit = { code: string; aliases: string[]; name: string; storeAs: string; factor: number };

/** For countries where handwritten invoices are common: read from the photo by the vision model. */
export type HandwritingRules = {
  /** The country-specific part of the handwriting prompt; `today` is in the country's calendar. */
  promptRules(today: string): string;
  /** The total written in words → number (null when it can't be parsed). */
  wordsToNumber(text: string | null): number | null;
  /** A currency word in the total in words → the code the amounts are in, e.g. تومان → IRT. */
  currencyWords: Record<string, string>;
};

export type InvoiceRules = {
  /** How the model is asked to return invoiceDate (JSON-schema style). */
  dateFormat: string;
  /** Extraction rules for this country's invoices, appended to the shared prompt rules. */
  promptRules: string;
  currencyUnits: CurrencyUnit[];
  /** Present only where handwritten invoices are supported; enables the "handwritten" upload option. */
  handwriting?: HandwritingRules;
};

export type CountryProfile = {
  id: CountryId;
  name: string;
  /** Suggested to the admin when they pick this country. */
  defaultCurrency: string;
  /** Offered on top of the shared currency list (see shared/currencies.ts). */
  extraCurrencies: readonly string[];
  calendar: CalendarId;
  /** UI text direction. */
  direction: 'ltr' | 'rtl';
  invoice: InvoiceRules;
};
