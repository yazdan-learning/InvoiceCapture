import { SUPPORTED_CURRENCIES } from '../shared/currencies';
import { CountryId, CountryProfile } from './country-profile';
import { international } from './international';
import { iran } from './iran';

// The one place that knows which countries exist. Adding a country = a new
// profile file plus one line here (and its id in COUNTRY_IDS).
const PROFILES: Record<CountryId, CountryProfile> = { INTL: international, IR: iran };

/** The organization's profile; an unknown id (e.g. a profile since removed) gets the international one. */
export function getCountryProfile(id: string | null | undefined): CountryProfile {
  return PROFILES[id as CountryId] ?? international;
}

/** The shared currency list plus the country's own, sorted. */
export function currenciesFor(profile: CountryProfile): string[] {
  return [...new Set([...SUPPORTED_CURRENCIES, ...profile.extraCurrencies])].sort();
}

/** For the admin's country picker. */
export function listCountries() {
  return Object.values(PROFILES).map((profile) => ({
    id: profile.id,
    name: profile.name,
    defaultCurrency: profile.defaultCurrency,
    currencies: currenciesFor(profile)
  }));
}

/** What the frontend needs to adapt to the country; prompts and parsers stay on the server. */
export function toClientProfile(profile: CountryProfile) {
  return {
    id: profile.id,
    name: profile.name,
    calendar: profile.calendar,
    direction: profile.direction,
    features: { handwrittenInvoices: Boolean(profile.invoice.handwriting) }
  };
}

export type ClientCountryProfile = ReturnType<typeof toClientProfile>;
