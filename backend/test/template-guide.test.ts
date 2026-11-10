import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { OcrFile, OcrPage, OcrWord, PositionedOcrClient } from '@yazdan-learning/ai';
import { DirectInvoiceExtractor } from '../src/expenses/adapters/direct-extractor';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../src/expenses/ports';
import { international } from '../src/countries/international';
import { TemplateInvoiceExtractor } from '../src/reading/template-extractor';
import type { TemplateMatch } from '../src/reading/template-finder';
import { checkGuidedReading, differences, isTrusted, templateHints } from '../src/reading/template-guide';
import { IDENTITY } from '../src/reading/template-match';
import { labelBefore, StoredTemplate, taxIdsInText, valueAfter, vendorKeysInText } from '../src/reading/templates';
import { TemplateKeys, TemplatesRepository } from '../src/reading/templates.repository';
import { EMPTY_GUIDE, learnGuide } from '../src/reading/form-guide';
import { FakeLlm, FakeOcr, invoiceAnswer, photo } from './fakes';

const template = (o: Partial<StoredTemplate> = {}): StoredTemplate => ({
  id: 'tpl',
  organizationId: 'org',
  shared: true,
  vendorTaxId: null,
  vendorKey: 'helixtools',
  vendorName: 'HELIX TOOLS',
  pageAspects: [1],
  fields: {
    invoiceNumber: { page: 0, x: 0.1, y: 0.1, width: 0.15, height: 0.04 },
    totalAmount: { page: 0, x: 0.1, y: 0.8, width: 0.2, height: 0.04 }
  },
  items: { page: 0, x: 0.05, y: 0.3, width: 0.9, height: 0.4, rowHeight: 0.025 },
  timesSent: 5,
  timesCorrected: 0,
  updatedAt: new Date('2026-11-01'),
  words: [
    { text: 'شماره', page: 0, x: 0.32, y: 0.12, seen: 3 },
    { text: 'فاکتور', page: 0, x: 0.28, y: 0.12, seen: 3 },
    { text: 'جمع', page: 0, x: 0.35, y: 0.82, seen: 3 }
  ],
  samples: 3,
  look: null,
  chosen: {},
  guide: EMPTY_GUIDE,
  ...o
});

const match = (o: Partial<StoredTemplate> = {}, by: TemplateMatch['by'] = 'vendor'): TemplateMatch => ({ template: template(o), by, transforms: [IDENTITY] });

const data = (o: Partial<ExtractedInvoiceData> = {}): ExtractedInvoiceData => ({
  invoiceNumber: '70697',
  invoiceDate: '2026-10-13',
  dueDate: null,
  vendorName: 'HELIX TOOLS',
  vendorAddress: null,
  vendorTaxId: null,
  customerName: null,
  customerAddress: null,
  items: [{ description: 'Drill', quantity: 1, unitPrice: 100, totalPrice: 100 }],
  subtotal: null,
  taxRate: null,
  taxAmount: null,
  totalAmount: 100,
  currency: 'EUR',
  paymentMethod: null,
  paymentTerms: null,
  notes: null,
  ...o
});

const result = (o: Partial<ExtractedInvoiceData> = {}): ExtractionResult => ({
  success: true,
  data: data(o),
  raw: { provider: 'direct', data: { ...data(o) } }
});

const word = (text: string, x: number, y: number): OcrWord => ({ text, confidence: 0.95, line: 0, box: { x, y, width: 0.05, height: 0.02 } });
const page = (words: OcrWord[]): OcrPage => ({ index: 0, width: 1000, height: 1000, source: 'ocr', text: '', words });

describe('finding the vendor in the OCR text', () => {
  it("gives every run of up to four words as a name key, and the digit runs that could be a tax ID", () => {
    const text = 'HELIX\nTOOLS GmbH\nفروشگاه آبدین هوا رسان\nکد اقتصادی: ۴۱۱ ۱۱۱ ۱۱۱ ۱۱۱\nTel 12';
    const keys = vendorKeysInText(text);
    expect(keys).toContain('helixtools');
    expect(keys).toContain('آبدینهوارسان');
    expect(keys).not.toContain('tel');
    expect(taxIdsInText(text)).toEqual(['411111111111']);
  });
});

