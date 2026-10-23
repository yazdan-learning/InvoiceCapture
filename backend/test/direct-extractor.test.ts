import { describe, expect, it } from 'vitest';
import { DirectInvoiceExtractor, HANDWRITTEN_CHECK } from '../src/expenses/adapters/direct-extractor';
import { international } from '../src/countries/international';
import { getCalendar } from '../src/countries/calendars';
import { iran } from '../src/countries/iran';
import { FakeLlm, FakeOcr, invoiceAnswer, photo } from './fakes';


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
    expect(vision.requests[0].image).toMatch(/^data:image\/jpeg;base64,/);
    // The currency written in words (تومان) wins, then Toman → Rial.
    expect(result.data).toMatchObject({ currency: 'IRR', totalAmount: 1000 });
    expect(result.error).toBe(HANDWRITTEN_CHECK);
  });
});
