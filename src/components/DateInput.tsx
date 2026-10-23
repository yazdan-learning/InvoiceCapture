import { lazy, Suspense } from 'react';
import { useCountry } from '../country/CountryContext';

export type DateInputProps = {
  /** Gregorian "YYYY-MM-DD", or '' for none. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const PersianDatePicker = lazy(() => import('./PersianDatePicker'));

function NativeDateInput({ value, onChange, disabled }: DateInputProps) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
}

// A date field in the organization's calendar: the browser's own date input
// for Gregorian, a Shamsi picker for Iran (its code is only fetched then).
export function DateInput(props: DateInputProps) {
  const { country } = useCountry();
  if (country.calendar !== 'persian') return <NativeDateInput {...props} />;
  return (
    <Suspense fallback={<NativeDateInput {...props} />}>
      <PersianDatePicker {...props} />
    </Suspense>
  );
}
