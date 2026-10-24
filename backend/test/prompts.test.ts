import { describe, expect, it } from 'vitest';
import { invoiceHandwrittenPrompt, invoiceRereadPrompt, invoiceStructurePrompt } from '../src/ai/prompts/invoice-structure';
import { international } from '../src/countries/international';
import { iran } from '../src/countries/iran';

describe('invoice prompts', () => {
  it('leaves Persian rules and Shamsi dates out of the international prompt', () => {
    const prompt = invoiceStructurePrompt('text', international.invoice);
    expect(prompt).not.toContain('Persian invoices');
    expect(prompt).not.toContain('Shamsi');
    expect(prompt).toContain('"invoiceDate": "YYYY-MM-DD"|null');
    expect(prompt).not.toContain('transfer');
  });

  it("adds Iran's rules to the shared ones", () => {
    const prompt = invoiceStructurePrompt('text', iran.invoice);
    expect(prompt).toContain('Rules:');
    expect(prompt).toContain('Persian invoices (فاکتور):');
    expect(prompt).toContain('"YYYY/MM/DD (Shamsi)"');
    expect(prompt).toContain('"transfer": {"amount": number');
    expect(prompt).toContain('رسید انتقال وجه');
  });

  it('keeps the country rules on the re-read', () => {
    expect(invoiceRereadPrompt('text', ['wrong total'], true, iran.invoice)).toContain('Persian invoices');
    expect(invoiceRereadPrompt('text', ['wrong total'], true, international.invoice)).not.toContain('Persian invoices');
  });

  it("puts the country's handwriting rules and today's date into the handwriting prompt", () => {
    const prompt = invoiceHandwrittenPrompt({ ...iran.invoice, handwriting: iran.invoice.handwriting! }, '1405/08/01');
    expect(prompt).toContain('HANDWRITTEN');
    expect(prompt).toContain('Today is 1405/08/01 (Shamsi)');
    expect(prompt).toContain('"uncertainFields": string[]');
  });
});
