import { describe, expect, it } from 'vitest';
import { getCalendar } from '../src/countries/calendars';
import { persianWordsToNumber } from '../src/countries/iran/number-words';
import { currenciesFor, getCountryProfile, listCountries, toClientProfile } from '../src/countries/registry';

describe('country registry', () => {
  it('finds a profile by id and falls back to international for unknown ids', () => {
    expect(getCountryProfile('IR').name).toBe('Iran');
    expect(getCountryProfile('XX').id).toBe('INTL');
    expect(getCountryProfile(null).id).toBe('INTL');
  });

  it('offers IRR only to Iran', () => {
    expect(currenciesFor(getCountryProfile('IR'))).toContain('IRR');
    expect(currenciesFor(getCountryProfile('INTL'))).not.toContain('IRR');
    expect(currenciesFor(getCountryProfile('IR'))).toContain('EUR');
  });

  it('lists every country with its currencies for the admin picker', () => {
    const iran = listCountries().find((c) => c.id === 'IR');
    expect(iran).toMatchObject({ name: 'Iran', defaultCurrency: 'IRR' });
    expect(iran?.currencies).toContain('IRR');
  });

  it('tells the client which features and calendar apply, nothing more', () => {
    expect(toClientProfile(getCountryProfile('IR'))).toEqual({
      id: 'IR',
      name: 'Iran',
      calendar: 'persian',
      direction: 'ltr',
      features: { handwrittenInvoices: true }
    });
    expect(toClientProfile(getCountryProfile('INTL')).features.handwrittenInvoices).toBe(false);
  });
});

describe('calendars', () => {
  it('reads Shamsi and Gregorian dates on the Persian calendar', () => {
    const persian = getCalendar('persian');
    expect(persian.toIsoDate('1405/07/26')).toBe('2026-10-18');
    expect(persian.toIsoDate('2026-10-18')).toBe('2026-10-18');
    expect(persian.toIsoDate('1405/13/01')).toBeNull();
  });

  it('accepts only Gregorian dates on the Gregorian calendar', () => {
    const gregorian = getCalendar('gregorian');
    expect(gregorian.toIsoDate('2026-10-18')).toBe('2026-10-18');
    expect(gregorian.toIsoDate('1405/07/26')).toBeNull();
  });

  it('prints today in the calendar of the invoices', () => {
    const day = new Date(2026, 9, 18);
    expect(getCalendar('persian').today(day)).toBe('1405/07/26');
    expect(getCalendar('gregorian').today(day)).toBe('2026-10-18');
  });
});

describe('Persian number words', () => {
  it('parses a total written in words', () => {
    expect(persianWordsToNumber('دویست و بیست و دو میلیون ریال')).toBe(222_000_000);
    expect(persianWordsToNumber('not a number')).toBeNull();
  });
});
