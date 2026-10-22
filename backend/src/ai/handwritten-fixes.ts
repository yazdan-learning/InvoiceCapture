import { ExtractedInvoiceItem } from '../expenses/ports';

// Deterministic fixes for handwritten readings. A vision model reliably reads
// the total written in words but drops zeros from amount columns written one
// digit per box (12,000,000 read as 1,200,000) — and then reports a "total in
// words" value that agrees with its own misreading. So the words are parsed
// here, and the lines are checked against them.

const UNITS: Record<string, number> = {
  یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9,
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, پونزده: 15, شانزده: 16, شونزده: 16,
  هفده: 17, هیفده: 17, هجده: 18, هیجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900
};
const SCALES: Record<string, number> = { هزار: 1e3, میلیون: 1e6, ملیون: 1e6, میلیارد: 1e9, ملیارد: 1e9 };
const IGNORED = new Set(['و', 'ریال', 'تومان', 'فقط', 'مبلغ', 'تمام']);

/** "دویست و بیست و دو میلیون ریال" → 222000000; null when any word isn't a number word. */
export function persianWordsToNumber(text: string | null): number | null {
  if (!text) return null;
  const words = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, '').split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of words) {
    if (IGNORED.has(word)) continue;
    if (word in SCALES) {
      total += (current || 1) * SCALES[word];
      current = 0;
    } else if (word in UNITS) {
      current += UNITS[word];
    } else {
      return null;
    }
    seen = true;
  }
  return seen ? total + current : null;
}

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
