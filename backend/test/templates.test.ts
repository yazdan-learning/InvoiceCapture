import { EMPTY_GUIDE } from '../src/reading/form-guide';
import { describe, expect, it } from 'vitest';
import { bestTemplate, fitsPages, layoutFromBoxes, placeFromTemplate, StoredTemplate, taxIdKey, vendorKey } from '../src/reading/templates';

const box = (field: string, x: number, y: number, source = 'MODEL', page = 0) => ({ field, page, x, y, width: 0.1, height: 0.04, source });

describe('template keys', () => {
  it('reads a tax ID as its digits, Persian digits too', () => {
    expect(taxIdKey('DE 276 059 265')).toBe('276059265');
    expect(taxIdKey('۴۱۱-۱۱۱-۱۱۱')).toBe('411111111');
    expect(taxIdKey('12')).toBeNull();
    expect(taxIdKey(null)).toBeNull();
  });

  it('normalizes a vendor name: Arabic letters, spacing, case and legal words', () => {
    expect(vendorKey('شركت ونوس شيشه')).toBe(vendorKey('ونوس‌شیشه'));
    expect(vendorKey('Lidl GmbH & Co. KG')).toBe('lidl');
    expect(vendorKey('HELIX TOOLS')).toBe('helixtools');
    expect(vendorKey('Co')).toBeNull();
  });
});

describe('layoutFromBoxes', () => {
  it("takes one box per field (the user's first) and the line-items table with its row height", () => {
    const layout = layoutFromBoxes(
      [box('totalAmount', 0.2, 0.8), box('totalAmount', 0.3, 0.8, 'USER'), box('items.0', 0.05, 0.3), box('items.1', 0.05, 0.35), box('items.2', 0.05, 0.4), box('notAField', 0, 0)],
      [1.4, 2.0]
    )!;
    expect(layout.fields).toEqual({ totalAmount: { page: 0, x: 0.3, y: 0.8, width: 0.1, height: 0.04 } });
    expect(layout.items).toMatchObject({ page: 0, x: 0.05, y: 0.3, rowHeight: expect.closeTo(0.05) });
    expect(layout.items!.height).toBeCloseTo(0.14);
    // Only the pages it uses.
    expect(layout.pageAspects).toEqual([1.4]);
  });

  it('is null without boxes', () => {
    expect(layoutFromBoxes([], [1.4])).toBeNull();
  });
});

describe('fitsPages', () => {
  it('fits pages of about the same shape, not another form', () => {
    expect(fitsPages({ pageAspects: [1.41] }, [1.38, 2.1])).toBe(true);
    expect(fitsPages({ pageAspects: [1.41] }, [0.7])).toBe(false);
    expect(fitsPages({ pageAspects: [1.41, 1.41] }, [1.41])).toBe(false);
  });
});

describe('placeFromTemplate', () => {
  const layout = { pageAspects: [1.4], fields: { totalAmount: { page: 0, x: 0.2, y: 0.8, width: 0.2, height: 0.04 } }, items: { page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.1, rowHeight: 0.05 } };

  it('places each field it knows and line item i on row i, past the rows it learned', () => {
    const boxes = placeFromTemplate(layout, { fields: ['totalAmount', 'invoiceNumber'], items: 4 });
    expect(boxes.map((b) => b.field)).toEqual(['totalAmount', 'items.0', 'items.1', 'items.2', 'items.3']);
    expect(boxes[4]).toMatchObject({ y: expect.closeTo(0.45), height: 0.05 });
  });

  it('leaves out what is already placed, and rows off the page', () => {
    const boxes = placeFromTemplate({ ...layout, items: { ...layout.items, y: 0.9 } }, { fields: ['totalAmount'], items: 5 }, new Set(['totalAmount']));
    expect(boxes.map((b) => b.field)).toEqual(['items.0', 'items.1']);
  });
});

describe('bestTemplate', () => {
  const t = (id: string, o: Partial<StoredTemplate>): StoredTemplate => ({
    id,
    organizationId: 'org',
    shared: true,
    vendorTaxId: null,
    vendorKey: null,
    vendorName: null,
    pageAspects: [1],
    fields: {},
    items: null,
    timesSent: 0,
    timesCorrected: 0,
    updatedAt: new Date('2026-11-01'),
    words: [],
    samples: 1,
    look: null,
    chosen: {},
    guide: EMPTY_GUIDE,
    ...o
  });

  it('prefers the tax ID, then its own, then the most trusted', () => {
    const keys = { taxId: '123456', key: 'helixtools' };
    expect(bestTemplate([t('name', { vendorKey: 'helixtools' }), t('tax', { vendorTaxId: '123456', organizationId: 'other' })], 'org', keys)?.id).toBe('tax');
    expect(bestTemplate([t('shared', { vendorKey: 'helixtools', organizationId: 'other', timesSent: 9 }), t('own', { vendorKey: 'helixtools' })], 'org', keys)?.id).toBe('own');
    expect(bestTemplate([t('a', { vendorKey: 'helixtools', timesSent: 5, timesCorrected: 3 }), t('b', { vendorKey: 'helixtools', timesSent: 2 })], 'org', keys)?.id).toBe('b');
    expect(bestTemplate([], 'org', keys)).toBeNull();
  });
});
