import { AiUnavailableError, isRetryableStatus } from '../errors';
import { OcrClient, OcrFile } from './ocr';

export type MistralOcrConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Told how many pages were billed after every successful call (cost tracking). */
  onUsage?: (model: string, pages: number) => void;
};

type OcrResponse = { pages?: { markdown?: string }[]; usage_info?: { pages_processed?: number }; message?: string; detail?: unknown };

/** Pages read from a PDF (0-based); shorter PDFs are fine. */
const PDF_PAGES = [0, 1, 2];

/** Mistral's document OCR (the same service the n8n flow uses), sent the file inline. */
export class MistralOcr implements OcrClient {
  constructor(private readonly config: MistralOcrConfig) {
    if (!config.apiKey) throw new Error('Missing required env var: MISTRAL_API_KEY');
  }

  async extractText({ buffer, filename, contentType }: OcrFile): Promise<string> {
    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    const document =
      contentType === 'application/pdf'
        ? { type: 'document_url', document_name: filename, document_url: dataUrl }
        : { type: 'image_url', image_url: dataUrl };

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        // OCR is billed per page: a receipt or invoice never needs more than the first few.
        body: JSON.stringify({ model: this.config.model, document, ...(contentType === 'application/pdf' ? { pages: PDF_PAGES } : {}) }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      throw new AiUnavailableError(`OCR service unreachable: ${(err as Error).message}`);
    }
    const json = (await response.json().catch(() => null)) as OcrResponse | null;
    if (!response.ok) {
      const detail = json?.message ?? (typeof json?.detail === 'string' ? json.detail : null);
      throw new AiUnavailableError(detail ?? `OCR service failed (HTTP ${response.status})`, isRetryableStatus(response.status));
    }
    const pages = json?.pages ?? [];
    this.config.onUsage?.(this.config.model, json?.usage_info?.pages_processed ?? Math.max(pages.length, 1));
    return pages.map((p) => p.markdown ?? '').join('\n\n');
  }
}
