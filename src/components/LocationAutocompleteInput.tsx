import { useEffect, useRef } from 'react';
import { isGoogleMapsConfigured, loadGoogleMaps } from '../lib/googleMaps';

type Props = {
  defaultValue?: string;
  onChange: (value: string) => void;
  onPlaceSelected?: (address: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

// Uncontrolled on purpose: Google's Autocomplete widget writes directly into
// the DOM input, which would fight a React-controlled `value`. We read the
// current value out via onChange instead of feeding one back in. Parents that
// need to reset the field on new data (e.g. switching between expenses)
// should remount this component with a `key`, not push a new value down.
export function LocationAutocompleteInput({ defaultValue, onChange, onPlaceSelected, placeholder, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // The Autocomplete listener is registered once on mount (re-creating the
  // widget on every render would be wasteful and glitchy). Routing the
  // callbacks through refs — updated every render — means the listener
  // always calls today's version, not the one closed over at mount time.
  const onChangeRef = useRef(onChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onChangeRef.current = onChange;
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    if (!isGoogleMapsConfigured() || !inputRef.current) return;
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !inputRef.current) return;
        const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address']
        });
        listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const address = place.formatted_address ?? inputRef.current?.value ?? '';
          onChangeRef.current(address);
          onPlaceSelectedRef.current?.(address);
        });
      })
      .catch(() => {
        // Maps failed to load — the field keeps working as plain text.
      });

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onPlaceSelected?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
    />
  );
}
