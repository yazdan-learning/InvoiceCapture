import type { OcrPage } from '@yazdan-learning/ai';
import sharp from 'sharp';
import { westernDigits } from '../ai/replies';
import type { TemplateBox, TemplateLayout } from './templates';

// Finding a template by the form itself, when the vendor's name or tax ID as
// read finds none (misread, handwritten, a vendor new to this organization),
// and fitting its boxes onto this scan (shifted, a little zoomed):
//
// - printed words: the words printed on every invoice of the form (labels, the
//   form's code, the vendor's own address) at about the same place. Words the
//   OCR is sure of, outside the value boxes; kept when seen on most invoices
//   the template learned from. Found words also align the template to the scan.
// - page look: a coarse darkness grid of the first page and its row/column
//   profiles — a layout fingerprint for handwritten or blurry scans whose words
//   the OCR can't read. Too coarse to show any text.
//
// All of it free: the word OCR already ran for the boxes, the look is a resize.

/** A fixed printed word: its normalized text and centre (page fractions); seen on that many of the template's invoices. */
export type TemplateWord = { text: string; page: number; x: number; y: number; seen: number };

/** Words the OCR is less sure of than this are not fixed words (and not looked up). */
const SURE_WORD = 0.8;
const MAX_WORDS = 150;

/** The word as compared: Persian ي/ك unified, Western digits, lower case, letters and digits only. */
export function wordKey(text: string): string {
  return westernDigits(text.normalize('NFKC'))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Long enough and with letters: amounts, dates and numbers change from invoice to invoice. */
const usable = (key: string) => key.length >= 3 && (key.match(/\p{L}/gu)?.length ?? 0) >= 2;

const inside = (x: number, y: number, b: TemplateBox, margin = 0.005) =>
  x >= b.x - margin && x <= b.x + b.width + margin && y >= b.y - margin && y <= b.y + b.height + margin;

/** Each page's sure, usable words that appear once on it: text → centre. */
function uniqueWords(pages: OcrPage[], minConfidence: number): Map<string, { x: number; y: number }>[] {
  return pages.map((page) => {
    const found = new Map<string, { x: number; y: number } | null>();
    for (const w of page.words) {
      const key = wordKey(w.text);
      if (!usable(key)) continue;
      // Counted even when unsure: a word printed twice can't say where the form is.
      if (found.has(key)) found.set(key, null);
      else found.set(key, w.confidence >= minConfidence ? { x: w.box.x + w.box.width / 2, y: w.box.y + w.box.height / 2 } : null);
    }
    return new Map([...found].filter((e): e is [string, { x: number; y: number }] => e[1] !== null));
  });
}

/**
 * The form's printed words on an invoice: sure, usable, once on their page,
 * and outside every value box and the line-items table (values change).
 * Longer words first, at most MAX_WORDS.
 */
export function fixedWordsOf(pages: OcrPage[], layout: Pick<TemplateLayout, 'fields' | 'items'>): TemplateWord[] {
  // The table and a row more: words of the longer tables of later invoices are seen once and fade (mergeWords).
  const boxes = [...Object.values(layout.fields), ...(layout.items ? [{ ...layout.items, height: layout.items.height + layout.items.rowHeight }] : [])];
  const words: TemplateWord[] = [];
  uniqueWords(pages, SURE_WORD).forEach((found, page) => {
    for (const [text, { x, y }] of found) {
      if (!boxes.some((b) => b.page === page && inside(x, y, b))) words.push({ text, page, x, y, seen: 1 });
    }
  });
  return words.sort((a, b) => b.text.length - a.text.length).slice(0, MAX_WORDS);
}

/**
 * The template's words after learning from one more invoice (`now`, already in
 * that invoice's place): words seen again count once more and take its place,
 * new ones start at one, and a word must have been seen on at least half of
 * the invoices to stay. `moved` puts a word not seen this time in its place.
 */
export function mergeWords(old: TemplateWord[], samples: number, now: TemplateWord[], moved: (w: TemplateWord) => TemplateWord = (w) => w) {
  const total = samples + 1;
  const byKey = new Map(old.map((w) => [`${w.page}:${w.text}`, w]));
  const merged = now.map((w) => {
    const before = byKey.get(`${w.page}:${w.text}`);
    byKey.delete(`${w.page}:${w.text}`);
    return { ...w, seen: (before?.seen ?? 0) + 1 };
  });
  for (const w of byKey.values()) merged.push(moved(w));
  const words = merged.filter((w) => w.seen * 2 >= total).sort((a, b) => b.seen - a.seen || b.text.length - a.text.length).slice(0, MAX_WORDS);
  return { words, samples: total };
}

// ─── Alignment ──────────────────────────────────────────────────────────────

/** From the template's place to this scan's: x' = ax·x + bx, y' = ay·y + by (page fractions). */
export type Transform = { ax: number; bx: number; ay: number; by: number };
export const IDENTITY: Transform = { ax: 1, bx: 0, ay: 1, by: 0 };

type Pair = { from: { x: number; y: number }; to: { x: number; y: number } };

/** A word this far (page fraction) from where the alignment puts it doesn't agree with it. */
const INLIER = 0.02;
/** Scans of the same paper differ this much in zoom at most. */
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.18;
const MAX_SAMPLES = 400;

const residual = (t: Transform, p: Pair) => Math.max(Math.abs(t.ax * p.from.x + t.bx - p.to.x), Math.abs(t.ay * p.from.y + t.by - p.to.y));

function fitAxis(points: { from: number; to: number }[]): { a: number; b: number } {
  const n = points.length;
  const mf = points.reduce((s, p) => s + p.from, 0) / n;
  const mt = points.reduce((s, p) => s + p.to, 0) / n;
  const varF = points.reduce((s, p) => s + (p.from - mf) ** 2, 0);
  // Words all in one column (or row) say nothing about zoom: shift only.
  if (varF < 0.01) return { a: 1, b: mt - mf };
  const a = points.reduce((s, p) => s + (p.from - mf) * (p.to - mt), 0) / varF;
  return a < MIN_SCALE || a > MAX_SCALE ? { a: 1, b: mt - mf } : { a, b: mt - a * mf };
}

const fit = (pairs: Pair[]): Transform => {
  const x = fitAxis(pairs.map((p) => ({ from: p.from.x, to: p.to.x })));
  const y = fitAxis(pairs.map((p) => ({ from: p.from.y, to: p.to.y })));
  return { ax: x.a, bx: x.b, ay: y.a, by: y.b };
};

/**
 * The shift and zoom that put most matched words where this scan has them,
 * robust to the few matched wrongly: every shift one pair suggests, and the
 * shift-and-zoom of pairs of pairs, are tried; the one most words agree with
 * is refitted on those. Null with fewer than three pairs.
 */
export function alignPairs(pairs: Pair[]): { transform: Transform; inliers: number } | null {
  if (pairs.length < 3) return null;
  const hypotheses: Transform[] = pairs.map((p) => ({ ax: 1, bx: p.to.x - p.from.x, ay: 1, by: p.to.y - p.from.y }));
  const step = Math.max(1, Math.floor((pairs.length * (pairs.length - 1)) / 2 / MAX_SAMPLES));
  let k = 0;
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      if (k++ % step) continue;
      const [p, q] = [pairs[i], pairs[j]];
      const dx = q.from.x - p.from.x;
      const dy = q.from.y - p.from.y;
      const ax = Math.abs(dx) > 0.15 ? (q.to.x - p.to.x) / dx : 1;
      const ay = Math.abs(dy) > 0.15 ? (q.to.y - p.to.y) / dy : 1;
      if (ax < MIN_SCALE || ax > MAX_SCALE || ay < MIN_SCALE || ay > MAX_SCALE) continue;
      hypotheses.push({ ax, bx: p.to.x - ax * p.from.x, ay, by: p.to.y - ay * p.from.y });
    }
  const agreeing = (t: Transform) => pairs.filter((p) => residual(t, p) <= INLIER);
  let best = agreeing(hypotheses[0]);
  for (const t of hypotheses.slice(1)) {
    const a = agreeing(t);
    if (a.length > best.length) best = a;
  }
  if (best.length < 3) return null;
  let transform = fit(best);
  best = agreeing(transform);
  if (best.length >= 3) transform = fit(best);
  return { transform, inliers: agreeing(transform).length };
}

