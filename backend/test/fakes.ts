import { CompletionRequest, LlmClient } from '../src/ai/gateway/llm';
import { OcrClient } from '../src/ai/gateway/ocr';
import { ExtractedInvoiceData } from '../src/expenses/ports';

/** An LLM that answers every call with the given JSON and remembers the requests. */
export class FakeLlm implements LlmClient {
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly answer: Record<string, unknown>) {}
  async complete(request: CompletionRequest): Promise<string> {
    this.requests.push(request);
    return JSON.stringify(this.answer);
  }
}

export class FakeOcr implements OcrClient {
  calls = 0;
  constructor(private readonly text = 'some invoice text') {}
  async extractText(): Promise<string> {
    this.calls++;
    return this.text;
  }
}

export const photo = { buffer: Buffer.from('fake image'), originalname: 'invoice.jpg', mimetype: 'image/jpeg', size: 10 };

/** A reading whose lines add up, so no re-read is triggered. */
export function invoiceAnswer(overrides: Partial<Record<keyof ExtractedInvoiceData, unknown>> = {}) {
  return {
    vendorName: 'Shop',
    invoiceDate: '2026-10-01',
    items: [{ description: 'Item', quantity: 1, unitPrice: 100, totalPrice: 100 }],
    totalAmount: 100,
    currency: 'EUR',
    ...overrides
  };
}
