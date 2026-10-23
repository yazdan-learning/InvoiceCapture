import DatePicker, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_en from 'react-date-object/locales/persian_en';
import { isoToLocalDate, localDateToIso } from '../country/dates';
import type { DateInputProps } from './DateInput';

// Shamsi date picker for organizations in Iran. Loaded on demand by DateInput,
// so nobody else downloads it. Month names are in English (Farvardin, ...)
// until the UI has a Persian translation; the value stays Gregorian
// "YYYY-MM-DD" like every other date in the app.
export default function PersianDatePicker({ value, onChange, disabled }: DateInputProps) {
  const date = isoToLocalDate(value);
  return (
    <DatePicker
      value={date ? new DateObject({ date, calendar: persian, locale: persian_en }) : null}
      onChange={(selected) => onChange(selected instanceof DateObject ? localDateToIso(selected.toDate()) : '')}
      calendar={persian}
      locale={persian_en}
      format="YYYY/MM/DD"
      disabled={disabled}
      containerStyle={{ width: '100%' }}
    />
  );
}
