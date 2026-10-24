import { describe, expect, it } from 'vitest';
import {
  AMOUNTS_UNCHECKED,
  DirectInvoiceExtractor,
  HANDWRITTEN_CHECK,
  NOT_IN_TRANSFER,
  PAID_AMOUNT_DIFFERS,
  PAID_AMOUNT_FITTED,
  severalInvoicesWarning,
  TRANSFER_ONLY
} from '../src/expenses/adapters/direct-extractor';
import { fitToPaidAmount, paidByTransfer } from '../src/ai/handwritten-fixes';
import { CompletionRequest, LlmClient } from '../src/ai/gateway/llm';
import { withoutTaxLine } from '../src/ai/invoice-checks';
import { international } from '../src/countries/international';
import { getCalendar } from '../src/countries/calendars';
import { iran } from '../src/countries/iran';
import { FakeLlm, FakeOcr, invoiceAnswer, photo } from './fakes';

/** Answers each call with the next reply in turn. */
class ScriptedLlm implements LlmClient {
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly replies: Record<string, unknown>[]) {}
  async complete(request: CompletionRequest): Promise<string> {
    this.requests.push(request);
    return JSON.stringify(this.replies[Math.min(this.requests.length - 1, this.replies.length - 1)]);
  }
}

const line = (amount: number) => [{ description: 'Freight', quantity: 1, unitPrice: amount, totalPrice: amount }];

describe('DirectInvoiceExtractor', () => {
  it('reads with the shared rules only when no country is given', async () => {
    const llm = new FakeLlm(invoiceAnswer());
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo);
    expect(result.success).toBe(true);
    expect(llm.requests[0].prompt).not.toContain('Persian invoices');
  });

  it('ignores "handwritten" for a country without handwriting rules', async () => {
    const ocr = new FakeOcr();
    const llm = new FakeLlm(invoiceAnswer());
    const vision = new FakeLlm(invoiceAnswer());
    const result = await new DirectInvoiceExtractor(ocr, llm, vision).extract(photo, { handwritten: true, country: international });
    expect(vision.requests).toHaveLength(0);
    expect(ocr.calls).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('reads Iranian invoices with the Persian rules, Shamsi dates and Toman → Rial', async () => {
    const llm = new FakeLlm(invoiceAnswer({ invoiceDate: '1405/07/26', currency: 'IRT' }));
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(llm.requests[0].prompt).toContain('Persian invoices');
    expect(result.data).toMatchObject({ invoiceDate: '2026-10-18', currency: 'IRR', totalAmount: 1000 });
  });

  it('reads a handwritten Iranian invoice from the photo with the vision model', async () => {
    const llm = new FakeLlm(invoiceAnswer({ totalAmount: 100 }));
    const vision = new FakeLlm({
      ...invoiceAnswer({ invoiceDate: getCalendar('persian').today(), totalAmount: 100, items: [{ description: 'x', quantity: 1, unitPrice: 100, totalPrice: 100 }] }),
      totalInWords: 'صد تومان',
      uncertainFields: []
    });
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm, vision).extract(photo, { handwritten: true, country: iran });

    expect(vision.requests).toHaveLength(1);
    expect(vision.requests[0].prompt).toContain('HANDWRITTEN');
    expect(vision.requests[0].image).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
    // The currency written in words (تومان) wins, then Toman → Rial.
    expect(result.data).toMatchObject({ currency: 'IRR', totalAmount: 1000 });
    expect(result.error).toBe(HANDWRITTEN_CHECK);
  });

  it('reads every invoice of a file that holds several, one result each', async () => {
    const llm = new ScriptedLlm([
      { ...invoiceAnswer({ vendorName: 'TIPAX', totalAmount: 100, items: line(100) }), invoiceCount: 3 },
      {
        invoices: [
          invoiceAnswer({ vendorName: 'TIPAX', totalAmount: 100, items: line(100) }),
          invoiceAnswer({ vendorName: 'TIPAX', invoiceDate: '2026-10-21', totalAmount: 250, items: line(250) }),
          invoiceAnswer({ vendorName: 'TIPAX', totalAmount: 400, items: line(300) })
        ]
      }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: international });

    // Read from the photo: OCR misses receipts photographed side by side.
    expect(llm.requests[1].prompt).toContain('Read every invoice from the photos');
    expect(llm.requests[1].image).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
    expect(result.data).toMatchObject({ totalAmount: 100 });
    expect(result.error).toBeUndefined();
    expect(result.more?.map((part) => part.data.totalAmount)).toEqual([250, 400]);
    expect(result.more?.[0].data.invoiceDate).toBe('2026-10-21');
    // Checked one by one: only the invoice that doesn't add up gets the warning.
    expect(result.more?.map((part) => part.error)).toEqual([undefined, AMOUNTS_UNCHECKED]);
    expect(result.more?.[1].raw).toMatchObject({ mode: 'split', part: 3, of: 3 });
  });

  it('falls back to the OCR text when the photos could not be read apart', async () => {
    const llm = new ScriptedLlm([
      { ...invoiceAnswer(), invoiceCount: 2 },
      { invoices: [invoiceAnswer()] },
      { invoices: [invoiceAnswer(), invoiceAnswer({ totalAmount: 250, items: line(250) })] }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: international });
    expect(llm.requests[2].prompt).toContain('The OCR text below holds 2 separate invoices');
    expect(llm.requests[2].image).toBeUndefined();
    expect(result.more?.map((part) => part.data.totalAmount)).toEqual([250]);
  });

  it('keeps the first invoice, with a warning, when several could not be read apart', async () => {
    const llm = new ScriptedLlm([{ ...invoiceAnswer(), invoiceCount: 2 }, { invoices: [invoiceAnswer()] }]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: international });
    expect(result.data).toMatchObject({ vendorName: 'Shop' });
    expect(result.more).toBeUndefined();
    expect(result.error).toBe(severalInvoicesWarning(2));
  });

  it('makes no extra call for a file with one invoice', async () => {
    const llm = new ScriptedLlm([{ ...invoiceAnswer(), invoiceCount: 1 }]);
    await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: international });
    expect(llm.requests).toHaveLength(1);
  });
});

