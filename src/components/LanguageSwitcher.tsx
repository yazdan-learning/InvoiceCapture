import { useState } from 'react';
import { LANGUAGE_FLAGS, LANGUAGE_LABELS, Language, SUPPORTED_LANGUAGES, useTranslation } from '../i18n/LanguageContext';

// Shared by MobileTopBar and DesktopHeader, same pattern as UserMenu: a
// trigger button + backdrop-dismissed dropdown. Flags give the closed state
// a compact, recognizable glyph instead of a text dropdown that needed a
// fixed width to fit "Deutsch"/"Türkçe" without clipping.
export function LanguageSwitcher() {
  const { language, setLanguage } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="language-switcher">
      <button
        className="language-switcher-trigger"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
      >
        <span className="language-switcher-flag">{LANGUAGE_FLAGS[language]}</span>
        <span className="language-switcher-code">{language.toUpperCase()}</span>
      </button>
      {open && (
        <>
          <div className="language-switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="language-switcher-dropdown">
            {SUPPORTED_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                className={`language-switcher-option ${code === language ? 'language-switcher-option--active' : ''}`}
                onClick={() => {
                  setLanguage(code as Language);
                  setOpen(false);
                }}
              >
                <span className="language-switcher-flag">{LANGUAGE_FLAGS[code]}</span>
                <span className="language-switcher-option-label">{LANGUAGE_LABELS[code]}</span>
                {code === language && <span className="language-switcher-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