describe('labels of chosen values', () => {
  const OCR = 'F-LO-005\n| اطلاعات خروج | |\n|  شماره خروج SF9903 | تاریخ ۱۴۰۵/۷/۲۹ |\n|  شماره قرارداد TC4456 | شماره محموله CK7147 |\nRechnungsnr.: 4521';
  it('finds the printed words before a value in its cell or line, and the value after them on another invoice', () => {
    expect(labelBefore(OCR, 'SF9903')).toBe('شماره خروج');
    expect(labelBefore(OCR, '4521')).toBe('Rechnungsnr');
    expect(labelBefore(OCR, 'F-LO-005')).toBeNull();
    expect(valueAfter(OCR.replace('SF9903', 'SF9911'), 'شماره خروج')).toBe('SF9911');
    expect(valueAfter(OCR, 'شماره فاکتور')).toBeNull();
  });
});

describe('templateHints', () => {
  it("tells the model where the form prints each value, with the printed words next to it", () => {
    const hints = templateHints(match(), { withImage: true });
    expect(hints).toContain(`vendor is most likely "HELIX TOOLS"`);
    expect(hints).toContain('- invoiceNumber: top left');
    expect(hints).toContain('next to the printed words "شماره فاکتور"');
    expect(hints).toContain('- items: a table starting about 30% down');
  });

  it("gives a reading of OCR text only the user's rules, no places or guessed labels", () => {
    const hints = templateHints(match());
    expect(hints).not.toContain('شماره فاکتور');
    expect(hints).toContain('every line item as you normally would');
    expect(hints).not.toContain('% down');
    expect(hints).not.toContain('- items');
  });

  it('does not name the vendor when only the form was recognized', () => {
    expect(templateHints(match({}, 'look'))).toContain('the vendor may be another one using the same printed form');
  });
});

describe('checkGuidedReading', () => {
  it('passes a reading that agrees with the template and adds up', () => {
    const pages = [page([word('70697', 0.15, 0.11), word('100.00', 0.15, 0.81)])];
    expect(checkGuidedReading(result(), match(), pages)).toEqual([]);
  });

  it('compares Persian and Western digits as the same number', () => {
    expect(checkGuidedReading(result(), match(), [page([word('۷۰۶۹۷', 0.15, 0.11)])])).toEqual([]);
  });

  it("flags a value the form's box shows otherwise", () => {
    const pages = [page([word('95.00', 0.15, 0.81)])];
    expect(checkGuidedReading(result(), match(), pages)).toEqual([`totalAmount: the form's box shows "95.00"`]);
  });

  it('flags another vendor than the one the template was found by, a missing main value, and lines off the total', () => {
    const problems = checkGuidedReading(result({ vendorName: 'NOVA STEEL', invoiceNumber: null, totalAmount: 150 }), match(), null);
    expect(problems).toEqual([`vendor read as "NOVA STEEL", the template is HELIX TOOLS's`, 'invoiceNumber missing', "the lines don't add up to the total"]);
  });

  it('accepts another vendor on a form found by its look (the same printed form, used by many)', () => {
    expect(checkGuidedReading(result({ vendorName: 'NOVA STEEL' }), match({}, 'look'), null)).toEqual([]);
  });
});

describe('differences and trust', () => {
  it('names the fields two readings differ in', () => {
    expect(differences(data(), data({ totalAmount: 90, items: [] }))).toEqual(['totalAmount', 'items']);
    expect(differences(data(), data({ vendorName: 'helix  tools' }))).toEqual([]);
  });

  it('trusts a template after three sends without corrections', () => {
    expect(isTrusted({ timesSent: 3, timesCorrected: 0 })).toBe(true);
    expect(isTrusted({ timesSent: 3, timesCorrected: 1 })).toBe(false);
  });
});

