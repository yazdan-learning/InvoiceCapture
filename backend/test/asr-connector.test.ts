import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountingInvoice } from '../src/accounting/ports';
import { AsrConnector, toAsrInvoice } from '../src/accounting/connectors/asr';

function invoice(overrides: Partial<AccountingInvoice> = {}): AccountingInvoice {
  return {
    id: 'inv1', invoiceNumber: 'F-12', invoiceDate: new Date('2026-10-24'), dueDate: null, vendorName: 'Kaveh Co.',
    vendorAddress: null, vendorTaxId: null, subtotal: 4_000_000, taxAmount: null, totalAmount: 4_000_000, currency: 'IRR', notes: null,
    items: [
      { description: 'Service A', quantity: 2, unitPrice: 1_500_000, totalPrice: 3_000_000, taxRate: null },
      { description: 'Service B', quantity: 4, unitPrice: 250_000, totalPrice: 1_000_000, taxRate: null }
    ],
    ...overrides
  };
}

const config = { baseUrl: 'http://asr.test:5000/', apiKey: 'secret', timeoutMs: 1000 };

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('toAsrInvoice', () => {
  it('maps the invoice to the request in the ASR documentation', () => {
    expect(toAsrInvoice(invoice())).toEqual({
      creditorName: 'Kaveh Co.',
      title: 'فاکتور خرید F-12',
      invoiceDescription: 'شماره فاکتور: F-12',
      invoiceDate: '2026-10-24',
      manualInvoiceDetailList: [
        { rowNumber: 1, itemDesc: 'Service A', unitPrice: 1_500_000, measure: 2, total: 3_000_000 },
        { rowNumber: 2, itemDesc: 'Service B', unitPrice: 250_000, measure: 4, total: 1_000_000 }
      ]
    });
  });

  it('adds VAT printed under the lines as a line of its own, since ASR totals the lines', () => {
    const lines = toAsrInvoice(invoice({ taxAmount: 400_000, totalAmount: 4_400_000 })).manualInvoiceDetailList;
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatchObject({ rowNumber: 3, unitPrice: 400_000, measure: 1, total: 400_000 });
  });

  it('does not add the VAT again when the lines already include it', () => {
    expect(toAsrInvoice(invoice({ taxAmount: 360_000 })).manualInvoiceDetailList).toHaveLength(2);
  });

  it('sends one line for an invoice without lines', () => {
    const lines = toAsrInvoice(invoice({ items: [], subtotal: null, taxAmount: 90, totalAmount: 1090 })).manualInvoiceDetailList;
    expect(lines.map((line) => line.total)).toEqual([1000, 90]);
  });

  it('fills a missing unit price or quantity from the line total', () => {
    const [line] = toAsrInvoice(
      invoice({ items: [{ description: 'Paper', quantity: null, unitPrice: null, totalPrice: 4_000_000, taxRate: null }] })
    ).manualInvoiceDetailList;
    expect(line).toMatchObject({ unitPrice: 4_000_000, measure: 1, total: 4_000_000 });
  });

  it('refuses lines that do not add up to the total (ASR has no discount field)', () => {
    expect(() => toAsrInvoice(invoice({ totalAmount: 3_800_000 }))).toThrow('lines add up to 4,000,000 but the invoice total is 3,800,000');
  });

  it("cuts texts to ASR's column sizes instead of having the invoice rejected", () => {
    const body = toAsrInvoice(invoice({ invoiceNumber: 'N'.repeat(80), vendorName: 'V'.repeat(300) }));
    expect(body.title).toHaveLength(50);
    expect(body.creditorName).toHaveLength(200);
  });

  it('refuses what ASR cannot take', () => {
    expect(() => toAsrInvoice(invoice({ currency: 'EUR' }))).toThrow('only accepts invoices in Rial');
    expect(() => toAsrInvoice(invoice({ vendorName: ' ' }))).toThrow('vendor name');
    expect(() => toAsrInvoice(invoice({ invoiceDate: null }))).toThrow('invoice date');
  });
});

describe('AsrConnector', () => {
  it('posts the invoice with the key and returns the new ASR invoice id', async () => {
    const fetchMock = answer(200, { succeed: true, message: 'Operation Executed Successfully', data: 10012930305 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AsrConnector(config).send(invoice())).resolves.toEqual({ reference: '10012930305' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://asr.test:5000/api/partner/manual-invoice');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'secret', 'Content-Type': 'application/json' });
  });

  it('treats succeed: false as a failure even though the status is 200', async () => {
    vi.stubGlobal('fetch', answer(200, { succeed: false, message: 'ORA-12899: value too large', data: null }));
    await expect(new AsrConnector(config).send(invoice())).rejects.toThrow('ASR rejected the invoice: ORA-12899');
  });

  it('reports a wrong key', async () => {
    vi.stubGlobal('fetch', answer(401, {}));
    await expect(new AsrConnector(config).send(invoice())).rejects.toThrow('refused the API key');
  });

  it('warns against resending after a timeout, as ASR does not check duplicates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))));
    await expect(new AsrConnector(config).send(invoice())).rejects.toThrow('Check in ASR whether the invoice was created');
  });

  it('does not call ASR without a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AsrConnector({ ...config, apiKey: '' }).send(invoice())).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
