import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cropRegion, documentPages, pdfPaperInches, scanDpi } from '../src/reading/page-images';
import { ReadingRepository, StoredBox } from '../src/reading/reading.repository';
import { StoredTemplate } from '../src/reading/templates';
import { NewTemplate, TemplatesRepository } from '../src/reading/templates.repository';
import { createReadingService, locateTargets, ReadableExpense } from '../src/reading/reading.service';
import { printedAmount, printedDate, regionText } from '../src/reading/box-text';
import { LocatedBox, toBoxes } from '../src/reading/vision-fields';
import { FileStorage } from '../src/expenses/ports';
import type { OcrWord, PdfRenderer, PositionedOcrClient } from '@yazdan-learning/ai';
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
  templateId: string | null = null;
  shareTemplates = true;
  constructor(private readonly invoiceReader = 'TEMPLATE') {}
  async getReadingSettings() {
    return { invoiceReader: this.invoiceReader, country: 'IR', shareTemplates: this.shareTemplates };
  }
  async listBoxes() {
    return this.boxes;
  }
  async saveModelBoxes(_id: string, boxes: (LocatedBox & { source?: 'MODEL' | 'TEMPLATE'; value?: string | null })[], templateId: string | null = null) {
    this.located++;
    this.templateId = templateId;
    this.boxes = [
      ...this.boxes.filter((b) => b.source === 'USER'),
      ...boxes.map(({ source = 'MODEL', value = null, ...b }) => ({ ...b, source, value }))
    ];
  }
  async moveUserBox(_id: string, box: LocatedBox) {
    const value = this.boxes.find((b) => b.source === 'USER' && b.field === box.field)?.value ?? null;
    this.boxes = [...this.boxes.filter((b) => !(b.source === 'USER' && b.field === box.field)), { ...box, source: 'USER', value }];
  }
  removed: string[] = [];
  async removeBoxes(_id: string, field: string) {
    this.boxes = this.boxes.filter((b) => b.field !== field);
    this.removed = [...new Set([...this.removed, field])];
  }
  async listRemovedFields() {
    return this.removed;
  }
  async saveUserBox(_id: string, box: LocatedBox, value: string | null) {
    this.boxes = [...this.boxes.filter((b) => !(b.source === 'USER' && b.field === box.field)), { ...box, source: 'USER', value }];
  }
}

/** Templates in memory: candidates by tax ID or name key, the organization's own or shared. */
class MemoryTemplates implements TemplatesRepository {
  templates: StoredTemplate[] = [];
  uses: { id: string; corrected: boolean }[] = [];
  async findCandidates(organizationId: string, { taxId, key }: { taxId: string | null; key: string | null }) {
    return this.templates.filter(
      (t) => ((taxId && t.vendorTaxId === taxId) || (key && t.vendorKey === key)) && (t.organizationId === organizationId || t.shared)
    );
  }
  async findById(id: string) {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async create(template: NewTemplate) {
    const stored = { ...template, id: `t${this.templates.length + 1}`, timesSent: 0, timesCorrected: 0, updatedAt: new Date() };
    this.templates.push(stored);
    return stored;
  }
  async update(id: string, change: Partial<StoredTemplate>) {
    const t = this.templates.find((x) => x.id === id)!;
    Object.assign(t, Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined && v !== null)), { updatedAt: new Date() });
    return t;
  }
  async recordUse(id: string, corrected: boolean) {
    this.uses.push({ id, corrected });
  }
}

/** A template for the test vendor (فروشگاه نمونه, tax ID 411111111111) on a 400 x 200 page. */
const template = (overrides: Partial<StoredTemplate> = {}): StoredTemplate => ({
  id: 'tpl',
  organizationId: 'org',
  shared: true,
  vendorTaxId: '411111111111',
  vendorKey: 'نمونه',
  vendorName: 'فروشگاه نمونه',
  pageAspects: [0.5],
  fields: {
    vendorName: { page: 0, x: 0.6, y: 0.02, width: 0.3, height: 0.05 },
    invoiceNumber: { page: 0, x: 0.1, y: 0.1, width: 0.1, height: 0.04 },
    invoiceDate: { page: 0, x: 0.7, y: 0.1, width: 0.2, height: 0.04 },
    totalAmount: { page: 0, x: 0.2, y: 0.8, width: 0.2, height: 0.04 }
  },
  items: { page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.1, rowHeight: 0.05 },
  timesSent: 3,
  timesCorrected: 0,
  updatedAt: new Date('2026-11-01'),
  ...overrides
});