describe('bank transfer receipt in the file (Iran)', () => {
  const transfer = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, currency: 'IRR', date: '1405/07/28', payee: 'Ali', ...extra });
  const lines = (...amounts: number[]) => amounts.map((a) => ({ description: 'x', quantity: 1, unitPrice: a, totalPrice: a }));

  it('fits handwritten amounts to the transfer: unit, then zeros', async () => {
    const llm = new FakeLlm({ ...invoiceAnswer({ currency: null, totalAmount: 50000, items: lines(25000, 25000) }), transfer: transfer(5_000_000) });
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(result.data).toMatchObject({ currency: 'IRR', totalAmount: 5_000_000, paymentMethod: 'bank transfer' });
    expect(result.data?.items.map((i) => i.totalPrice)).toEqual([2_500_000, 2_500_000]);
    expect(result.error).toBe(PAID_AMOUNT_FITTED);
  });

  it('re-reads when the invoice does not match the transfer, and keeps a reading that does', async () => {
    const llm = new ScriptedLlm([
      { ...invoiceAnswer({ currency: 'IRR', totalAmount: 90, items: lines(45, 45) }), transfer: transfer(45) },
      { ...invoiceAnswer({ currency: 'IRR', totalAmount: 45, items: lines(45, 0) }), transfer: transfer(45) }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(llm.requests[1].prompt).toContain('The bank transfer receipt in the file paid 45');
    expect(result.data?.totalAmount).toBe(45);
    expect(result.error).toBeUndefined();
  });

  it('says so when the invoice still does not match (the transfer may pay part of it)', async () => {
    const llm = new FakeLlm({ ...invoiceAnswer({ currency: 'IRR', totalAmount: 90, items: lines(90) }), transfer: transfer(45) });
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(result.data?.totalAmount).toBe(90);
    expect(result.error).toBe(PAID_AMOUNT_DIFFERS);
  });

  it('records the payment when nothing but the transfer could be read', async () => {
    const llm = new FakeLlm({ ...invoiceAnswer({ vendorName: null, invoiceDate: null, totalAmount: null, items: [] }), transfer: transfer(249_500_000) });
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(result.data).toMatchObject({ vendorName: 'Ali', totalAmount: 249_500_000, invoiceDate: '2026-10-20', currency: 'IRR' });
    expect(result.error).toBe(TRANSFER_ONLY);
  });

  it('takes a misread handwritten year and the missing amounts from the transfer', async () => {
    const ocr = { ...invoiceAnswer({ totalAmount: null, items: [] }), transfer: transfer(169_200_000) };
    const vision = new FakeLlm({
      ...invoiceAnswer({ vendorName: 'Oxygen', invoiceDate: '1401/07/28', currency: null, totalAmount: 1_692_000, items: lines(1_632_000, 60_000) }),
      uncertainFields: []
    });
    const result = await new DirectInvoiceExtractor(new FakeOcr(), new FakeLlm(ocr), vision).extract(photo, { handwritten: true, country: iran });
    expect(result.data).toMatchObject({ totalAmount: 169_200_000, currency: 'IRR', invoiceDate: '2026-10-20' });
    expect(result.data?.items.map((i) => i.totalPrice)).toEqual([163_200_000, 6_000_000]);
    expect(result.error).toBe(`${HANDWRITTEN_CHECK}. Check especially: invoiceDate`);
  });
});

