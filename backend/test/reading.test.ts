import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cropRegion, documentPages } from '../src/reading/page-images';
import { ReadingRepository, StoredBox } from '../src/reading/reading.repository';
import { createReadingService, locateTargets, ReadableExpense } from '../src/reading/reading.service';
import { LocatedBox, toBoxes } from '../src/reading/vision-fields';
import { FileStorage } from '../src/expenses/ports';
import { FakeLlm } from './fakes';

const actor = { userId: 'u1', role: 'ACCOUNTANT' as const };

async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

function expense(overrides: Partial<ReadableExpense> = {}): ReadableExpense {
  return {
    id: 'e1',
    status: 'EXTRACTED',
    filePath: 'org/e1.jpg',
    mimeType: 'image/jpeg',
    rawExtraction: { provider: 'direct', data: { invoiceNumber: '4521', invoiceDate: '1405/07/28', totalAmount: 125000, currency: 'IRT' } },
    boxesLocatedAt: null,
    currency: 'IRR',
    originalCurrency: null,
    exchangeRate: null,
    invoiceNumber: '4521',
    totalAmount: 1250000,
    vendorName: 'فروشگاه نمونه',
    items: [{ description: 'میلگرد', totalPrice: 1250000 }],
    ...overrides
  };
}

class MemoryRepository implements ReadingRepository {
  boxes: StoredBox[] = [];
  located = 0;
  constructor(private readonly invoiceReader = 'TEMPLATE') {}
  async getReadingSettings() {
    return { invoiceReader: this.invoiceReader, country: 'IR' };
  }
  async listBoxes() {
    return this.boxes;
  }
  async saveModelBoxes(_id: string, boxes: LocatedBox[]) {
    this.located++;
    this.boxes = [...this.boxes.filter((b) => b.source !== 'MODEL'), ...boxes.map((b) => ({ ...b, source: 'MODEL' as const, value: null }))];
  }
  async saveUserBox(_id: string, box: LocatedBox, value: string | null) {
    this.boxes = [...this.boxes.filter((b) => !(b.source === 'USER' && b.field === box.field)), { ...box, source: 'USER', value }];
  }
}

async function service(options: { reader?: string; answer?: Record<string, unknown>; expense?: ReadableExpense } = {}) {
  const file = await jpeg(400, 200);
  const storage: FileStorage = { save: async () => '', read: async () => file, delete: async () => {} };
  const vision = new FakeLlm(options.answer ?? { boxes: [] });
  const repository = new MemoryRepository(options.reader);
  const reading = createReadingService({
    expenses: { getById: async () => options.expense ?? expense() },
    fileStorage: storage,
    vision: () => vision,
    repository
  });
  return { reading, vision, repository };
}

describe('toBoxes', () => {
  it("turns the model's [ymin, xmin, ymax, xmax] in 0-1000 into page fractions", () => {
    const boxes = toBoxes({ boxes: [{ field: 'totalAmount', page: 0, box_2d: [800, 100, 850, 400] }] }, new Set(['totalAmount']), 1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ field: 'totalAmount', page: 0, x: 0.1, y: 0.8 });
    expect(boxes[0].width).toBeCloseTo(0.3);
    expect(boxes[0].height).toBeCloseTo(0.05);
  });

  it('drops unknown fields, missing pages, empty boxes and repeats, and clamps to the page', () => {
    const boxes = toBoxes(
      {
        boxes: [
          { field: 'notAField', page: 0, box_2d: [0, 0, 100, 100] },
          { field: 'invoiceNumber', page: 3, box_2d: [0, 0, 100, 100] },
          { field: 'invoiceNumber', page: 0, box_2d: [100, 100, 100, 100] },
          { field: 'invoiceNumber', page: 0, box_2d: [-50, 900, 40, 1200] },
          { field: 'invoiceNumber', page: 0, box_2d: [500, 500, 600, 600] }
        ]
      },
      new Set(['invoiceNumber']),
      1
    );
    expect(boxes).toEqual([{ field: 'invoiceNumber', page: 0, x: 0.9, y: 0, width: expect.closeTo(0.1), height: expect.closeTo(0.04) }]);
  });
});

describe('locateTargets', () => {
  it('looks for the values as printed (Toman, Shamsi date), not as stored', () => {
    const { fields, items } = locateTargets(expense());
    expect(fields.find((f) => f.field === 'totalAmount')?.value).toBe('125000');
    expect(fields.find((f) => f.field === 'invoiceDate')?.value).toBe('1405/07/28');
    // Not in the reading's JSON: the saved value.
    expect(fields.find((f) => f.field === 'vendorName')?.value).toBe('فروشگاه نمونه');
    expect(items).toEqual([{ field: 'items.0', label: 'line item', value: 'میلگرد … 1250000' }]);
  });
});