/** Word OCR answering with the given words on every page, or failing. */
class FakeWords implements PositionedOcrClient {
  calls: { languages?: string; contentType?: string }[] = [];
  constructor(private readonly words: OcrWord[] | Error) {}
  async readWords(file: { contentType: string }, options: { languages?: string } = {}) {
    this.calls.push({ ...options, contentType: file.contentType });
    if (this.words instanceof Error) throw this.words;
    return { pages: [{ index: 0, width: 400, height: 200, source: 'ocr' as const, text: '', words: this.words }] };
  }
  async extractText() {
    return '';
  }
}

const word = (text: string, x: number, y: number): OcrWord => ({ text, confidence: 0.9, line: 0, box: { x, y, width: 0.1, height: 0.04 } });

/** Draws every PDF as one white 300 x 400 page. */
const fakeRenderer = (): PdfRenderer & { calls: number } => {
  const renderer = {
    calls: 0,
    async renderPdf() {
      renderer.calls++;
      return [{ index: 0, width: 300, height: 400, buffer: await jpeg(300, 400) }];
    }
  };
  return renderer;
};

async function service(
  options: {
    reader?: string;
    answer?: Record<string, unknown> | Error;
    expense?: ReadableExpense;
    words?: FakeWords;
    renderer?: PdfRenderer;
    file?: Buffer;
    templates?: MemoryTemplates;
  } = {}
) {
  const file = options.file ?? (await jpeg(400, 200));
  const storage: FileStorage = { save: async () => '', read: async () => file, delete: async () => {} };
  const vision = new FakeLlm(options.answer instanceof Error ? {} : (options.answer ?? { boxes: [] }));
  if (options.answer instanceof Error) {
    const failure = options.answer;
    vision.complete = async (request) => {
      vision.requests.push(request);
      throw failure;
    };
  }
  const repository = new MemoryRepository(options.reader);
  const templates = options.templates ?? new MemoryTemplates();
  const reading = createReadingService({
    templates,
    expenses: { getById: async () => options.expense ?? expense() },
    fileStorage: storage,
    vision: () => vision,
    words: options.words ? () => options.words! : undefined,
    renderer: options.renderer ? () => options.renderer! : undefined,
    repository
  });
  return { reading, vision, repository, templates };
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

  it("measures a scan's dpi on its paper: the side that fills the page", () => {
    const a4 = pdfPaperInches(Buffer.from('%PDF-1.4 1 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj'))!;
    expect(a4.width).toBeCloseTo(8.26, 2);
    expect(a4.height).toBeCloseTo(11.69, 2);
    // A CamScanner page: 746 x 1000 px fills the width (90 dpi); a narrower one fills the height.
    expect(scanDpi({ width: 746, height: 1000 }, a4)).toBe(90);
    expect(scanDpi({ width: 462, height: 1000 }, a4)).toBe(86);
    expect(pdfPaperInches(Buffer.from('no media box'))).toBeNull();
    // A PDF made from a photo: one point per pixel, a 34 x 46 inch "page". Not paper, so no dpi.
    expect(pdfPaperInches(Buffer.from('/MediaBox[ 0 0 2452 3308]'))).toBeNull();
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
    expect(await reading.getFieldBoxes('org', 'e1', actor)).toEqual({ enabled: false, pages: [], boxes: [], missing: [] });
    expect(vision.requests).toHaveLength(0);
  });

  it('without word OCR, one vision model call places the fields; what it misses stays missing', async () => {
    const { reading, vision, repository } = await service({ answer: { boxes: [{ field: 'invoiceNumber', page: 0, box_2d: [50, 600, 90, 900] }] } });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.pages).toEqual([{ index: 0, width: 400, height: 200 }]);
    expect(result.boxes.map((b) => b.field)).toEqual(['invoiceNumber']);
    expect(result.missing.sort()).toEqual(['invoiceDate', 'items.0', 'totalAmount', 'vendorName']);
    expect(vision.requests).toHaveLength(1);
    expect(repository.located).toBe(1);
  });

  it('does not locate again once located', async () => {
    const ocr = new FakeWords([]);
    const { reading } = await service({ words: ocr, expense: expense({ boxesLocatedAt: new Date() }) });
    await reading.getFieldBoxes('org', 'e1', actor);
    expect(ocr.calls).toHaveLength(0);
  });

  it("keeps a moved box as the user's, with what was read from it", async () => {
    const { reading, repository } = await service();
    repository.boxes = [
      { field: 'totalAmount', page: 0, x: 0.1, y: 0.1, width: 0.1, height: 0.1, source: 'MODEL', value: null },
      { field: 'totalAmount', page: 0, x: 0.1, y: 0.1, width: 0.1, height: 0.1, source: 'USER', value: '125,000' }
    ];
    const region = { x: 0.5, y: 0.6, width: 0.2, height: 0.05 };
    const { boxes } = await reading.moveFieldBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region });
    expect(boxes.find((b) => b.source === 'USER')).toEqual({ field: 'totalAmount', page: 0, ...region, source: 'USER', value: '125,000' });
  });

  it('moves line-item boxes, refuses unknown fields and locked documents', async () => {
    const region = { x: 0.5, y: 0.6, width: 0.2, height: 0.05 };
    const { reading } = await service();
    await expect(reading.moveFieldBox('org', 'e1', actor, { field: 'items.0', page: 0, region })).resolves.toBeTruthy();
    await expect(reading.moveFieldBox('org', 'e1', actor, { field: 'items.5', page: 0, region })).rejects.toThrow('no box');
    await expect(reading.moveFieldBox('org', 'e1', actor, { field: 'notes', page: 0, region })).rejects.toThrow('no box');
    await expect(reading.moveFieldBox('org', 'e1', actor, { field: 'totalAmount', page: 3, region })).rejects.toThrow('no such page');
    const sent = await service({ expense: expense({ status: 'SENT' }) });
    await expect(sent.reading.moveFieldBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).rejects.toThrow('no longer be edited');
  });

  it("removes a field's boxes, which then counts as missing", async () => {
    const { reading, repository } = await service();
    repository.boxes = [{ field: 'totalAmount', page: 0, x: 0.1, y: 0.1, width: 0.1, height: 0.1, source: 'MODEL', value: null }];
    expect((await reading.removeFieldBox('org', 'e1', actor, 'totalAmount')).boxes).toEqual([]);
  });

  it('reads an amount from the drawn region in the stored unit (Toman as Rial)', async () => {
    const { reading, vision, repository } = await service({ answer: { value: '۱۲۵,۰۰۰' } });
    const region = { x: 0.1, y: 0.8, width: 0.3, height: 0.05 };
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region });
    expect(result.value).toBe(1250000);
    expect(vision.requests[0].prompt).toContain('the total amount to pay');
    // A printed invoice: only the region, enlarged.
    expect(vision.requests[0].image).toHaveLength(1);
    expect(repository.boxes).toEqual([{ field: 'totalAmount', page: 0, ...region, source: 'USER', value: '۱۲۵,۰۰۰' }]);
  });

  it('says when the framed text is clearly something else, with the value read anyway', async () => {
    const region = { x: 0.1, y: 0.1, width: 0.3, height: 0.05 };
    const { reading } = await service({ answer: { value: 'خوش آبادی', fits: false, looksLike: 'customerName' } });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'vendorAddress', page: 0, region });
    expect(result).toMatchObject({ value: 'خوش آبادی', looksLike: 'customerName' });
    const fits = await service({ answer: { value: 'تهران', fits: true, looksLike: null } });
    expect((await fits.reading.readRegion('org', 'e1', actor, { field: 'vendorAddress', page: 0, region })).looksLike).toBeUndefined();
    const unknown = await service({ answer: { value: 'x', fits: false, looksLike: 'a sandwich' } });
    expect((await unknown.reading.readRegion('org', 'e1', actor, { field: 'vendorAddress', page: 0, region })).looksLike).toBeUndefined();
  });

  it('restores the trailing zeros a handwritten total lost when the line items add up to it', async () => {
    const { reading, vision } = await service({
      answer: { value: '16920000' },
      expense: expense({ rawExtraction: { mode: 'handwritten', data: { currency: 'IRR' } }, items: [{ description: 'اکسیژن', totalPrice: 163200000 }, { description: 'کرایه حمل', totalPrice: 6000000 }] })
    });
    const result = await reading.readRegion('org', 'e1', actor, { field: 'totalAmount', page: 0, region: { x: 0, y: 0, width: 0.2, height: 0.1 } });
    expect(result.value).toBe(169200000);
    // Handwriting: the whole page with the region framed, then the region.
    expect(vision.requests[0].image).toHaveLength(2);
    expect(vision.requests[0].prompt).toContain('red frame');
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

describe('field boxes from word positions', () => {
  // The invoice number 4521 and the total 125,000 are on the page; the vendor and the line item are not.
  const words = () => new FakeWords([word('Nr.', 0.1, 0.1), word('4521', 0.25, 0.1), word('جمع', 0.1, 0.8), word('125,000', 0.25, 0.8)]);

  it('when the words place less than half, asks the vision model for the rest only', async () => {
    const ocr = words();
    const { reading, vision } = await service({ words: ocr, answer: { boxes: [{ field: 'vendorName', page: 0, box_2d: [0, 0, 50, 300] }] } });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.boxes.map((b) => b.field).sort()).toEqual(['invoiceNumber', 'totalAmount', 'vendorName']);
    expect(result.boxes.find((b) => b.field === 'invoiceNumber')).toMatchObject({ x: 0.25, y: 0.1 });
    expect(result.missing.sort()).toEqual(['invoiceDate', 'items.0']);
    expect(vision.requests).toHaveLength(1);
    expect(vision.requests[0].prompt).toContain('vendorName');
    expect(vision.requests[0].prompt).not.toContain('invoiceNumber (');
    // The Iranian organization's languages.
    expect(ocr.calls[0].languages).toBe('fas+eng');
  });

  it('does not call the vision model when the words place half or more', async () => {
    const { reading, vision } = await service({
      words: words(),
      expense: expense({ vendorName: null, items: [{ description: 'میلگرد', totalPrice: 1250000 }], rawExtraction: { data: { invoiceNumber: '4521', totalAmount: 125000 } } })
    });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.boxes.map((b) => b.field).sort()).toEqual(['invoiceNumber', 'totalAmount']);
    expect(vision.requests).toHaveLength(0);
  });

  it('keeps the boxes from the words when the vision model fails', async () => {
    const { reading, repository } = await service({ words: words(), answer: new Error('vision down') });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.error).toBeUndefined();
    expect(result.boxes.map((b) => b.field).sort()).toEqual(['invoiceNumber', 'totalAmount']);
    expect(repository.located).toBe(1);
    // The vision call is tried 3 times, 3 s apart.
  }, 15_000);

  it('falls back to the vision model for everything when the word OCR fails', async () => {
    const { reading, vision } = await service({ words: new FakeWords(new Error('ECONNREFUSED')) });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.error).toBeUndefined();
    expect(vision.requests[0].prompt).toContain('invoiceNumber');
  });

  it('skips the word OCR for handwriting, which it cannot read', async () => {
    const ocr = words();
    const { reading, vision } = await service({ words: ocr, expense: expense({ rawExtraction: { mode: 'handwritten', data: { invoiceNumber: '4521' } } }) });
    await reading.getFieldBoxes('org', 'e1', actor);
    expect(ocr.calls).toHaveLength(0);
    expect(vision.requests).toHaveLength(1);
  });

  it('reads a foreign receipt in an Iranian organization with the international languages', async () => {
    const ocr = words();
    const { reading } = await service({ words: ocr, expense: expense({ rawExtraction: { template: { foreignReceipt: true }, data: { invoiceNumber: '4521' } } }) });
    await reading.getFieldBoxes('org', 'e1', actor);
    expect(ocr.calls[0].languages).toBe('eng+deu+tur');
  });
});

