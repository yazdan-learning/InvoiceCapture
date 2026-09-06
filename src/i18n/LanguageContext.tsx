import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupportedLanguages } from '../api';
import { useAuth } from '../auth/AuthContext';
import en from './translations/en';
import de from './translations/de';
import pl from './translations/pl';
import tr from './translations/tr';

export const SUPPORTED_LANGUAGES = ['en', 'de', 'pl', 'tr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'expense-manager-language';

const dictionaries: Record<Language, typeof en> = { en, de, pl, tr };

// Always shown in the language's own name (not translated) — the standard
// convention for language pickers, so a Turkish user still sees "Deutsch",
// not a Turkish translation of the word "German".
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  pl: 'Polski',
  tr: 'Türkçe'
};

// Country flags as a visual shorthand in the switcher — imperfect for "en"
// (English isn't one country), but this app's other three languages are all
// single-country and the UK flag is the common convention for this case.
export const LANGUAGE_FLAGS: Record<Language, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  pl: '🇵🇱',
  tr: '🇹🇷'
};

function isSupportedLanguage(value: string | null): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

function getNested(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Resolution order: an explicit per-browser choice (localStorage, set by the
// header's switcher) always wins; otherwise fall back to the org's
// admin-configured default once we know who's logged in; otherwise English.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : 'en';
  });

  useEffect(() => {
    if (!isAuthenticated || localStorage.getItem(STORAGE_KEY)) return;
    getSupportedLanguages()
      .then((result) => {
        if (!localStorage.getItem(STORAGE_KEY) && isSupportedLanguage(result.defaultLanguage)) {
          setLanguageState(result.defaultLanguage);
        }
      })
      .catch(() => {
        // No org default available — English stays the fallback.
      });
  }, [isAuthenticated]);

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(STORAGE_KEY, lang);
    setLanguageState(lang);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = dictionaries[language] ?? dictionaries.en;
      const template = getNested(dict, key) ?? getNested(dictionaries.en, key);
      if (typeof template !== 'string') return key;
      return interpolate(template, params);
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useTranslation must be used within LanguageProvider');
  return ctx;
}
