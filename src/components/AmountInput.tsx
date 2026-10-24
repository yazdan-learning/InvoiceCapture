import { ChangeEvent, useLayoutEffect, useRef } from 'react';
import { groupDigits, stripGrouping } from '../lib/money';

type AmountInputProps = {
  /** The plain number as a string ("1250000.5"), as the form stores it. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

// An amount field that shows thousands separators while typing ("1,250,000"),
// which a type="number" input can't. The form keeps the plain number; the
// caret stays after the same digit when a separator appears or disappears.
export function AmountInput({ value, onChange, disabled }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const caret = e.target.selectionStart ?? e.target.value.length;
    digitsBeforeCaret.current = e.target.value.slice(0, caret).replace(/[^\d.-]/g, '').length;
    onChange(stripGrouping(e.target.value));
  };

  const shown = groupDigits(value);

  useLayoutEffect(() => {
    const input = ref.current;
    const wanted = digitsBeforeCaret.current;
    if (!input || wanted === null || document.activeElement !== input) return;
    let position = 0;
    for (let seen = 0; position < shown.length && seen < wanted; position++) {
      if (shown[position] !== ',') seen++;
    }
    input.setSelectionRange(position, position);
    digitsBeforeCaret.current = null;
  }, [shown]);

  return <input ref={ref} type="text" inputMode="decimal" dir="ltr" value={shown} onChange={handleChange} disabled={disabled} />;
}