class MemoryTemplates implements TemplatesRepository {
  constructor(public templates: StoredTemplate[]) {}
  async findCandidates(_org: string, { taxIds, keys }: TemplateKeys) {
    return this.templates.filter((t) => (t.vendorTaxId && taxIds.includes(t.vendorTaxId)) || (t.vendorKey && keys.includes(t.vendorKey)));
  }
  async findByShape() {
    return [];
  }
  async findById(id: string) {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async create(): Promise<StoredTemplate> {
    throw new Error('not here');
  }
  async update(): Promise<StoredTemplate> {
    throw new Error('not here');
  }
  async recordUse() {}
  cheap: { id: string; failed: boolean }[] = [];
  async recordCheapReading(id: string, failed: boolean) {
    this.cheap.push({ id, failed });
  }
}

describe('TemplateInvoiceExtractor with templates', () => {
  async function setup(templates: StoredTemplate[], answers: { guided: ExtractionResult; plain: ExtractionResult }, words: OcrWord[] = []) {
    const image = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const upload = { buffer: image, originalname: 'invoice.jpg', mimetype: 'image/jpeg', size: image.length } as UploadedFile;
    const classic: InvoiceExtractor & { extract: ReturnType<typeof vi.fn> } = {
      extract: vi.fn(async (_f: UploadedFile, o?: ExtractOptions) => (o?.hints ? answers.guided : answers.plain))
    };
    const ocr = { extractText: vi.fn(async (_file: OcrFile) => 'HELIX TOOLS\nفاکتور فروش\nشماره فاکتور 70697') };
    const tesseract: PositionedOcrClient = {
      readWords: async () => ({ pages: [{ index: 0, width: 500, height: 500, source: 'ocr', text: '', words }] }),
      extractText: async () => ''
    };
    const reader = new TemplateInvoiceExtractor(classic, ocr, null, { templates: new MemoryTemplates(templates), words: () => tesseract, renderer: () => null });
    const read = await reader.extract(upload, { country: international, organizationId: 'org' });
    return { read, classic, hintsOf: (call: number) => (classic.extract.mock.calls[call][1] as ExtractOptions).hints };
  }

  it("finds the vendor's template in the OCR text and uses the guided reading when it passes every check", async () => {
    const { read, classic, hintsOf } = await setup([template()], { guided: result(), plain: result({ totalAmount: 1 }) }, [word('100.00', 0.15, 0.81)]);
    expect(classic.extract).toHaveBeenCalledTimes(1);
    expect(hintsOf(0)).toContain('KNOWN FORM');
    expect(read.data!.totalAmount).toBe(100);
    expect(read.raw).toMatchObject({ template: { match: { id: 'tpl', by: 'vendor', outcome: 'used', problems: [] } } });
  });

  it("reads again without the template when the guided reading fails a check, and uses that", async () => {
    const { read, classic, hintsOf } = await setup([template()], { guided: result(), plain: result({ totalAmount: 95, items: [{ description: 'Drill', quantity: 1, unitPrice: 95, totalPrice: 95 }] }) }, [
      word('95.00', 0.15, 0.81)
    ]);
    expect(classic.extract).toHaveBeenCalledTimes(2);
    expect(hintsOf(1)).toBeUndefined();
    expect(read.data!.totalAmount).toBe(95);
    expect(read.raw).toMatchObject({ template: { match: { outcome: 'fell-back', problems: [`totalAmount: the form's box shows "95.00"`] } } });
  });

  it("takes a field the user made a rule of from its box, over what the model read", async () => {
    const { read, hintsOf } = await setup([template({ chosen: { invoiceNumber: { times: 2, label: null } } })], { guided: result(), plain: result() }, [word('F-LO-005', 0.12, 0.11)]);
    // Without a label, a reading of OCR text gets no hint for it (no places in text); the box's words decide.
    expect(hintsOf(0)).not.toContain('- invoiceNumber: RULE');
    expect(read.data!.invoiceNumber).toBe('F-LO-005');
    expect(read.raw).toMatchObject({ template: { match: { outcome: 'used', problems: [], ruled: ['invoiceNumber'] } } });
  });

  it("takes a ruled field from the OCR text after its label, and names the label in the hints", async () => {
    const { read, hintsOf } = await setup([template({ chosen: { invoiceNumber: { times: 2, label: 'شماره فاکتور' } } })], { guided: result(), plain: result() });
    expect(hintsOf(0)).toContain('the user chose the value printed right after "شماره فاکتور"');
    // The test's OCR text: "شماره فاکتور 70697".
    expect(read.data!.invoiceNumber).toBe('70697');
    const other = await setup([template({ chosen: { invoiceNumber: { times: 2, label: 'HELIX' } } })], { guided: result(), plain: result() });
    expect(other.read.data!.invoiceNumber).toBe('TOOLS');
    expect(other.read.raw).toMatchObject({ template: { match: { ruled: ['invoiceNumber'] } } });
  });

  it("doesn't take box words the OCR isn't sure of (garbage on a small scan)", async () => {
    const unsure = { ...word('T 303', 0.12, 0.11), confidence: 0.5 };
    const { read } = await setup([template({ chosen: { invoiceNumber: { times: 2, label: null } } })], { guided: result(), plain: result() }, [unsure]);
    expect(read.data!.invoiceNumber).toBe('70697');
  });

  it('keeps the reading when one choice is not yet a rule', async () => {
    const { read } = await setup([template({ chosen: { invoiceNumber: { times: 1, label: null } } })], { guided: result(), plain: result() }, [word('F-LO-005', 0.12, 0.11)]);
    expect(read.data!.invoiceNumber).toBe('70697');
  });

  it('makes both readings for a new template, uses the plain one and keeps where they differ', async () => {
    const { read, classic } = await setup([template({ timesSent: 1 })], { guided: result(), plain: result({ invoiceNumber: '70691' }) });
    expect(classic.extract).toHaveBeenCalledTimes(2);
    expect(read.data!.invoiceNumber).toBe('70691');
    expect(read.raw).toMatchObject({ template: { match: { outcome: 'compared', differences: ['invoiceNumber'] } } });
  });

  it('reads as before when no template matches', async () => {
    const { read, classic, hintsOf } = await setup([template({ vendorKey: 'novasteel' })], { guided: result(), plain: result() });
    expect(classic.extract).toHaveBeenCalledTimes(1);
    expect(hintsOf(0)).toBeUndefined();
    expect((read.raw as { template: { match?: unknown } }).template.match).toBeUndefined();
  });
});

describe('DirectInvoiceExtractor hints', () => {
  it("adds the template reader's hints to the reading's prompt, and nothing without them", async () => {
    const llm = new FakeLlm(invoiceAnswer());
    const extractor = new DirectInvoiceExtractor(new FakeOcr(), llm);
    await extractor.extract(photo, { country: international, hints: '\n\nKNOWN FORM: test' });
    await extractor.extract(photo, { country: international });
    expect(llm.requests[0].prompt).toContain('KNOWN FORM: test');
    expect(llm.requests[1].prompt).not.toContain('KNOWN FORM');
  });
});

describe('OCR that missed part of a known form', () => {
  const GOOD = 'ونوس شیشه\nهزینه پایه (ریال) : ۴۵,۰۰۰,۰۰۰\nهزینه کل (ریال) : ۴۵,۰۰۰,۰۰۰\nهزینه مازاد (ریال) : ۰';
  const BAD = 'ونوس شیشه\nهزینه پایه (ریال) : ۴۵,۰۰۰,۰۰۰\nهزینه مازاد (ریال) : ۴۵,۰۰۰,۰۰۰';
  const venus = template({ vendorKey: 'ونوسشیشه', vendorName: 'ونوس شیشه', chosen: { totalAmount: { times: 2, label: 'هزینه کل (ریال)' } } });

  it("finds an amount's label, not a line item's", () => {
    expect(labelBefore(GOOD, '45000000', { amount: true, skip: ['هزینه پایه', 'هزینه مازاد'] })).toBe('هزینه کل (ریال)');
    expect(labelBefore(BAD, '45000000', { amount: true, skip: ['هزینه پایه', 'هزینه مازاد'] })).toBeNull();
  });

  async function read(texts: string[], vision: FakeLlm | null) {
    const image = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const upload = { buffer: image, originalname: 'r.jpg', mimetype: 'image/jpeg', size: image.length } as UploadedFile;
    const classic: InvoiceExtractor & { extract: ReturnType<typeof vi.fn> } = {
      extract: vi.fn(async (_f: UploadedFile, o?: ExtractOptions) => {
        const total = o?.ocrText?.includes('هزینه کل') ? 45000000 : 90000000;
        return result({ vendorName: 'ونوس شیشه', invoiceNumber: 'SF9903', totalAmount: total, items: [{ description: 'هزینه پایه', quantity: 1, unitPrice: total, totalPrice: total }], currency: 'IRR' });
      })
    };
    let call = 0;
    const ocr = { extractText: vi.fn(async () => texts[Math.min(call++, texts.length - 1)]) };
    const reader = new TemplateInvoiceExtractor(classic, ocr, null, { templates: new MemoryTemplates([venus]), words: () => null, renderer: () => null, vision: () => vision });
    return { read: await reader.extract(upload, { country: international, organizationId: 'org' }), classic, ocr };
  }

  it('asks the OCR again when its text lacks a label the form always prints, and reads the better text', async () => {
    const { read: r, ocr } = await read([BAD, GOOD], null);
    expect(ocr.extractText).toHaveBeenCalledTimes(2);
    expect(r.data!.totalAmount).toBe(45000000);
    expect(r.raw).toMatchObject({ template: { ocrRetries: 1 } });
    expect((r.raw as { template: { ocrMissing?: unknown } }).template.ocrMissing).toBeUndefined();
  });

  it('reads the page image when the OCR keeps missing it', async () => {
    const vision = new FakeLlm(invoiceAnswer({ vendorName: 'ونوس شیشه', invoiceNumber: 'SF9903', totalAmount: 45000000, items: [{ description: 'هزینه پایه', quantity: 1, unitPrice: 45000000, totalPrice: 45000000 }] }));
    const { read: r, ocr, classic } = await read([BAD], vision);
    expect(ocr.extractText).toHaveBeenCalledTimes(3);
    expect(classic.extract).not.toHaveBeenCalled();
    expect(vision.requests[0].prompt).toContain('this form always prints "هزینه کل (ریال)"');
    expect(r.data!.totalAmount).toBe(45000000);
    expect(r.raw).toMatchObject({ template: { ocrMissing: ['هزینه کل (ریال)'], ocrRetries: 2 } });
  });
});

describe('the form guide and the cheaper model', () => {
  const TEXT = 'ونوس شیشه\n| شماره خروج SF9903 | شماره قرارداد TC4456 |\nهزینه پایه (ریال) : ۴۵,۰۰۰,۰۰۰\nهزینه مازاد (ریال) : ۰\nهزینه کل (ریال) : ۴۵,۰۰۰,۰۰۰';
  const sentOnce = { ocrText: TEXT, values: { invoiceNumber: 'SF9903', totalAmount: 45000000 }, read: { invoiceNumber: 'SF9903', totalAmount: 45000000 }, itemNames: [], amountFactors: [1] };
  const guide = learnGuide(learnGuide(EMPTY_GUIDE, sentOnce), sentOnce);
  const venus = (o: Partial<StoredTemplate> = {}) => template({ vendorKey: 'ونوسشیشه', vendorName: 'ونوس شیشه', guide, ...o });

  async function read(t: StoredTemplate, cheapReads: Partial<ExtractedInvoiceData>, itemTotal?: number) {
    const image = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const upload = { buffer: image, originalname: 'r.jpg', mimetype: 'image/jpeg', size: image.length } as UploadedFile;
    const reading = (o: Partial<ExtractedInvoiceData>) => {
      const total = o.totalAmount ?? 45000000;
      const line = itemTotal ?? total;
      return result({ vendorName: 'ونوس شیشه', invoiceNumber: 'SF9903', totalAmount: total, items: [{ description: 'هزینه پایه', quantity: 1, unitPrice: line, totalPrice: line }], ...o });
    };
    const classic = { extract: vi.fn(async (_f: UploadedFile, _o?: ExtractOptions) => reading({})) };
    const cheap = { extract: vi.fn(async (_f: UploadedFile, _o?: ExtractOptions) => reading(cheapReads)) };
    const ocr = { extractText: vi.fn(async () => TEXT) };
    const templates = new MemoryTemplates([t]);
    const reader = new TemplateInvoiceExtractor(classic, ocr, null, { templates, words: () => null, renderer: () => null }, cheap);
    return { read: await reader.extract(upload, { country: international, organizationId: 'org' }), classic, cheap, templates };
  }

  it("tells the text model the form's labels", async () => {
    const { cheap } = await read(venus(), {});
    const hints = cheap.extract.mock.calls[0][1]!.hints!;
    expect(hints).toContain('How this form prints its values (learned from 2 invoices sent from it');
    expect(hints).toContain('- totalAmount: the amount printed right after "هزینه کل (ریال)"');
  });

  it('reads a trusted form with the cheaper model, and only with it when the reading holds', async () => {
    const { read: r, classic, cheap } = await read(venus(), {});
    expect(cheap.extract).toHaveBeenCalledTimes(1);
    expect(classic.extract).not.toHaveBeenCalled();
    expect(r.raw).toMatchObject({ template: { match: { outcome: 'used', cheapModel: true } } });
  });

  it("reads again with the usual model when the cheaper one's reading differs from what the form prints after a learned label", async () => {
    const { read: r, classic } = await read(venus(), { totalAmount: 90000000 });
    expect(classic.extract).toHaveBeenCalledTimes(1);
    expect(r.data!.totalAmount).toBe(45000000);
    expect(r.raw).toMatchObject({ template: { match: { outcome: 'fell-back', problems: ['totalAmount: the form prints "45,000,000" after "هزینه کل (ریال)"'] } } });
  });

  it('uses the usual model for a form not trusted yet, or with nothing learned', async () => {
    expect((await read(venus({ timesSent: 1 }), {})).cheap.extract).not.toHaveBeenCalled();
    expect((await read(venus({ guide: EMPTY_GUIDE }), {})).cheap.extract).not.toHaveBeenCalled();
  });

  it("sets a wrong learned field to what the form prints after its label, instead of reading again, when every check then passes", async () => {
    const { read: r, classic, templates } = await read(venus(), { totalAmount: 90000000 }, 45000000);
    expect(classic.extract).not.toHaveBeenCalled();
    expect(r.data!.totalAmount).toBe(45000000);
    expect(r.raw).toMatchObject({ template: { match: { outcome: 'used', fixed: ['totalAmount'], cheapModel: true } } });
    expect(templates.cheap).toEqual([{ id: 'tpl', failed: false }]);
  });

  it('counts a failed cheaper reading, and reads a form it usually fails with the usual model straight away', async () => {
    const failed = await read(venus(), { totalAmount: 90000000 });
    expect(failed.templates.cheap).toEqual([{ id: 'tpl', failed: true }]);
    const skipped = await read(venus({ cheapReads: 6, cheapFailed: 4 }), {});
    expect(skipped.cheap.extract).not.toHaveBeenCalled();
    expect(skipped.classic.extract).toHaveBeenCalledTimes(1);
    expect(skipped.read.raw).toMatchObject({ template: { match: { outcome: 'used' } } });
  });
});

describe('a form that changed: a label gone, not missed by the OCR', () => {
  // 36 printed words spread over the page, and the total's label among them, printed once.
  const printed = Array.from({ length: 36 }, (_, i) => ({ text: `label${i}`, x: 0.05 + (i % 6) * 0.15, y: 0.05 + Math.floor(i / 6) * 0.15 }));
  const total = { text: 'gesamtbetrag', x: 0.6, y: 0.93 };
  const centre = (w: { text: string; x: number; y: number }) => ({ text: w.text, page: 0, x: w.x + 0.025, y: w.y + 0.01, seen: 3 });
  const form = template({ vendorKey: 'acme', vendorName: 'ACME GmbH', words: [...printed, total].map(centre), chosen: { totalAmount: { times: 2, label: 'Gesamtbetrag' } } });

  async function read(onPage: { text: string; x: number; y: number }[]) {
    const image = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const upload = { buffer: image, originalname: 'r.jpg', mimetype: 'image/jpeg', size: image.length } as UploadedFile;
    const classic = { extract: vi.fn(async () => result({ vendorName: 'ACME GmbH', totalAmount: 100, items: [{ description: 'x', quantity: 1, unitPrice: 100, totalPrice: 100 }] })) };
    const ocr = { extractText: vi.fn(async () => 'ACME GmbH\nSumme 100,00') };
    const tesseract: PositionedOcrClient = {
      readWords: async () => ({ pages: [{ index: 0, width: 500, height: 500, source: 'ocr', text: '', words: onPage.map((w) => word(w.text, w.x, w.y)) }] }),
      extractText: async () => ''
    };
    const reader = new TemplateInvoiceExtractor(classic, ocr, null, { templates: new MemoryTemplates([form]), words: () => tesseract, renderer: () => null });
    return { read: await reader.extract(upload, { country: international, organizationId: 'org' }), ocr };
  }

  it('asks the OCR no more when word OCR reads the form well and the label is gone from it', async () => {
    const { read: r, ocr } = await read(printed);
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    expect(r.raw).toMatchObject({ template: { formChanged: ['Gesamtbetrag'] } });
  });

  it('asks again when word OCR still sees the label (the OCR missed it)', async () => {
    const { read: r, ocr } = await read([...printed, total]);
    expect(ocr.extractText).toHaveBeenCalledTimes(3);
    expect((r.raw as { template: { formChanged?: unknown } }).template.formChanged).toBeUndefined();
  });

  it('asks again when word OCR reads too little of the page to tell', async () => {
    const { ocr } = await read(printed.slice(0, 10));
    expect(ocr.extractText).toHaveBeenCalledTimes(3);
  });
});

describe("a PDF made from text: its own words instead of OCR", () => {
  const TEXT = 'Werkzeug Müller GmbH Rechnung Rechnungsnummer 2026-0412 Datum 07.11.2026 Pos Artikel Menge Einzelpreis Gesamt 1 Schraubendreher 4 12,50 50,00 Gesamtbetrag 50,00 EUR';
  async function read(source: OcrPage['source']) {
    const upload = { buffer: Buffer.from('%PDF-1.4 text'), originalname: 'invoice.pdf', mimetype: 'application/pdf', size: 13 } as UploadedFile;
    const classic = { extract: vi.fn(async (_f: UploadedFile, _o?: ExtractOptions) => result()) };
    const ocr = { extractText: vi.fn(async () => 'from Mistral OCR') };
    const tesseract: PositionedOcrClient = {
      readWords: async () => ({ pages: [{ index: 0, width: 595, height: 842, source, text: TEXT, words: [] }] }),
      extractText: async () => ''
    };
    const reader = new TemplateInvoiceExtractor(classic, ocr, null, { templates: new MemoryTemplates([]), words: () => tesseract, renderer: () => null });
    const r = await reader.extract(upload, { country: international, organizationId: 'org' });
    return { r, ocr, classic };
  }

  it('reads the PDF text, exact and free, and makes no OCR call', async () => {
    const { r, ocr, classic } = await read('text-layer');
    expect(ocr.extractText).not.toHaveBeenCalled();
    expect(classic.extract.mock.calls[0][1]!.ocrText).toBe(TEXT);
    expect(r.raw).toMatchObject({ template: { textFrom: 'pdf' } });
  });

  it('uses Mistral OCR for a scanned PDF', async () => {
    const { r, ocr } = await read('ocr');
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    expect(r.raw).toMatchObject({ template: { textFrom: 'ocr', pdfTextUnused: 'a page without text (scanned)' } });
  });
});
