import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { OcrFile } from '@yazdan-learning/ai';
import { AMOUNTS_UNCHECKED } from '../src/expenses/adapters/direct-extractor';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../src/expenses/ports';
import { iran } from '../src/countries/iran';
import { international } from '../src/countries/international';
import { parseVatTable } from '@yazdan-learning/ai';
import { AMOUNTS_FAR_OFF, ReaderSwitchExtractor, TAX_UNCHECKED, TemplateInvoiceExtractor, withVatTable, withReadDates } from '../src/reading/template-extractor';

const file: UploadedFile = { buffer: Buffer.from('%PDF-1.4'), originalname: 'dm.pdf', mimetype: 'application/pdf', size: 8 } as UploadedFile;

const DM_OCR = `dmm-drogerie markt
| dmBio Kamillentee lose 60g | 2,95 | 2 |
| Trinkbecher Keramik | 7,95 | 1 |
| SUMME EUR | 10,90 | |
| MwSt-Satz | Brutto | Netto | MwSt |
| 1=19,00% | 7,95 | 6,68 | 1,27 |
| 2=7,00% | 2,95 | 2,76 | 0,19 |`;

const reading = (items: [string, number, number, number][], totalAmount: number): ExtractedInvoiceData => ({
  invoiceNumber: null,
  invoiceDate: '2026-11-05',
  dueDate: null,
  vendorName: 'dm-drogerie markt',
  vendorAddress: null,
  vendorTaxId: null,
  customerName: null,
  customerAddress: null,
  items: items.map(([description, quantity, unitPrice, totalPrice]) => ({ description, quantity, unitPrice, totalPrice })),
  subtotal: null,
  taxRate: null,
  taxAmount: null,
  totalAmount,
  currency: 'EUR',
  paymentMethod: null,
  paymentTerms: null,
  notes: null
});

function setup(result: ExtractionResult, ocrText = DM_OCR) {
  const classic: InvoiceExtractor & { extract: ReturnType<typeof vi.fn> } = { extract: vi.fn(async (_f: UploadedFile, _o?: ExtractOptions) => result) };
  const ocr = { extractText: vi.fn(async (_file: OcrFile) => ocrText) };
  return { classic, ocr, reader: new TemplateInvoiceExtractor(classic, ocr, null) };
}