describe('PDF made from text', () => {
  const textPdf = Buffer.from('%PDF-1.4 1 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj');
  const pdfExpense = () => expense({ filePath: 'org/e1.pdf', mimeType: 'application/pdf' });

  it('is drawn as page images, with no dpi warning (it is not a scan)', async () => {
    const renderer = fakeRenderer();
    const { reading } = await service({ file: textPdf, renderer, expense: pdfExpense(), words: new FakeWords([]) });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.pages).toEqual([{ index: 0, width: 300, height: 400 }]);
    expect(result.lowResolutionDpi).toBeUndefined();
    expect(renderer.calls).toBe(1);
  });

  it("takes the boxes from the PDF's own words, not from OCR of the drawn page", async () => {
    const ocr = new FakeWords([word('4521', 0.25, 0.1)]);
    const { reading } = await service({ file: textPdf, renderer: fakeRenderer(), expense: pdfExpense(), words: ocr });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(ocr.calls).toEqual([{ languages: 'fas+eng', contentType: 'application/pdf' }]);
    expect(result.boxes.find((b) => b.field === 'invoiceNumber')).toMatchObject({ x: 0.25, y: 0.1 });
  });

  it('has no viewer without a renderer, as before', async () => {
    const { reading } = await service({ file: textPdf, expense: pdfExpense() });
    expect((await reading.getFieldBoxes('org', 'e1', actor)).pages).toEqual([]);
  });
});

