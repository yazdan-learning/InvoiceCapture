export const SUPPORTED_LANGUAGES = ['en', 'de', 'pl', 'tr'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
