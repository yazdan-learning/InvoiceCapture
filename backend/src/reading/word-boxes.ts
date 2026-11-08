import type { OcrPage, OcrWord } from '@yazdan-learning/ai';
import type { LocateTarget } from '../ai/prompts/field-boxes';
import { westernDigits } from '../ai/replies';
import type { FieldKind } from './fields';
import type { LocatedBox } from './vision-fields';

// Field boxes from OCR word positions, without a model: each value the reading
// found is looked up among the words on the page (amounts by value, dates in
// any common order, IDs without spaces and punctuation, names by how many of
// their words match). A value that can't be found confidently is left out, for
// the vision model to look for. Pages are the same images the review page
// shows, so a word's box (0–1 fractions) is where the user sees it.

type Placed = OcrWord & { page: number };
type Row = { page: number; words: Placed[] };

const MIN_TEXT_SCORE = 0.6;
const MIN_ITEM_DESCRIPTION = 0.3;
/** How many rows past the last line item found the next one may be (a skipped line, a "2 x 1,29" row, a discount). */
const ITEM_LOOKAHEAD = 6;

/** Labels next to an amount that tell which amount it is, when the same value is printed more than once. */
const LABELS: Record<string, RegExp> = {
  totalAmount: /summe|total|zu ?zahlen|betrag|gesamt|toplam|tutar|amount|جمع ?کل|مبلغ ?کل|قابل ?پرداخت|مجموع/i,
  taxAmount: /mwst|ust|vat|tax|kdv|btw|tva|iva|مالیات|ارزش ?افزوده|عوارض/i,
  subtotal: /netto|subtotal|sub-total|zwischensumme|ara ?toplam|جمع/i,
  discountAmount: /rabatt|discount|nachlass|preisvorteil|indirim|iskonto|تخفیف/i
};

// ─── Normalising ─────────────────────────────────────────────────────────────

const PERSIAN_SEPARATORS = (s: string) => s.replace(/٬/g, ',').replace(/٫/g, '.');
const clean = (s: string) => PERSIAN_SEPARATORS(westernDigits(s));
/** Letters and digits only, lower case, for comparing IDs and words (Persian letters kept). */
const compact = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const digitsOnly = (s: string) => clean(s).replace(/\D/g, '');

/** An amount as printed ("1.234,56", "1,234.56", "45,000,000", "16,72", "-0,48 A") in cents; null when it isn't one. */
export function amountCents(text: string): number | null {
  const s = clean(text).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s) || /[.,]{2}/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let whole = s;
  let fraction = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    whole = s.slice(0, at).replace(/[.,]/g, '');
    fraction = s.slice(at + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    // "45,000,000" / "1.234": thousands. "16,72" / "16.7": decimals.
    if (new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) whole = s.split(sep).join('');
    else {
      const parts = s.split(sep);
      if (parts.length !== 2) return null;
      [whole, fraction] = parts;
    }
  }
  if (!/^\d*$/.test(whole) || !/^\d{0,2}$/.test(fraction) || !(whole + fraction)) return null;
  return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
}

const valueCents = (value: string): number | null => {
  const n = Number(clean(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
};

/** The digit sequences a date may be printed as: "2026-11-04" → 20261104, 04112026, 4112026, 041126, 41126 … */
export function dateVariants(value: string): Set<string> {
  const parts = clean(value).split(/[^\d]+/).filter(Boolean);
  const variants = new Set<string>([parts.join('')]);
  if (parts.length !== 3) return variants;
  const [a, b, c] = parts;
  const [y, m, d] = a.length === 4 ? [a, b, c] : [c, b, a];
  const days = [d.padStart(2, '0'), String(Number(d))];
  const months = [m.padStart(2, '0'), String(Number(m))];
  for (const year of [y, y.slice(-2)])
    for (const month of months)
      for (const day of days) {
        variants.add(`${day}${month}${year}`);
        variants.add(`${year}${month}${day}`);
        variants.add(`${month}${day}${year}`);
      }
  return variants;
}

const tokens = (s: string) =>
  clean(s)
    .toLowerCase()
    .split(/[\s,;:/()\-–…|]+/)
    .map(compact)
    .filter((t) => t.length >= 2);

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** OCR misreads a letter or two in longer words ("Würstehen"); short words must match exactly. */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b, a.length >= 9 ? 2 : 1) <= (a.length >= 9 ? 2 : 1));

