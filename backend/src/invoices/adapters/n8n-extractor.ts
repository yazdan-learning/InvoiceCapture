import { ExtractionResult, InvoiceExtractor, UploadedFile } from '../ports';

export type N8nInvoiceExtractorConfig = {
  baseUrl: string;
  extractPath: string;
};

// The only file that knows n8n exists. Swapping the extraction provider later
// means writing a new class here and changing one line in the composition root.
export class N8nInvoiceExtractor implements InvoiceExtractor {
  constructor(private readonly config: N8nInvoiceExtractorConfig) {}

  async extract(file: UploadedFile): Promise<ExtractionResult> {
    const endpoint = `${this.config.baseUrl.replace(/\/$/, '')}${this.config.extractPath}`;

    const formData = new FormData();
    formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    formData.append('useOcrFirst', 'true');

    const response = await fetch(endpoint, { method: 'POST', body: formData });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`n8n extraction failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      success: boolean;
      data?: ExtractionResult['data'];
      error?: string;
    };

    return {
      success: Boolean(json.success),
      data: json.data,
      error: json.error,
      raw: json
    };
  }
}
