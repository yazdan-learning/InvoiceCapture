import sharp from 'sharp';
import { AiUnavailableError, isRetryableStatus } from '../errors';
import type { OcrClient, OcrFile } from './ocr';

export type PdfChatOcrConfig = {
  /** e.g. https://api.scaleway.ai/v1 */
  baseUrl: string;
  apiKey: string;
  /** e.g. lightonocr-3-0.8b */
  model: string;
  timeoutMs: number;
};

type ChatCompletion = { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };

/**
 * An OCR model served as chat completions that takes the document as a PDF file part: LightOnOCR on Scaleway
 * (Settings → AI models → OCR). It answers with the page as markdown, tables as HTML. It accepts only PDFs,
 * so a photo is sent as a one-page PDF.
 */
export class PdfChatOcr implements OcrClient {
  constructor(private readonly config: PdfChatOcrConfig) {
    if (!config.apiKey) throw new Error('Missing required env var: SCALEWAY_API_KEY');
  }

  async extractText({ buffer, contentType }: OcrFile): Promise<string> {
    const pdf = contentType === 'application/pdf' ? buffer : await imageAsPdf(buffer);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            { role: 'user', content: [{ type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${pdf.toString('base64')}` } }] }
          ]
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      throw new AiUnavailableError(`OCR service unreachable: ${(err as Error).message}`);
    }
    const json = (await response.json().catch(() => null)) as ChatCompletion | null;
    if (!response.ok) {
      throw new AiUnavailableError(json?.error?.message ?? `OCR service failed (HTTP ${response.status})`, isRetryableStatus(response.status));
    }
    return json?.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

/**
 * A one-page PDF showing the photo (as JPEG) on a paper-sized page: the shorter side is A4's 595 pt. On a page
 * as big as the photo's pixels (1528 × 2018 pt) LightOnOCR answered only "![image](image_1.png)".
 */
export async function imageAsPdf(image: Buffer): Promise<Buffer> {
  const { data: jpeg, info } = await sharp(image).rotate().toColourspace('srgb').jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const scale = 595 / Math.min(w, h);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (part: string | Buffer) => {
    const b = typeof part === 'string' ? Buffer.from(part, 'latin1') : part;
    parts.push(b);
    length += b.length;
  };
  const object = (n: number, body: string | Buffer[]) => {
    offsets[n] = length;
    if (typeof body === 'string') add(`${n} 0 obj\n${body}\nendobj\n`);
    else {
      add(`${n} 0 obj\n`);
      body.forEach(add);
      add('\nendobj\n');
    }
  };
  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
    jpeg,
    Buffer.from('\nendstream', 'latin1')
  ]);
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = length;
  add(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
