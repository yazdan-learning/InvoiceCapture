// Mistral's document OCR, sent the file inline. Shared with Nestmate: see @yazdan-learning/ai.
import { MistralOcr as SharedOcr, MistralOcrConfig } from '@yazdan-learning/ai';

export type { MistralOcrConfig } from '@yazdan-learning/ai';

/**
 * Pages read from a PDF (0-based); shorter PDFs are fine. A scanner-app PDF can
 * hold several receipts and the payment's bank transfer, so more than the first
 * few (OCR is billed per page).
 */
export const PDF_PAGES = [0, 1, 2, 3, 4, 5, 6, 7];

export class MistralOcr extends SharedOcr {
  constructor(config: MistralOcrConfig) {
    super({ pdfPages: PDF_PAGES, ...config });
  }
}
