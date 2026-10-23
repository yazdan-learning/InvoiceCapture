// Persian number words → number. A vision model reliably reads the total
// written in words on a handwritten invoice (مبلغ به حروف), but reports a
// value for it that agrees with its own misreading of the digits — so the
// words are parsed here instead.

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