/** The template's fixed words found on this scan: their share that sit where one alignment puts them, and that alignment per page. */
export function matchWords(words: TemplateWord[], pages: OcrPage[]): { score: number; matched: number; transforms: Transform[] } {
  const found = uniqueWords(pages, 0.6);
  const transforms: Transform[] = [];
  let matched = 0;
  for (let page = 0; page < pages.length; page++) {
    const pairs = words
      .filter((w) => w.page === page && found[page]?.has(w.text))
      .map((w) => ({ from: { x: w.x, y: w.y }, to: found[page].get(w.text)! }));
    const aligned = alignPairs(pairs);
    transforms.push(aligned?.transform ?? IDENTITY);
    matched += aligned?.inliers ?? 0;
  }
  return { score: words.length ? matched / words.length : 0, matched, transforms };
}

/** How many sure, usable words a scan has: few means its words can't tell the form. */
export const readableWords = (pages: OcrPage[]) => uniqueWords(pages, SURE_WORD).reduce((n, m) => n + m.size, 0);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A template box in this scan's place. */
export function moveBox<B extends TemplateBox>(box: B, t: Transform): B {
  const x = clamp01(t.ax * box.x + t.bx);
  const y = clamp01(t.ay * box.y + t.by);
  return { ...box, x, y, width: Math.min(box.width * t.ax, 1 - x), height: Math.min(box.height * t.ay, 1 - y) };
}