describe('TemplateInvoiceExtractor', () => {
  it('takes the VAT codes out of the quantities and drops the warning', async () => {
    const { reader, classic, ocr } = setup({
      success: true,
      data: reading(
        [
          ['dmBio Kamillentee lose 60g', 2, 2.95, 5.9],
          ['Trinkbecher Keramik', 1, 7.95, 7.95]
        ],
        10.9
      ),
      error: AMOUNTS_UNCHECKED,
      raw: { provider: 'direct' }
    });
    const result = await reader.extract(file, { country: international });
    expect(result.data!.items.map((i) => [i.quantity, i.totalPrice])).toEqual([
      [1, 2.95],
      [1, 7.95]
    ]);
    expect(result.error).toBeUndefined();
    expect(result.raw).toMatchObject({ template: { vatCodeLines: [0], vatTable: 'used' } });
    // Tax and net from the VAT table: 1,27 + 0,19 and 6,68 + 2,76.
    expect([result.data!.taxAmount, result.data!.subtotal, result.data!.taxRate]).toEqual([1.46, 9.44, null]);
    // One OCR call, handed to the classic reading.
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    expect(classic.extract.mock.calls[0][1]).toMatchObject({ ocrText: DM_OCR });
  });

  it('reads a receipt without Persian text with the international rules in an Iranian organization', async () => {
    const { reader, classic } = setup({ success: true, data: reading([['Brot', 1, 2, 2]], 2), raw: {} }, 'Lidl\nBrot 2,00 A\nZu zahlen 2,00');
    const result = await reader.extract(file, { country: iran });
    expect(classic.extract.mock.calls[0][1].country.id).toBe('INTL');
    expect(result.raw).toMatchObject({ template: { foreignReceipt: true } });
  });

  it('keeps the Persian rules for a Persian invoice', async () => {
    const { reader, classic } = setup({ success: true, data: reading([['نان', 1, 2, 2]], 2), raw: {} }, 'فاکتور فروش\nنان ۲۰۰۰');
    await reader.extract(file, { country: iran });
    expect(classic.extract.mock.calls[0][1].country.id).toBe('IR');
  });

  it('says plainly when the lines are far off the total', async () => {
    const { reader } = setup({ success: true, data: reading([['A', 1, 10, 10]], 25), error: AMOUNTS_UNCHECKED, raw: {} }, 'A 10,00\nSumme 25,00');
    const result = await reader.extract(file, { country: international });
    expect(result.error).toBe(AMOUNTS_FAR_OFF);
  });

  it('keeps the usual warning for a gap of a few cents', async () => {
    const { reader } = setup({ success: true, data: reading([['A', 1, 16.6, 16.6]], 16.72), error: AMOUNTS_UNCHECKED, raw: {} }, 'A 16,60\nSumme 16,72');
    expect((await reader.extract(file, { country: international })).error).toBe(AMOUNTS_UNCHECKED);
  });

  it('enlarges a small screenshot 2× for the OCR and the classic re-read', async () => {
    const buffer = await sharp({ create: { width: 270, height: 1600, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const screenshot = { buffer, originalname: 'lidl.jpeg', mimetype: 'image/jpeg', size: buffer.length } as UploadedFile;
    const { reader, classic, ocr } = setup({ success: true, data: reading([['A', 1, 2, 2]], 2), raw: {} }, 'A 2,00\nSumme 2,00');
    const result = await reader.extract(screenshot, { country: international });
    expect(ocr.extractText.mock.calls[0][0]).toMatchObject({ contentType: 'image/png', filename: 'lidl.png' });
    expect(classic.extract.mock.calls[0][0]).toMatchObject({ mimetype: 'image/png' });
    expect(result.raw).toMatchObject({ template: { enlarged: true, smallImage: true } });
  });

  it('leaves handwritten invoices to the classic reader', async () => {
    const { reader, classic, ocr } = setup({ success: true, data: reading([], 0), raw: {} });
    await reader.extract(file, { country: iran, handwritten: true });
    expect(ocr.extractText).not.toHaveBeenCalled();
    expect(classic.extract.mock.calls[0][1]).toEqual({ country: iran, handwritten: true });
  });

  it('reads handwritten invoices the classic way and marks them', async () => {
    const { reader } = setup({ success: true, data: reading([['نان', 1, 2, 2]], 2), error: 'Handwritten invoice', raw: { mode: 'handwritten' } });
    const result = await reader.extract(file, { country: iran, handwritten: true });
    expect(result.error).toBe('Handwritten invoice');
    expect(result.raw).toMatchObject({ mode: 'handwritten', template: { mode: 'handwritten' } });
  });

  it('reads a "handwritten" upload as printed where the country has no handwriting rules', async () => {
    const { reader, ocr } = setup({ success: true, data: reading([['A', 1, 2, 2]], 2), raw: {} }, 'A 2,00\nSumme 2,00');
    const result = await reader.extract(file, { country: international, handwritten: true });
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    expect(result.raw).toMatchObject({ template: { mode: 'printed' } });
  });

  it('checks each invoice of a file that holds several', async () => {
    const { reader } = setup(
      {
        success: true,
        data: reading([['A', 1, 10, 10]], 10),
        raw: { part: 1 },
        more: [{ data: reading([['B', 1, 10, 10]], 25), error: AMOUNTS_UNCHECKED, raw: { part: 2 } }]
      },
      'A 10,00\nSumme 10,00\nB 10,00\nSumme 25,00'
    );
    const result = await reader.extract(file, { country: international });
    expect(result.error).toBeUndefined();
    expect(result.raw).toMatchObject({ part: 1, template: { mode: 'several', farOff: false } });
    expect(result.more).toHaveLength(1);
    expect(result.more![0].error).toBe(AMOUNTS_FAR_OFF);
    expect(result.more![0].raw).toMatchObject({ part: 2, template: { mode: 'several', farOff: true } });
  });
});

describe('ReaderSwitchExtractor', () => {
  it('sends CLASSIC organizations to the classic reader with their options unchanged', async () => {
    const classic = { extract: vi.fn(async () => ({ success: true, raw: {} })) };
    const template = { extract: vi.fn(async () => ({ success: true, raw: {} })) };
    const reader = new ReaderSwitchExtractor(classic, template);
    await reader.extract(file, { country: iran, reader: 'CLASSIC' });
    expect(classic.extract).toHaveBeenCalledWith(file, { country: iran });
    await reader.extract(file, { country: iran, reader: 'TEMPLATE' });
    expect(template.extract).toHaveBeenCalledWith(file, { country: iran });
  });
});

describe('withVatTable', () => {
  const rows = parseVatTable(DM_OCR);
  const read = (taxAmount: number | null, subtotal: number | null, totalAmount = 10.9) => ({ ...reading([['A', 1, totalAmount, totalAmount]], totalAmount), taxAmount, subtotal, taxRate: 19 });

  it('replaces a made-up tax with the printed one', () => {
    const { data, outcome } = withVatTable(read(1.2, 9.7), rows);
    expect(outcome).toBe('used');
    expect([data.taxAmount, data.subtotal, data.taxRate]).toEqual([1.46, 9.44, null]);
  });

  it('keeps a reading that already agrees', () => {
    expect(withVatTable(read(1.46, 9.44), rows).outcome).toBe('agrees');
  });

  it('says so when the table does not add up to the total read', () => {
    expect(withVatTable(read(1.2, 9.7, 12.5), rows).outcome).toBe('disagrees');
  });

  it('does nothing without a VAT table', () => {
    expect(withVatTable(read(1.2, 9.7), []).outcome).toBe('none');
  });

  it('warns on the expense when the table disagrees', async () => {
    const { reader } = setup({ success: true, data: { ...reading([['A', 1, 12.5, 12.5]], 12.5), taxAmount: 1, subtotal: 11.5 }, raw: {} });
    expect((await reader.extract(file, { country: international })).error).toBe(TAX_UNCHECKED);
  });
});

describe('withReadDates', () => {
  const reading = (invoiceDate: string | null, read: unknown) =>
    ({ success: true, data: { invoiceDate, dueDate: null } as never, raw: { data: { invoiceDate: read, dueDate: null } } }) as Parameters<typeof withReadDates>[0];

  it('takes the date out of the words the model wrote around it', () => {
    expect(withReadDates(reading(null, '1405/07/26 (Shamsi)')).data?.invoiceDate).toBe('2026-10-18');
    expect(withReadDates(reading(null, 'Datum: 07.11.26')).data?.invoiceDate).toBe('2026-11-07');
  });

  it('leaves a date that was converted, and text without a date', () => {
    expect(withReadDates(reading('2026-10-01', '1405/07/09')).data?.invoiceDate).toBe('2026-10-01');
    expect(withReadDates(reading(null, 'unreadable')).data?.invoiceDate).toBeNull();
  });
});
