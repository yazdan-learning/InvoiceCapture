import { CalendarId } from './country-profile';
import { jalaliToIso, todayJalali } from './iran/jalali';

// One strategy per calendar a country can use. Invoices print dates in the
// local calendar; the model returns them as printed and they're converted
// here, because models get calendar arithmetic wrong.

export type Calendar = {
  /** Today as printed on this calendar's invoices, for telling the model which year is likely. */
  today(now?: Date): string;
  /** A date as the model returned it → "YYYY-MM-DD" (Gregorian), or null. */
  toIsoDate(value: string): string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');

const isoDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900 ? value : null);

const gregorian: Calendar = {
  today: (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  toIsoDate: isoDate
};

// Iranian invoices are dated in the Shamsi calendar, but some (imports,
// card-terminal slips) print a Gregorian date: both are accepted.
// A Shamsi year is around 1400, so a year from 1900 on is Gregorian however
// it is written (the model copies "YYYY/MM/DD" for both).
const persian: Calendar = {
  today: todayJalali,
  toIsoDate: (value) => isoDate(value) ?? isoDate(value.replace(/\//g, '-')) ?? jalaliToIso(value)
};

const CALENDARS: Record<CalendarId, Calendar> = { gregorian, persian };

export function getCalendar(id: CalendarId): Calendar {
  return CALENDARS[id];
}