describe('getReadingChecks', () => {
  // The Lidl receipt: 0,85 read as 0,65 and -0,48 as -0,40, so the lines are 12 cents short.
  const lidl = (overrides: Partial<ReadableExpense> = {}) =>
    expense({
      currency: 'EUR',
      totalAmount: 16.72,
      rawExtraction: { provider: 'direct', ocrText: '| Gesamter Preisvorteil |\n| 1,83 EUR gespart |', template: { smallImage: true } },
      items: [
        ['Snack Gurken', 1, 1.49, 1.49],
        ['Lidl Plus Rabatt', 1, -0.15, -0.15],
        ['Cherrystrauchtomaten', 2, 4.49, 8.98],
        ['Bio Milch', 3, 1.35, 4.05],
        ['Lidl Plus Rabatt', 1, -0.4, -0.4],
        ['Bioland Haferfl.zart', 1, 0.65, 0.65],
        ['Schokotröpfchen', 2, 1.59, 3.18],
        ['Preisvorteil', 1, -1.2, -1.2]
      ].map(([description, quantity, unitPrice, totalPrice]) => ({ description: String(description), quantity, unitPrice, totalPrice })) as ReadableExpense['items'],
      ...overrides
    });

  it('suggests the misread price and marks the lines to compare', async () => {
    const { reading } = await service({ expense: lidl() });
    const checks = await reading.getReadingChecks('org', 'e1', actor);
    expect(checks.smallImage).toBe(true);
    expect(checks.lines.find((l) => l.index === 5)).toEqual({ index: 5, suggested: 0.85, level: 'likely' });
    expect(checks.lines.filter((l) => l.compare).map((l) => l.index)).toEqual([4, 7]);
  });

  it('flags quantity × unit price and leaves a far-off total without guesses', async () => {
    const { reading } = await service({
      expense: lidl({ totalAmount: 30, items: [{ description: 'Tomaten', quantity: 2, unitPrice: 4.49, totalPrice: 8.9 }] as ReadableExpense['items'] })
    });
    expect((await reading.getReadingChecks('org', 'e1', actor)).lines).toEqual([{ index: 0, quantityTimesPrice: { quantity: 2, unitPrice: 4.49, expected: 8.98 } }]);
  });

  it('is off for the classic reader', async () => {
    const { reading } = await service({ reader: 'CLASSIC', expense: lidl() });
    expect(await reading.getReadingChecks('org', 'e1', actor)).toEqual({ enabled: false, lines: [], smallImage: false });
  });
});

