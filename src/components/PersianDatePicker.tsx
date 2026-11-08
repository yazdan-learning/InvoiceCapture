import { useRef } from 'react';
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
  const picker = useRef<{ closeCalendar?: () => void } | null>(null);
  // Focus moving on to another field (Tab, or Enter on the review page) closes the calendar.
  // A click inside the calendar has no related target and leaves it open.
  return (
    <div
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) picker.current?.closeCalendar?.();
      }}
    >
    <DatePicker
      ref={picker}
      value={date ? new DateObject({ date, calendar: persian, locale: persian_en }) : null}
      onChange={(selected) => onChange(selected instanceof DateObject ? localDateToIso(selected.toDate()) : '')}
      calendar={persian}
      locale={persian_en}
      format="YYYY/MM/DD"
      disabled={disabled}
      containerStyle={{ width: '100%' }}
      // Opening the calendar on an empty field must not fill in today's date (it would be saved as the invoice's date).
      onOpenPickNewDate={false}
    />
    </div>
  );
}