/** A printed word's parts, and the whole of it ("Coll.Lasagne" → coll, lasagne, colllasagne). */
const wordTokens = (w: { text: string }) => {
  const parts = tokens(w.text.replace(/\./g, ' '));
  const whole = compact(w.text);
  return whole && !parts.includes(whole) ? [...parts, whole] : parts;
};

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * Words on the same height form a row, also across columns (a text PDF lists a
 * receipt's prices as a column of their own, the OCR's own lines don't join them).
 */
export function rowsOf(pages: OcrPage[]): Row[] {
  const rows: Row[] = [];
  pages.forEach((page, pageIndex) => {
    const words = page.words
      .filter((w) => w.text.trim())
      .map((w) => ({ ...w, page: pageIndex }))
      .sort((p, q) => p.box.y + p.box.height / 2 - (q.box.y + q.box.height / 2));
    let current: { words: Placed[]; center: number; height: number } | null = null;
    for (const w of words) {
      const center = w.box.y + w.box.height / 2;
      if (current && Math.abs(center - current.center) <= Math.max(current.height, w.box.height) * 0.6) {
        current.words.push(w);
        current.center = (current.center * (current.words.length - 1) + center) / current.words.length;
        current.height = Math.max(current.height, w.box.height);
      } else {
        current = { words: [w], center, height: w.box.height };
        rows.push({ page: pageIndex, words: current.words });
      }
    }
  });
  for (const row of rows) row.words.sort((p, q) => p.box.x - q.box.x);
  return rows;
}

function union(field: string, words: Placed[]): LocatedBox {
  const x = Math.min(...words.map((w) => w.box.x));
  const y = Math.min(...words.map((w) => w.box.y));
  const right = Math.max(...words.map((w) => w.box.x + w.box.width));
  const bottom = Math.max(...words.map((w) => w.box.y + w.box.height));
  return { field, page: words[0].page, x, y, width: right - x, height: bottom - y };
}

/** One word, or two or three neighbours in a row read as one ("1 234,56", "45 000 000"). */
function* spans(row: Row): Generator<Placed[]> {
  for (let i = 0; i < row.words.length; i++) for (let n = 1; n <= 3 && i + n <= row.words.length; n++) yield row.words.slice(i, i + n);
}
const spanText = (words: Placed[]) => words.map((w) => w.text).join('');

// ─── Finding one value ───────────────────────────────────────────────────────

function findAmount(field: string, value: string, rows: Row[]): Placed[] | null {
  const cents = valueCents(value);
  if (!cents) return null;
  const hits: { words: Placed[]; row: Row }[] = [];
  for (const row of rows)
    for (const span of spans(row)) {
      const text = spanText(span);
      // A two-digit "fraction" must be printed: "1672" is not 16,72.
      if (amountCents(text) === cents && /\d[.,]\d{2}(\D|$)|^\D*\d{1,3}([.,]\d{3})+\D*$/.test(clean(text)) || (cents % 100 === 0 && digitsOnly(text) === String(cents / 100) && digitsOnly(text).length >= 4)) {
        hits.push({ words: span, row });
        break;
      }
    }
  if (!hits.length) return null;
  const label = LABELS[field];
  const labelled = label ? hits.find((h) => h.row.words.some((w) => !h.words.includes(w) && label.test(w.text))) : undefined;
  return (labelled ?? hits[0]).words;
}

function findDate(value: string, rows: Row[]): Placed[] | null {
  const variants = dateVariants(value);
  for (const row of rows)
    for (const span of spans(row)) {
      const text = clean(spanText(span));
      if (/\d[./\-]\d/.test(text) && variants.has(digitsOnly(text))) return span;
    }
  return null;
}

function findId(value: string, rows: Row[]): Placed[] | null {
  const target = compact(value);
  if (target.length < 3) return null;
  for (const row of rows)
    for (const span of spans(row)) {
      const text = compact(spanText(span));
      // "USt-ID:DE276059265" holds the ID with its label.
      if (text === target || (target.length >= 6 && text.includes(target))) return span;
    }
  return null;
}

/** Names and addresses: the row (or two neighbouring rows) holding most of the value's words. */
function findText(value: string, rows: Row[]): Placed[] | null {
  const wanted = tokens(value);
  if (!wanted.length) return null;
  let best: { score: number; words: Placed[] } | null = null;
  for (let i = 0; i < rows.length; i++) {
    for (const group of [[rows[i]], rows[i + 1]?.page === rows[i].page ? [rows[i], rows[i + 1]] : null]) {
      if (!group) continue;
      const words = group.flatMap((r) => r.words);
      const matched = new Set<Placed>();
      let found = 0;
      // A printed word may hold several of the value's words ("Georg-Reismüller-Str." is georg, reismüller, str).
      for (const t of wanted) {
        const w = words.find((w) => wordTokens(w).some((p) => sameWord(p, t)));
        if (w) {
          matched.add(w);
          found++;
        }
      }
      const score = found / wanted.length;
      // Two rows only when they add words: otherwise the tighter one-row box wins.
      if (score >= MIN_TEXT_SCORE && (!best || score > best.score)) best = { score, words: [...matched] };
    }
  }
  return best?.words ?? null;
}

/** How much of a line item's description is on these words (0–1). */
function descriptionScore(description: string, words: Placed[]): number {
  const wanted = tokens(description).filter((t) => !/^\d+$/.test(t));
  if (!wanted.length) return 0;
  const texts = words.flatMap(wordTokens);
  return wanted.filter((t) => texts.some((w) => sameWord(w, t) || (t.length >= 4 && w.startsWith(t)))).length / wanted.length;
}

const hasAmount = (cents: number | null, words: Placed[]) =>
  cents !== null && cents > 0 && words.some((w, i) => [w.text, w.text + (words[i + 1]?.text ?? '')].some((t) => amountCents(t) === cents));

/**
 * Line items in order down the page: each one is the next row (or row plus
 * the one below it, for "2 x 4,49" printed under the name) with its amount
 * and enough of its description. The whole row is boxed, as the vision model does.
 */
function findItems(items: { field: string; description: string; total: string | null }[], rows: Row[]): LocatedBox[] {
  const boxes: LocatedBox[] = [];
  let from = 0;
  for (const item of items) {
    const cents = item.total ? valueCents(item.total) : null;
    // Only a few rows past the last line found: "Lidl Plus Rabatt -0,16" must not jump to "Mit Lidl Plus 0,16 EUR gespart" below the total.
    let best: { score: number; at: number; words: Placed[] } | null = null;
    // The first line is looked for on the whole page (the items table may start far down); the rest near the one before.
    const until = boxes.length ? Math.min(rows.length, from + ITEM_LOOKAHEAD) : rows.length;
    for (let i = from; i < until; i++) {
      for (const group of [[rows[i]], rows[i + 1]?.page === rows[i].page ? [rows[i], rows[i + 1]] : null]) {
        if (!group) continue;
        const words = group.flatMap((r) => r.words);
        const description = descriptionScore(item.description, group[0].words);
        const amount = hasAmount(cents, words);
        // With its amount, part of the name is enough; without it (OCR lost the price), most of the name.
        const ok = (amount && description >= MIN_ITEM_DESCRIPTION) || description >= MIN_TEXT_SCORE;
        // Nearer rows and a single row win ties; a second row only when it holds the amount the first lacks.
        const score = description + (amount ? 1 : 0) - (i - from) * 0.01 - (group.length - 1) * 0.05;
        if (ok && (group.length === 1 || (amount && !hasAmount(cents, group[0].words))) && (!best || score > best.score)) best = { score, at: i + group.length, words };
      }
    }
    if (best) {
      boxes.push(union(item.field, best.words));
      from = best.at;
    }
  }
  return boxes;
}

// ─── All of them ─────────────────────────────────────────────────────────────

export type WordTargets = {
  fields: (LocateTarget & { kind: FieldKind })[];
  items: { field: string; description: string; total: string | null }[];
};

/** The boxes found among the words; targets not in the result are for the vision model. */
export function locateFromWords(pages: OcrPage[], { fields, items }: WordTargets): LocatedBox[] {
  const rows = rowsOf(pages);
  if (!rows.length) return [];
  const boxes: LocatedBox[] = [];
  for (const target of fields) {
    const idLike = target.field === 'invoiceNumber' || target.field === 'vendorTaxId';
    const words =
      target.kind === 'amount'
        ? findAmount(target.field, target.value, rows)
        : target.kind === 'date'
          ? findDate(target.value, rows)
          : idLike
            ? findId(target.value, rows)
            : findText(target.value, rows);
    if (words?.length) boxes.push(union(target.field, words));
  }
  return [...boxes, ...findItems(items, rows)];
}
