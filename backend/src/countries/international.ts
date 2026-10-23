import { CountryProfile } from './country-profile';

/** The default for every country without its own profile (Europe and the rest). */
export const international: CountryProfile = {
  id: 'INTL',
  name: 'International',
  defaultCurrency: 'EUR',
  extraCurrencies: [],
  calendar: 'gregorian',
  direction: 'ltr',
  invoice: {
    dateFormat: '"YYYY-MM-DD"|null',
    promptRules: '',
    currencyUnits: []
  }
};