describe('several invoices and one bank transfer (Iran)', () => {
  it('warns on the invoice the transfer did not pay', async () => {
    const transfer = { amount: 700, currency: 'IRR', date: null, payee: 'Tipax' };
    const llm = new ScriptedLlm([
      { ...invoiceAnswer({ currency: 'IRR', totalAmount: 300, items: line(300) }), invoiceCount: 3, transfer },
      { invoices: [300, 900, 400].map((a) => invoiceAnswer({ currency: 'IRR', totalAmount: a, items: line(a) })) }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect([result.error, ...(result.more ?? []).map((part) => part.error)]).toEqual([undefined, NOT_IN_TRANSFER, undefined]);
  });
});

describe('a transfer the OCR misread (Iran)', () => {
  it('uses the reading of it that the invoices add up to', async () => {
    const transfer = (amount: number) => ({ amount, currency: 'IRR', date: null, payee: null });
    const llm = new ScriptedLlm([
      { ...invoiceAnswer({ currency: 'IRR', totalAmount: 300, items: line(300) }), invoiceCount: 3, transfer: transfer(800) },
      { invoices: [300, 900, 400].map((a) => invoiceAnswer({ currency: 'IRR', totalAmount: a, items: line(a) })), transfer: transfer(700) }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect(llm.requests[1].prompt).toContain('{"invoices": [ ... ],\n  "transfer"');
    expect([result.error, ...(result.more ?? []).map((part) => part.error)]).toEqual([undefined, NOT_IN_TRANSFER, undefined]);
  });
});

describe('several invoices whose totals cannot make up the transfer (Iran)', () => {
  it('warns on every one of them', async () => {
    const transfer = { amount: 63, currency: 'IRR', date: null, payee: null };
    const llm = new ScriptedLlm([
      { ...invoiceAnswer({ currency: 'IRR', totalAmount: 210, items: line(210) }), invoiceCount: 2 },
      { invoices: [210, 42].map((a) => ({ ...invoiceAnswer({ currency: 'IRR', totalAmount: a, items: line(a) }), transfer })) }
    ]);
    const result = await new DirectInvoiceExtractor(new FakeOcr(), llm).extract(photo, { country: iran });
    expect([result.error, result.more?.[0].error]).toEqual([PAID_AMOUNT_DIFFERS, PAID_AMOUNT_DIFFERS]);
  });
});

describe('paidByTransfer', () => {
  const invoices = (...totals: number[]) => totals.map((totalAmount) => ({ totalAmount, currency: 'IRR' }));
  it('finds the only set of invoices the transfer adds up to', () => {
    expect(paidByTransfer(invoices(3782460, 9888205, 3565662), { amount: 7348122, currency: 'IRR' }, iran.invoice.currencyUnits)).toEqual([true, false, true]);
  });
  it('is null when no set or several sets fit', () => {
    expect(paidByTransfer(invoices(100, 200), { amount: 50, currency: 'IRR' }, [])).toBeNull();
    expect(paidByTransfer(invoices(100, 100), { amount: 100, currency: 'IRR' }, [])).toBeNull();
  });
});

describe('fitToPaidAmount', () => {
  const units = iran.invoice.currencyUnits;
  const reading = (items: number[], totalAmount: number | null, currency: string | null = null) =>
    ({ ...invoiceAnswer(), currency, totalAmount, subtotal: totalAmount, items: items.map((a) => ({ description: 'x', quantity: 1, unitPrice: null, totalPrice: a })) }) as never;

  it('reads amounts without a unit as Toman when that is what the transfer paid', () => {
    expect(fitToPaidAmount(reading([500_000], 500_000), { amount: 5_000_000, currency: 'IRR' }, units)).toMatchObject({ currency: 'IRT', totalAmount: 500_000 });
  });

  it('restores zeros dropped from some lines only', () => {
    const fitted = fitToPaidAmount(reading([27_000_000, 300_000], null, 'IRR'), { amount: 30_000_000, currency: 'IRR' }, units);
    expect(fitted?.items.map((i) => i.totalPrice)).toEqual([27_000_000, 3_000_000]);
  });

  it('is null when nothing explains the difference', () => {
    expect(fitToPaidAmount(reading([21_000_000], 21_000_000, 'IRR'), { amount: 63_000_000, currency: 'IRR' }, units)).toBeNull();
  });
});

describe('withoutTaxLine', () => {
  it('drops a VAT line that is also the taxAmount, and nothing else', () => {
    const charges = [
      { description: 'هزینه خدمات', quantity: 1, unitPrice: 3059400, totalPrice: 3059400 },
      { description: 'ارزش افزوده', quantity: 1, unitPrice: 176984, totalPrice: 176984 }
    ];
    const reading = { ...invoiceAnswer(), items: charges, taxAmount: 176984 } as never;
    expect(withoutTaxLine(reading).items.map((line) => line.description)).toEqual(['هزینه خدمات']);
    expect(withoutTaxLine({ ...(reading as object), taxAmount: 999 } as never).items).toHaveLength(2);
  });
});