describe('page images', () => {
  it('turns a photo upright, as the browser shows it', async () => {
    const [page] = await documentPages(await jpeg(400, 200, 6), 'image/jpeg');
    expect({ width: page.width, height: page.height }).toEqual({ width: 200, height: 400 });
  });

  it('has no page images for a PDF made from text', async () => {
    expect(await documentPages(Buffer.from('%PDF-1.4 text only'), 'application/pdf')).toEqual([]);
  });

  it('enlarges a small region so the model can read its digits', async () => {
    const [page] = await documentPages(await jpeg(400, 200), 'image/jpeg');
    const meta = await sharp(await cropRegion(page, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 })).metadata();
    expect(Math.min(meta.width!, meta.height!)).toBeGreaterThanOrEqual(384);
  });
});

describe('reading service', () => {
  it('shows no boxes and calls no AI for an organization on the classic reader', async () => {
    const { reading, vision } = await service({ reader: 'CLASSIC' });
    expect(await reading.getFieldBoxes('org', 'e1', actor)).toEqual({ enabled: false, pages: [], boxes: [] });
    expect(vision.requests).toHaveLength(0);
  });

  it('locates the fields the first time and keeps them', async () => {
    const { reading, vision, repository } = await service({
      answer: { boxes: [{ field: 'invoiceNumber', page: 0, box_2d: [50, 600, 90, 900] }] }
    });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.pages).toEqual([{ index: 0, width: 400, height: 200 }]);
    expect(result.boxes.map((b) => b.field)).toEqual(['invoiceNumber']);
    expect(vision.requests[0].image).toHaveLength(1);
    expect(repository.located).toBe(1);
  });

  it('does not locate again once located', async () => {
    const { reading, vision } = await service({ expense: expense({ boxesLocatedAt: new Date() }) });
    await reading.getFieldBoxes('org', 'e1', actor);
    expect(vision.requests).toHaveLength(0);
  });

  it('reads an amount from the drawn region in the stored unit (Toman as Rial)', async () => {
    const { reading, vision, repository } = await service({ answer: { value: '۱۲۵,۰۰۰' } });
    const region = { x: 0.1, y: 0.8, width: 0.3, height: 0.05 };
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region });
    expect(result.value).toBe(1250000);
    expect(vision.requests[0].prompt).toContain('the total amount to pay');
    expect(vision.requests[0].image).toHaveLength(2);
    expect(repository.boxes).toEqual([{ field: 'totalAmount', page: 0, ...region, source: 'USER', value: '۱۲۵,۰۰۰' }]);
  });

  it('restores the trailing zeros a handwritten total lost when the line items add up to it', async () => {
    const { reading } = await service({
      answer: { value: '16920000' },
      expense: expense({ rawExtraction: { mode: 'handwritten', data: { currency: 'IRR' } }, items: [{ description: 'اکسیژن', totalPrice: 163200000 }, { description: 'کرایه حمل', totalPrice: 6000000 }] })
    });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region: { x: 0, y: 0, width: 0.2, height: 0.1 } });
    expect(result.value).toBe(169200000);
  });

  it('keeps a total that the line items do not explain', async () => {
    const { reading } = await service({ answer: { value: '170000' }, expense: expense({ rawExtraction: { data: { currency: 'IRR' } } }) });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region: { x: 0, y: 0, width: 0.2, height: 0.1 } });
    expect(result.value).toBe(170000);
  });

  it('converts a Shamsi date read from the region', async () => {
    const { reading } = await service({ answer: { value: '1405/07/28' } });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'invoiceDate', page: 0, region: { x: 0, y: 0, width: 0.2, height: 0.1 } });
    expect(result.value).toBe('2026-10-20');
  });

  it('converts an amount when the invoice was converted into the default currency', async () => {
    const { reading } = await service({
      answer: { value: '100' },
      expense: expense({ rawExtraction: { data: { currency: 'EUR' } }, currency: 'IRR', originalCurrency: 'EUR', exchangeRate: 1_000_000 })
    });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region: { x: 0, y: 0, width: 0.2, height: 0.1 } });
    expect(result.value).toBe(100_000_000);
  });

  it('refuses fields that cannot be picked, and documents that can no longer be edited', async () => {
    const region = { x: 0, y: 0, width: 0.2, height: 0.1 };
    const { reading } = await service();
    await expect(reading.readRegion('org', 'e1', actor, { field: 'notes', page: 0, region })).rejects.toThrow('cannot be picked');
    const sent = await service({ expense: expense({ status: 'SENT' }) });
    await expect(sent.reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).rejects.toThrow('no longer be edited');
  });
});
