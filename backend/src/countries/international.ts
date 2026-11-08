import { CountryProfile } from './country-profile';

/** The default for every country without its own profile (Europe and the rest). */
export const international: CountryProfile = {
  id: 'INTL',
  name: 'International',
  defaultCurrency: 'EUR',
  extraCurrencies: [],
  calendar: 'gregorian',
  direction: 'ltr',
  // Europe and Turkey: Latin script with German and Turkish letters.
  ocrLanguages: 'eng+deu+tur',
  invoice: {
    dateFormat: '"YYYY-MM-DD"|null',
    promptRules: '',
    currencyUnits: []
  }
};
