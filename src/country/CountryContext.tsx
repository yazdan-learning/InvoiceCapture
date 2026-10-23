import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CountryProfile, getCountryProfile } from '../api';
import { useAuth } from '../auth/AuthContext';
import { formatDate, formatDateTime } from './dates';

// Until the organization's profile has loaded (and when signed out): no
// country-specific behaviour.
const INTERNATIONAL: CountryProfile = {
  id: 'INTL',
  name: 'International',
  calendar: 'gregorian',
  direction: 'ltr',
  features: { handwrittenInvoices: false }
};

type CountryContextValue = {
  country: CountryProfile;
  /** Call after the admin changes the country, so the UI follows without a reload. */
  reload: () => void;
  formatDate: (value: string | null | undefined) => string;
  formatDateTime: (value: string | null | undefined) => string;
};

const CountryContext = createContext<CountryContextValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [country, setCountry] = useState<CountryProfile>(INTERNATIONAL);

  const reload = useCallback(() => {
    getCountryProfile()
      .then(setCountry)
      .catch(() => setCountry(INTERNATIONAL));
  }, []);

  useEffect(() => {
    if (isAuthenticated) reload();
    else setCountry(INTERNATIONAL);
  }, [isAuthenticated, reload]);

  useEffect(() => {
    document.documentElement.dir = country.direction;
  }, [country.direction]);

  const value = useMemo(
    () => ({
      country,
      reload,
      formatDate: (value: string | null | undefined) => formatDate(value, country.calendar),
      formatDateTime: (value: string | null | undefined) => formatDateTime(value, country.calendar)
    }),
    [country, reload]
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountry(): CountryContextValue {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error('useCountry must be used within CountryProvider');
  return ctx;
}