/** The template's layout in this scan's place (each page by its own transform; pages without one stay). */
export function moveLayout<L extends Pick<TemplateLayout, 'fields' | 'items'>>(layout: L, transforms: Transform[]): L {
  const on = (page: number) => transforms[page] ?? IDENTITY;
  const fields = Object.fromEntries(Object.entries(layout.fields).map(([f, b]) => [f, moveBox(b, on(b.page))]));
  const items = layout.items ? { ...moveBox(layout.items, on(layout.items.page)), rowHeight: layout.items.rowHeight * on(layout.items.page).ay } : null;
  return { ...layout, fields, items };
}


// ─── Page look ──────────────────────────────────────────────────────────────

/**
 * The first page's layout fingerprint: how much ink edge (lines, text, table
 * rules) each cell of a GRID×GRID grid holds, 0–255, slightly blurred, and the
 * page's row/column darkness profiles (for the shift). Edges, not darkness: the
 * paper's tone and the background around a photo would make all pages alike.
 */
export type PageLook = { grid: number[]; rows: number[]; cols: number[] };

const SIDE = 256;
const GRID = 48;
const PROFILE = 128;
/** Grid cells (of 48) the look may be shifted by when compared: about 6% of the page. */
const GRID_SHIFT = 3;
/** Profile bins (of 128) a scan may be shifted by: about 8% of the page. */
const PROFILE_SHIFT = 10;

export async function pageLook(image: Buffer): Promise<PageLook> {
  const { data } = await sharp(image).grayscale().resize(SIDE, SIDE, { fit: 'fill' }).normalise().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[Math.min(SIDE - 1, y) * SIDE + Math.min(SIDE - 1, x)];
  const edges = new Float64Array(GRID * GRID);
  const cell = SIDE / GRID;
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const e = Math.abs(at(x + 1, y) - at(x, y)) + Math.abs(at(x, y + 1) - at(x, y));
      edges[Math.min(GRID - 1, Math.floor(y / cell)) * GRID + Math.min(GRID - 1, Math.floor(x / cell))] += e;
    }
  // A 3×3 blur: a slightly zoomed scan still lands its lines in the same or a next cell.
  const blurred: number[] = [];
  for (let gy = 0; gy < GRID; gy++)
    for (let gx = 0; gx < GRID; gx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [x, y] = [gx + dx, gy + dy];
          if (x >= 0 && x < GRID && y >= 0 && y < GRID) {
            sum += edges[y * GRID + x];
            n++;
          }
        }
      blurred.push(sum / n);
    }
  const top = Math.max(1, ...blurred);
  const grid = blurred.map((v) => Math.round((v / top) * 255));
  const bin = SIDE / PROFILE;
  const rows: number[] = [];
  const cols: number[] = [];
  for (let b = 0; b < PROFILE; b++) {
    let r = 0;
    let c = 0;
    for (let i = b * bin; i < (b + 1) * bin; i++)
      for (let j = 0; j < SIDE; j++) {
        r += 255 - at(j, i);
        c += 255 - at(i, j);
      }
    rows.push(Math.round(r / bin / SIDE));
    cols.push(Math.round(c / bin / SIDE));
  }
  return { grid, rows, cols };
}

/** Pearson correlation of a and b where both have values (null: too little overlap or a flat signal). */
function correlation(a: (number | undefined)[], b: (number | undefined)[]): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== undefined && b[i] !== undefined) pairs.push([a[i]!, b[i]!]);
  if (pairs.length < a.length / 2) return null;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (const [x, y] of pairs) {
    sab += (x - ma) * (y - mb);
    saa += (x - ma) ** 2;
    sbb += (y - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}

/** The shift (bins) of `now` against `then` that correlates best, and how well. */
function bestShift(then: number[], now: number[], max: number): { shift: number; score: number } {
  let best = { shift: 0, score: -1 };
  for (let s = -max; s <= max; s++) {
    const shifted = then.map((_, i) => now[i + s]);
    const score = correlation(then, shifted) ?? -1;
    if (score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && Math.abs(s) < Math.abs(best.shift))) best = { shift: s, score };
  }
  return best;
}

/**
 * How alike two pages look (−1…1; the same form is about 0.8 or more, other
 * forms rarely above 0.6), allowing a small shift, and the shift that puts the
 * template's page on this one (page fractions), from the row/column profiles.
 */
export function compareLooks(then: PageLook, now: PageLook): { score: number; transform: Transform } {
  let score = -1;
  for (let sy = -GRID_SHIFT; sy <= GRID_SHIFT; sy++)
    for (let sx = -GRID_SHIFT; sx <= GRID_SHIFT; sx++) {
      const shifted = then.grid.map((_, i) => {
        const [x, y] = [(i % GRID) + sx, Math.floor(i / GRID) + sy];
        return x >= 0 && x < GRID && y >= 0 && y < GRID ? now.grid[y * GRID + x] : undefined;
      });
      score = Math.max(score, correlation(then.grid, shifted) ?? -1);
    }
  const dy = bestShift(then.rows, now.rows, PROFILE_SHIFT);
  const dx = bestShift(then.cols, now.cols, PROFILE_SHIFT);
  return { score, transform: { ax: 1, bx: dx.shift / PROFILE, ay: 1, by: dy.shift / PROFILE } };
}
