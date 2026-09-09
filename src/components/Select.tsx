import { useState } from 'react';

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
};

// Replaces native <select> where its OS-native options popup has been
// reported unreadable (dark-on-dark) on some mobile browsers — some Android
// browsers force-dark form-control popups regardless of the page's own
// color-scheme hint, which CSS has no way to override. Rendering our own
// dropdown sidesteps native popup rendering entirely, the same fix already
// proven for the language switcher (see LanguageSwitcher.tsx).
export function Select({ value, onChange, options, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className="custom-select">
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className={selected ? undefined : 'custom-select-placeholder'}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <span className="custom-select-chevron">▾</span>
      </button>
      {open && (
        <>
          <div className="custom-select-backdrop" onClick={() => setOpen(false)} />
          <div className="custom-select-dropdown">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`custom-select-option ${opt.value === value ? 'custom-select-option--active' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
