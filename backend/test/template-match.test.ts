import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { OcrPage, OcrWord } from '@yazdan-learning/ai';
import { alignPairs, compareLooks, fixedWordsOf, matchWords, mergeWords, moveLayout, pageLook, wordKey } from '../src/reading/template-match';
import { distrusted, sameLayout } from '../src/reading/templates';

const word = (text: string, x: number, y: number, confidence = 0.95): OcrWord => ({ text, confidence, line: 0, box: { x: x - 0.02, y: y - 0.01, width: 0.04, height: 0.02 } });
const page = (words: OcrWord[]): OcrPage => ({ index: 0, width: 1000, height: 1400, source: 'ocr', text: '', words });

/** A form's printed labels, spread over the page. */
const LABELS: [string, number, number][] = [
  ['فاکتور', 0.5, 0.05],
  ['فروش', 0.6, 0.05],
  ['فروشنده:', 0.85, 0.12],
  ['خریدار:', 0.85, 0.18],
  ['نشانی', 0.4, 0.12],
  ['تلفن', 0.2, 0.12],
  ['ردیف', 0.95, 0.25],
  ['شرح', 0.7, 0.25],
  ['تعداد', 0.45, 0.25],
  ['واحد', 0.3, 0.25],
  ['مبلغ', 0.15, 0.25],
  ['جمع کل', 0.15, 0.9],
  ['امضاء', 0.8, 0.95],
  ['Form F-LO-005', 0.1, 0.97]
];

describe('wordKey', () => {
  it('compares Persian and Arabic letters, digits and punctuation alike', () => {
    expect(wordKey('فروشنده:')).toBe('فروشنده');
    expect(wordKey('كيك')).toBe('کیک');
    expect(wordKey('F-LO-۰۰۵')).toBe('flo005');
  });
});

describe('fixedWordsOf', () => {
  it('keeps sure printed words outside the value boxes and the items table, once on the page', () => {
    const words = [
      ...LABELS.map(([t, x, y]) => word(t, x, y)),
      word('آبدین', 0.7, 0.12), // the vendor name, in its box
      word('125,000', 0.15, 0.93), // a number
      word('میلگرد', 0.7, 0.4), // a line item, in the table
      word('مهر', 0.5, 0.95, 0.4), // unsure
      word('تاریخ', 0.3, 0.05),
      word('تاریخ', 0.3, 0.08) // twice: says nothing about the place
    ];
    const fixed = fixedWordsOf([page(words)], {
      fields: { vendorName: { page: 0, x: 0.6, y: 0.1, width: 0.2, height: 0.04 } },
      items: { page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.1, rowHeight: 0.05 }
    });
    const texts = fixed.map((w) => w.text);
    expect(texts).toContain('فروشنده');
    expect(texts).toContain('formflo005');
    for (const gone of ['آبدین', '125000', 'میلگرد', 'مهر', 'تاریخ']) expect(texts).not.toContain(gone);
    expect(texts).toContain('جمعکل');
  });
});

describe('alignPairs', () => {
  it('finds the shift and zoom of a rescan, ignoring words matched wrongly', () => {
    const t = { ax: 1.04, bx: 0.02, ay: 0.97, by: -0.015 };
    const pairs = LABELS.map(([, x, y]) => ({ from: { x, y }, to: { x: t.ax * x + t.bx, y: t.ay * y + t.by } }));
    pairs.push({ from: { x: 0.5, y: 0.5 }, to: { x: 0.1, y: 0.9 } }, { from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.1 } });
    const aligned = alignPairs(pairs)!;
    expect(aligned.inliers).toBe(LABELS.length);
    expect(aligned.transform.ax).toBeCloseTo(1.04, 3);
    expect(aligned.transform.by).toBeCloseTo(-0.015, 3);
  });

  it('needs three pairs', () => {
    expect(alignPairs([{ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }])).toBeNull();
  });
});

describe('matchWords', () => {
  const template = fixedWordsOf([page(LABELS.map(([t, x, y]) => word(t, x, y)))], { fields: {}, items: null });

  it('scores the share of the form words found where one alignment puts them, and returns that alignment', () => {
    const shifted = LABELS.slice(0, 11).map(([t, x, y]) => word(t, x + 0.03, y + 0.02));
    const found = matchWords(template, [page(shifted)]);
    expect(found.matched).toBe(11);
    expect(found.score).toBeCloseTo(11 / LABELS.length);
    expect(found.transforms[0].bx).toBeCloseTo(0.03, 3);
    expect(found.transforms[0].by).toBeCloseTo(0.02, 3);
  });

  it('does not count the same words scattered elsewhere (another form with common labels)', () => {
    const scattered = LABELS.map(([t], i) => word(t, (i * 0.37) % 1, (i * 0.61) % 1));
    expect(matchWords(template, [page(scattered)]).score).toBeLessThan(0.3);
  });
});