describe('reading a box from its words', () => {
  const word2 = (text: string, x: number, y: number, line: number): OcrWord => ({ text, confidence: 0.9, line, box: { x, y, width: 0.05, height: 0.02 } });

  it('orders the words: lines top to bottom, Persian lines right to left', () => {
    expect(regionText([word2('B', 0.5, 0.1, 0), word2('A', 0.1, 0.1, 0), word2('C', 0.1, 0.3, 1)])).toBe('A B C');
    expect(regionText([word2('خرمند', 0.1, 0.1, 0), word2('۲۰۱۴', 0.5, 0.1, 0)])).toBe('۲۰۱۴ خرمند');
  });

  it('finds the amount in printed text', () => {
    expect(printedAmount('Summe 16,72')).toBe(16.72);
    expect(printedAmount('Lidl Plus Rabatt -0,40')).toBe(-0.4);
    expect(printedAmount('۲٬۳۹۰٬۰۰۰٬۰۰۰ ریال')).toBe(2390000000);
    expect(printedAmount('1.250.000')).toBe(1250000);
    expect(printedAmount('EUR')).toBeNull();
  });

  it('finds the date in printed text, day first or year first, Shamsi converted', () => {
    expect(printedDate('07.11.26 14:32')).toBe('2026-11-07');
    expect(printedDate('Datum: 2026-11-07')).toBe('2026-11-07');
    expect(printedDate('تاریخ ۱۴۰۵/۰۷/۲۸')).toBe('2026-10-20');
    expect(printedDate('Kasse 12')).toBeNull();
  });

  // The invoice number 4521 and the total 125,000 (Toman) are on the page.
  const ocrWords = () => new FakeWords([word('Nr.', 0.1, 0.1), word('4521', 0.25, 0.1), word('جمع', 0.1, 0.8), word('125,000', 0.25, 0.8)]);

  it('reads the words the page already has, in the form units, with no model and no new OCR', async () => {
    const ocr = ocrWords();
    const { reading, vision, repository } = await service({ words: ocr });
    await reading.getFieldBoxes('org', 'e1', actor);
    const modelCallsOnOpen = vision.requests.length;
    const region = { x: 0.2, y: 0.78, width: 0.2, height: 0.08 };
    const result = await reading.readBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region });
    expect(result).toMatchObject({ value: 1250000, read: '125,000' });
    expect(result.reason).toBeUndefined();
    expect(ocr.calls).toHaveLength(1);
    expect(vision.requests).toHaveLength(modelCallsOnOpen);
    expect(repository.boxes.find((b) => b.source === 'USER')).toMatchObject({ field: 'totalAmount', value: '125,000' });
  });

  it('reads just the box with word OCR when the page words are not at hand', async () => {
    // Words of the crop, in the crop's fractions.
    const ocr = new FakeWords([word('4521', 0.4, 0.4)]);
    const { reading } = await service({ words: ocr, expense: expense({ boxesLocatedAt: new Date() }) });
    const result = await reading.readBox('org', 'e1', actor, { field: 'invoiceNumber', page: 0, region: { x: 0.2, y: 0.05, width: 0.3, height: 0.15 } });
    expect(result.value).toBe('4521');
    expect(ocr.calls).toEqual([{ languages: 'fas+eng', contentType: 'image/jpeg' }]);
  });

  it('says why there is no value: nothing printed, handwriting, no word OCR', async () => {
    const empty = await service({ words: ocrWords() });
    await empty.reading.getFieldBoxes('org', 'e1', actor);
    const region = { x: 0.6, y: 0.5, width: 0.2, height: 0.1 };
    expect((await empty.reading.readBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).reason).toBe('empty');

    const ocr = ocrWords();
    const handwritten = await service({ words: ocr, expense: expense({ rawExtraction: { mode: 'handwritten', data: {} } }) });
    expect((await handwritten.reading.readBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).reason).toBe('handwritten');
    expect(ocr.calls).toHaveLength(0);

    const none = await service();
    expect((await none.reading.readBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).reason).toBe('unavailable');
  });

  it('refuses line items and locked documents', async () => {
    const region = { x: 0.2, y: 0.05, width: 0.3, height: 0.15 };
    const { reading } = await service({ words: ocrWords() });
    await expect(reading.readBox('org', 'e1', actor, { field: 'items.0', page: 0, region })).rejects.toThrow('cannot be read');
    const sent = await service({ words: ocrWords(), expense: expense({ status: 'SENT' }) });
    await expect(sent.reading.readBox('org', 'e1', actor, { field: 'totalAmount', page: 0, region })).rejects.toThrow('no longer be edited');
  });
});

