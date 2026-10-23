// Every country's currency list starts from this one (a country profile can
// add its own, e.g. IRR for Iran — see countries/registry.ts). All of them are
// convertible with the Frankfurter API (see frankfurter-currency-converter.ts).
export const SUPPORTED_CURRENCIES = [
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR'
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
