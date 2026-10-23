import { ExtractedInvoiceItem } from '../expenses/ports';

// Deterministic fixes for handwritten readings. A vision model drops zeros
// from amount columns written one digit per box (12,000,000 read as
// 1,200,000), so the lines are checked against the total written in words
// (parsed by the country's own number-words parser).

const lineAmount = (item: ExtractedInvoiceItem) => item.totalPrice ?? (item.unitPrice !== null ? item.unitPrice * (item.quantity ?? 1) : null);

/**
 * The lines with dropped zeros restored, when there is exactly one way to make
 * them add up to `total` by multiplying some lines by 10, 100 or 1000. Null when
 * they already add up, or when no single explanation exists (left to the user).
 */
export function restoreDroppedZeros(items: ExtractedInvoiceItem[], total: number): ExtractedInvoiceItem[] | null {
  const amounts = items.map(lineAmount);
  if (!items.length || items.length > 12 || amounts.some((a) => a === null)) return null;
  const sum = amounts.reduce((s, a) => s! + a!, 0)!;
  if (sum === total) return null;

  const matches: { mask: number; factor: number }[] = [];
  for (const factor of [10, 100, 1000]) {
    for (let mask = 1; mask < 1 << items.length; mask++) {
      const fixed = amounts.reduce((s, a, i) => s! + (mask & (1 << i) ? a! * factor : a!), 0);
      if (fixed === total) matches.push({ mask, factor });
    }
  }
  if (matches.length !== 1) return null;
  const { mask, factor } = matches[0];
  return items.map((item, i) =>
    mask & (1 << i)
      ? { ...item, unitPrice: item.unitPrice !== null ? item.unitPrice * factor : null, totalPrice: item.totalPrice !== null ? item.totalPrice * factor : null }
      : item
  );
}