describe('mergeWords', () => {
  it('counts the words seen again and drops ones seen on less than half of the invoices', () => {
    const old = [
      { text: 'فاکتور', page: 0, x: 0.5, y: 0.05, seen: 2 },
      { text: 'آقایرضایی', page: 0, x: 0.7, y: 0.12, seen: 1 }
    ];
    const now = [{ text: 'فاکتور', page: 0, x: 0.52, y: 0.06, seen: 1 }];
    const { words, samples } = mergeWords(old, 2, now);
    expect(samples).toBe(3);
    expect(words).toEqual([{ text: 'فاکتور', page: 0, x: 0.52, y: 0.06, seen: 3 }]);
  });
});

describe('moveLayout', () => {
  it("puts a template's boxes and table rows on the scan", () => {
    const moved = moveLayout(
      { fields: { totalAmount: { page: 0, x: 0.1, y: 0.8, width: 0.2, height: 0.04 } }, items: { page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.2, rowHeight: 0.05 } },
      [{ ax: 1, bx: 0.02, ay: 1.1, by: -0.01 }]
    );
    expect(moved.fields.totalAmount.x).toBeCloseTo(0.12);
    expect(moved.fields.totalAmount.y).toBeCloseTo(0.87);
    expect(moved.items!.rowHeight).toBeCloseTo(0.055);
  });
});

/** A form drawn as an image: frame, table rules and blocks of "text", shifted by (dx, dy) pixels; `other` draws another form. */
async function formImage(dx = 0, dy = 0, other = false): Promise<Buffer> {
  const rows = other ? [200, 260, 900] : [300, 340, 380, 420, 460, 500, 540, 1200];
  const cols = other ? [500] : [100, 250, 400, 550, 850];
  const svg = `<svg width="1000" height="1400" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1400" fill="#fff"/>
    <g transform="translate(${dx},${dy})" stroke="#000" stroke-width="3" fill="none">
      <rect x="50" y="${other ? 100 : 250}" width="900" height="${other ? 1100 : 1000}"/>
      ${rows.map((y) => `<line x1="50" y1="${y}" x2="950" y2="${y}"/>`).join('')}
      ${cols.map((x) => `<line x1="${x}" y1="250" x2="${x}" y2="1250"/>`).join('')}
      <rect x="${other ? 100 : 600}" y="60" width="300" height="40" fill="#000"/>
    </g></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('page look', () => {
  it('scores a rescan of the same form high, with its shift, and another form low', async () => {
    const form = await pageLook(await formImage());
    const rescan = compareLooks(form, await pageLook(await formImage(20, 28)));
    expect(rescan.score).toBeGreaterThan(0.7);
    expect(rescan.transform.bx).toBeCloseTo(0.02, 1);
    expect(rescan.transform.by).toBeCloseTo(0.02, 1);
    expect(compareLooks(form, await pageLook(await formImage(0, 0, true))).score).toBeLessThan(0.6);
  });
});

describe('sameLayout and distrusted', () => {
  const box = (x: number, y: number) => ({ page: 0, x, y, width: 0.1, height: 0.04 });
  it('says two templates are the same printed form when most common fields are in the same place', () => {
    const a = { fields: { vendorName: box(0.6, 0.1), invoiceDate: box(0.1, 0.05), totalAmount: box(0.1, 0.9) } };
    expect(sameLayout(a, { fields: { ...a.fields, invoiceDate: box(0.11, 0.05) } })).toBe(true);
    expect(sameLayout(a, { fields: { vendorName: box(0.1, 0.1), invoiceDate: box(0.5, 0.5), totalAmount: box(0.1, 0.9) } })).toBe(false);
    expect(sameLayout(a, { fields: { vendorName: box(0.6, 0.1) } })).toBe(false);
  });

  it('distrusts a template corrected on most of its invoices', () => {
    expect(distrusted({ timesSent: 4, timesCorrected: 3 })).toBe(true);
    expect(distrusted({ timesSent: 4, timesCorrected: 2 })).toBe(false);
    expect(distrusted({ timesSent: 1, timesCorrected: 1 })).toBe(false);
  });
});
