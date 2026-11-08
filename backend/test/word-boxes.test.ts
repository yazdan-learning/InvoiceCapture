import type { OcrPage, OcrWord } from '@yazdan-learning/ai';
import { describe, expect, it } from 'vitest';
import { amountCents, dateVariants, locateFromWords, rowsOf } from '../src/reading/word-boxes';

// A page built from rows of words: each row 2% high, words 10% wide side by side.
function page(rows: string[][]): OcrPage {
  const words: OcrWord[] = rows.flatMap((row, r) =>
    row.map((text, i) => ({ text, confidence: 0.9, line: r, box: { x: 0.05 + i * 0.12, y: 0.03 + r * 0.03, width: 0.1, height: 0.02 } }))
  );
  return { index: 0, width: 1000, height: 1000, source: 'ocr', text: '', words };
}

const lidl = page([
  ['Lidl'],
  ['Georg-Reismüller-Str.', '28'],
  ['80999', 'München-Allach'],
  ['Banane', 'Fair', 'Bio', '2,05', 'A'],
  ['Zwiebeln', 'rot'],
  ['1,29', 'x', '2', '2,58', 'A'],
  ['Lidl', 'Plus', 'Rabatt', '-0,16'],
  ['Trauben', 'dunkel', '99'],
  ['zu', 'zahlen', '68,68'],
  ['Kreditkarte', '68,68'],
  ['A', '7%', '3,51', '50,20', '53,71'],
  ['Mit', 'Lidl', 'Plus', '0,16', 'EUR', 'gespart'],
  ['06.11.26', '17:20', 'Beleg', '5320'],
  ['UST-ID-NR:', 'DE276059265']
]);

const field = (field: string, kind: 'text' | 'amount' | 'date', value: string) => ({ field, kind, label: field, value });
const located = (pageOf: OcrPage, targets: Parameters<typeof locateFromWords>[1]) => {
  const rows = rowsOf([pageOf]);
  // The row index a box starts on, to check which row was picked.
  return Object.fromEntries(locateFromWords([pageOf], targets).map((b) => [b.field, rows.findIndex((r) => Math.abs(r.words[0].box.y - b.y) < 1e-6)]));
};

describe('amountCents', () => {
  it('reads the common ways an amount is printed', () => {
    expect(amountCents('16,72')).toBe(1672);
    expect(amountCents('16.72')).toBe(1672);
    expect(amountCents('1.234,56')).toBe(123456);
    expect(amountCents('1,234.56')).toBe(123456);
    expect(amountCents('45,000,000')).toBe(4_500_000_000);
    expect(amountCents('۴۵٬۰۰۰٬۰۰۰')).toBe(4_500_000_000);
    expect(amountCents('-0,48')).toBe(48);
    expect(amountCents('Total')).toBeNull();
    expect(amountCents('1,2,3')).toBeNull();
  });
});

describe('dateVariants', () => {
  it('covers day-month-year, short years and missing leading zeros', () => {
    const v = dateVariants('2026-11-04');
    for (const printed of ['20261104', '04112026', '041126', '4112026', '41126']) expect(v.has(printed)).toBe(true);
    expect(dateVariants('۱۴۰۵/۰۷/۱۹').has('14050719')).toBe(true);
  });
});

describe('locateFromWords', () => {
  it('places header fields: names, address over two rows, IDs inside their label, dates as printed', () => {
    const rows = located(lidl, {
      fields: [
        field('vendorName', 'text', 'Lidl'),
        field('vendorAddress', 'text', 'Georg-Reismüller-Str. 28, 80999 München-Allach'),
        field('vendorTaxId', 'text', 'DE276059265'),
        field('invoiceNumber', 'text', '5320'),
        field('invoiceDate', 'date', '2026-11-06')
      ],
      items: []
    });
    expect(rows).toEqual({ vendorName: 0, vendorAddress: 1, vendorTaxId: 13, invoiceNumber: 12, invoiceDate: 12 });
  });

  it('takes the amount next to its label when the same value is printed twice', () => {
    expect(located(lidl, { fields: [field('totalAmount', 'amount', '68.68')], items: [] })).toEqual({ totalAmount: 8 });
  });

  it('does not take a number without its printed decimals for an amount', () => {
    expect(located(page([['Beleg', '1672']]), { fields: [field('totalAmount', 'amount', '16.72')], items: [] })).toEqual({});
  });

  it('places line items in order, with the quantity row below the name, and never jumps below the total', () => {
    const rows = located(lidl, {
      fields: [],
      items: [
        { field: 'items.0', description: 'Banane Fair Bio', total: '2.05' },
        { field: 'items.1', description: 'Zwiebeln rot', total: '2.58' },
        { field: 'items.2', description: 'Lidl Plus Rabatt', total: '-0.16' },
        // The OCR lost this price ("99"): placed by its name alone.
        { field: 'items.3', description: 'Trauben dunkel', total: '1.99' }
      ]
    });
    expect(rows).toEqual({ 'items.0': 3, 'items.1': 4, 'items.2': 6, 'items.3': 7 });
  });

  it('finds the first line item far down the page (an invoice header above the table)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ['Header', `row${i}`]);
    const invoice = page([...rows, ['Door', 'cabin', 'lift', '890,000,000'], ['Door', 'floor', 'lift', '579,000,000']]);
    expect(
      located(invoice, {
        fields: [],
        items: [
          { field: 'items.0', description: 'Door cabin lift', total: '890000000' },
          { field: 'items.1', description: 'Door floor lift', total: '579000000' }
        ]
      })
    ).toEqual({ 'items.0': 12, 'items.1': 13 });
  });

  it('leaves out what it cannot find, for the vision model', () => {
    expect(located(lidl, { fields: [field('vendorName', 'text', 'Rossmann')], items: [{ field: 'items.0', description: 'Kaffee', total: '4.99' }] })).toEqual({});
  });

  it('joins a text PDF\'s price column to its row by height', () => {
    const p = page([['Kamillentee', 'lose'], ['SUMME']]);
    p.words.push({ text: '2,95', confidence: 1, line: 9, box: { x: 0.8, y: 0.031, width: 0.08, height: 0.018 } });
    expect(rowsOf([p])[0].words.map((w) => w.text)).toEqual(['Kamillentee', 'lose', '2,95']);
  });
});