describe('invoice templates', () => {
  // The test invoice is from فروشگاه نمونه; give it the tax ID the template knows.
  const fromVendor = (overrides: Partial<ReadableExpense> = {}) => expense({ vendorTaxId: '۴۱۱۱۱۱۱۱۱۱۱۱', ...overrides });

  it("places the boxes from the vendor's template, with no vision model call", async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template());
    const { reading, vision, repository } = await service({ templates, expense: fromVendor() });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(vision.requests).toHaveLength(0);
    expect(result.boxes.filter((b) => b.source === 'TEMPLATE').map((b) => b.field).sort()).toEqual(['invoiceDate', 'invoiceNumber', 'items.0', 'totalAmount', 'vendorName']);
    expect(result.boxes.find((b) => b.field === 'items.0')).toMatchObject({ x: 0.05, y: 0.3, height: 0.05 });
    expect(result.template).toEqual({ vendorName: 'فروشگاه نمونه', shared: false, timesSent: 3 });
    expect(repository.templateId).toBe('tpl');
  });

  it("uses another organization's shared template for a new client", async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template({ organizationId: 'other-org' }));
    const { reading, vision } = await service({ templates, expense: fromVendor() });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(vision.requests).toHaveLength(0);
    expect(result.template?.shared).toBe(true);
  });

  it('finds the template by the vendor name when there is no tax ID', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template({ vendorTaxId: null }));
    const { reading } = await service({ templates });
    expect((await reading.getFieldBoxes('org', 'e1', actor)).template?.vendorName).toBe('فروشگاه نمونه');
  });

  it('keeps the exact boxes from the words, the template fills the rest', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template());
    const words = new FakeWords([word('4521', 0.4, 0.5)]);
    const { reading } = await service({ templates, words, expense: fromVendor() });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.boxes.find((b) => b.field === 'invoiceNumber')).toMatchObject({ source: 'MODEL', x: 0.4, y: 0.5 });
    expect(result.boxes.find((b) => b.field === 'totalAmount')?.source).toBe('TEMPLATE');
  });

  it('places the template boxes of fields the reading left empty, and reads what each holds for the review page', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(
      template({ fields: { ...template().fields, vendorAddress: { page: 0, x: 0.5, y: 0.4, width: 0.4, height: 0.05 }, totalAmount: { page: 0, x: 0.6, y: 0.6, width: 0.2, height: 0.05 } } })
    );
    // The address is printed where the template has it; the total box holds 99,000 while the reading says 125,000 (Toman).
    const words = new FakeWords([word('تهران', 0.55, 0.405), word('99,000', 0.62, 0.605)]);
    const { reading } = await service({ templates, words, expense: fromVendor() });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.boxes.find((b) => b.field === 'vendorAddress')).toMatchObject({ source: 'TEMPLATE', value: 'تهران' });
    expect(result.templateValues).toEqual(
      expect.arrayContaining([
        { field: 'vendorAddress', text: 'تهران', value: 'تهران' },
        // In the form's units: Toman as Rial.
        { field: 'totalAmount', text: '99,000', value: 990000 },
        { field: 'invoiceNumber', text: null, value: null }
      ])
    );
  });

  it('ignores a template made for pages of another shape (another form)', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template({ pageAspects: [1.41] }));
    const { reading, vision } = await service({ templates, expense: fromVendor() });
    const result = await reading.getFieldBoxes('org', 'e1', actor);
    expect(result.template).toBeUndefined();
    expect(vision.requests).toHaveLength(1);
  });

  it("learns a new template from a sent invoice's boxes", async () => {
    const { reading, repository, templates } = await service({ expense: fromVendor() });
    repository.boxes = [
      { field: 'invoiceNumber', page: 0, x: 0.1, y: 0.1, width: 0.1, height: 0.04, source: 'MODEL', value: null },
      { field: 'totalAmount', page: 0, x: 0.2, y: 0.8, width: 0.2, height: 0.04, source: 'MODEL', value: null },
      { field: 'totalAmount', page: 0, x: 0.25, y: 0.82, width: 0.2, height: 0.04, source: 'USER', value: null },
      { field: 'items.0', page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.05, source: 'MODEL', value: null },
      { field: 'items.1', page: 0, x: 0.05, y: 0.36, width: 0.9, height: 0.05, source: 'MODEL', value: null }
    ];
    expect(await reading.learnTemplate('org', 'e1', actor)).toEqual({ vendorName: 'فروشگاه نمونه', created: true });
    const [learned] = templates.templates;
    expect(learned).toMatchObject({ organizationId: 'org', shared: true, vendorTaxId: '411111111111', vendorKey: 'نمونه', pageAspects: [0.5] });
    // The user's box wins.
    expect(learned.fields.totalAmount).toEqual({ page: 0, x: 0.25, y: 0.82, width: 0.2, height: 0.04 });
    expect(learned.items).toMatchObject({ page: 0, x: 0.05, y: 0.3, rowHeight: expect.closeTo(0.06) });
  });

  it("updates the organization's own template, keeping the fields an invoice that didn't use it had no box for", async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template());
    const { reading, repository } = await service({ templates, expense: fromVendor() });
    repository.boxes = [{ field: 'invoiceNumber', page: 0, x: 0.12, y: 0.1, width: 0.1, height: 0.04, source: 'USER', value: null }];
    expect(await reading.learnTemplate('org', 'e1', actor)).toEqual({ vendorName: 'فروشگاه نمونه', created: false });
    expect(templates.templates).toHaveLength(1);
    expect(templates.templates[0].fields.invoiceNumber.x).toBe(0.12);
    expect(templates.templates[0].fields.totalAmount).toBeDefined();
    expect(templates.uses).toEqual([]);
  });

  it("keeps a field the template learned after this invoice was opened (it never had that box, it wasn't removed)", async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template({ fields: { ...template().fields, vendorAddress: { page: 0, x: 0.5, y: 0.4, width: 0.4, height: 0.05 } } }));
    const { reading, repository } = await service({ templates, expense: fromVendor({ templateId: 'tpl' }) });
    // Opened before the template knew the address: no address box, and the user removed nothing.
    repository.boxes = Object.entries(template().fields).map(([field, box]) => ({ field, ...box, source: 'TEMPLATE' as const, value: null }));
    await reading.learnTemplate('org', 'e1', actor);
    expect(templates.templates[0].fields.vendorAddress).toBeDefined();
    expect(templates.uses).toEqual([{ id: 'tpl', corrected: false }]);
  });

  it('counts a correction when the user moved a box the template placed', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template());
    const { reading, repository } = await service({ templates, expense: fromVendor({ templateId: 'tpl' }) });
    repository.boxes = Object.entries(template().fields).map(([field, box]) => ({ field, ...box, source: 'TEMPLATE' as const, value: null }));
    repository.boxes.push({ field: 'invoiceNumber', page: 0, x: 0.12, y: 0.1, width: 0.1, height: 0.04, source: 'USER', value: null });
    await reading.learnTemplate('org', 'e1', actor);
    expect(templates.templates[0].fields.invoiceNumber.x).toBe(0.12);
    expect(templates.uses).toEqual([{ id: 'tpl', corrected: true }]);
  });

  it('forgets a field whose template box the user removed, and counts that as a correction', async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template());
    const { reading, repository } = await service({ templates, expense: fromVendor({ templateId: 'tpl' }) });
    repository.boxes = Object.entries(template().fields).map(([field, box]) => ({ field, ...box, source: 'TEMPLATE' as const, value: null }));
    await reading.removeFieldBox('org', 'e1', actor, 'invoiceNumber');
    await reading.learnTemplate('org', 'e1', actor);
    expect(Object.keys(templates.templates[0].fields).sort()).toEqual(['invoiceDate', 'totalAmount', 'vendorName']);
    expect(templates.uses).toEqual([{ id: 'tpl', corrected: true }]);
  });

  it("gives a new client its own copy of a shared template it used, and counts the use on the shared one", async () => {
    const templates = new MemoryTemplates();
    templates.templates.push(template({ organizationId: 'other-org' }));
    const { reading, repository } = await service({ templates, expense: fromVendor({ templateId: 'tpl' }) });
    repository.boxes = Object.entries(template().fields).map(([field, box]) => ({ field, ...box, source: 'TEMPLATE' as const, value: null }));
    repository.shareTemplates = false;
    expect(await reading.learnTemplate('org', 'e1', actor)).toMatchObject({ created: true });
    expect(templates.templates.map((t) => [t.organizationId, t.shared])).toEqual([
      ['other-org', true],
      ['org', false]
    ]);
    expect(templates.uses).toEqual([{ id: 'tpl', corrected: false }]);
  });

  it('learns nothing on the classic reader, without boxes or without a vendor', async () => {
    const classic = await service({ reader: 'CLASSIC', expense: fromVendor() });
    classic.repository.boxes = [{ field: 'totalAmount', page: 0, x: 0.2, y: 0.8, width: 0.2, height: 0.04, source: 'MODEL', value: null }];
    expect(await classic.reading.learnTemplate('org', 'e1', actor)).toBeNull();
    const empty = await service({ expense: fromVendor() });
    expect(await empty.reading.learnTemplate('org', 'e1', actor)).toBeNull();
    const nameless = await service({ expense: expense({ vendorName: null, vendorTaxId: null }) });
    nameless.repository.boxes = [{ field: 'totalAmount', page: 0, x: 0.2, y: 0.8, width: 0.2, height: 0.04, source: 'MODEL', value: null }];
    expect(await nameless.reading.learnTemplate('org', 'e1', actor)).toBeNull();
    expect(classic.templates.templates.length + empty.templates.templates.length + nameless.templates.templates.length).toBe(0);
  });
});
