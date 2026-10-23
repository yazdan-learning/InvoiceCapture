import type { CountryProfile } from '../api';

export type CalendarId = CountryProfile['calendar'];

// Dates are stored and sent as Gregorian "YYYY-MM-DD"; only what the user sees
// follows the organization's calendar. The browser's Intl does the calendar
// conversion, so displaying Shamsi dates needs no library.

// Intl's own names for the calendars (it rejects "gregorian").
const INTL_CALENDAR: Record<CalendarId, string> = { gregorian: 'gregory', persian: 'persian' };

/** A date-only value ("2026-10-18" or a full ISO timestamp) → the user's locale, in the given calendar. */
export function formatDate(value: string | null | undefined, calendar: CalendarId, locale?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // Date-only values are midnight UTC: read them in UTC so they never show as the day before.
  const timeZone = value.length === 10 ? 'UTC' : undefined;
  return new Intl.DateTimeFormat(locale, { calendar: INTL_CALENDAR[calendar], timeZone }).format(date);
}

export function formatDateTime(value: string | null | undefined, calendar: CalendarId, locale?: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, { calendar: INTL_CALENDAR[calendar], dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" → a local Date at midnight (what date pickers work with), or null. */
export function isoToLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** A local Date → "YYYY-MM-DD" of that same calendar day. */
export function localDateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
