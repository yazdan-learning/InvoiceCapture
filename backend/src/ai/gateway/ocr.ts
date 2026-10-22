export type OcrFile = { buffer: Buffer; filename: string; contentType: string };

/** Turns a photo or PDF into text (markdown) for the extraction prompt. */
export interface OcrClient {
  /** Throws AiUnavailableError (retryable for rate limits/hiccups). */
  extractText(file: OcrFile): Promise<string>;
}
