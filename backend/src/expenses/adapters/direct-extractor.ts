import { persianWordsToNumber, restoreDroppedZeros } from '../../ai/handwritten-fixes';
import { checkInvoice } from '../../ai/invoice-checks';
import { todayJalali } from '../../ai/jalali';
import { LlmClient } from '../../ai/gateway/llm';
import { OcrClient, OcrFile } from '../../ai/gateway/ocr';
import { pageImage } from '../../ai/page-image';
import { EXTRACT_INVOICE, invoiceHandwrittenPrompt, invoiceRereadPrompt, invoiceStructurePrompt } from '../../ai/prompts/invoice-structure';
import { num, parseJsonObject, toInvoiceData, tomanToRial } from '../../ai/replies';
import { retryStep } from '../../ai/retry';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../ports';

/** Kept as the expense's errorMessage when the reading is used despite failed checks. */
export const AMOUNTS_UNCHECKED = 'The items do not add up to the invoice total - please check the amounts before submitting';

/**
 * Kept as the errorMessage of every handwritten reading; the fields to look at
 * first follow after "Check especially: " (the review page lists them).
 */
export const HANDWRITTEN_CHECK = 'Handwritten invoice - please compare every field with the photo before submitting';

/** Field names the review page can point at; anything else the model calls uncertain is dropped. */
const REVIEW_FIELDS = ['vendorName', 'vendorAddress', 'vendorTaxId', 'customerName', 'invoiceNumber', 'invoiceDate', 'subtotal', 'taxAmount', 'totalAmount', 'currency', 'items'];

type Reading = { structured: Record<string, unknown>; data: ExtractedInvoiceData };

// Extraction in-process (the receipt scanner from Nestmate): OCR → structuring
// prompt → sanity checks; if the numbers don't add up, one re-read with the
// photo next to the OCR text. Unlike Nestmate, a reading that still doesn't
// add up is kept (with a warning) — the user reviews every field before
// submitting anyway. Handwritten invoices are read from the photo by the
// vision model instead (OCR loses handwritten digits), cross-checked against
// the OCR reading. Never throws: failures come back as { success: false }.
export class DirectInvoiceExtractor implements InvoiceExtractor {
  constructor(
    private readonly ocr: OcrClient,
    private readonly llm: LlmClient,
    /** Reads handwriting; defaults to the main model when no separate vision model is configured. */
    private readonly vision: LlmClient = llm
  ) {}

  async extract(upload: UploadedFile, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const result = await this.extractAny(upload, options);
    // Last, so every check above works in the units printed on the invoice.
    return result.data ? { ...result, data: tomanToRial(result.data) } : result;
  }

  private async extractAny(upload: UploadedFile, options: ExtractOptions): Promise<ExtractionResult> {
    const file: OcrFile = { buffer: upload.buffer, filename: upload.originalname, contentType: upload.mimetype };
    const image = pageImage(file);
    try {
      if (!options.handwritten) return await this.extractPrinted(file, image);

      const handwritten = image ? await this.extractHandwritten(file, image).catch((err: Error) => err) : null;
      if (handwritten && !(handwritten instanceof Error)) return handwritten;
      // No photo to look at, or the vision model is down: the OCR reading is still better than nothing.
      const printed = await this.extractPrinted(file, image);
      return {
        ...printed,
        // OCR misreads handwritten digits, so its numbers are never trusted here.
        error: handwrittenWarning(['invoiceDate', 'totalAmount', 'items']),
        raw: { ...(printed.raw as object), visionError: handwritten ? handwritten.message : 'no image in the document' }
      };
    } catch (err) {
      const message = (err as Error).message || 'Extraction failed';
      const rateLimited = /rate limit|429/i.test(message);
      return { success: false, error: rateLimited ? 'The OCR/AI service is rate-limited right now. Please try again in a minute.' : message, raw: null };
    }
  }

  private async extractPrinted(file: OcrFile, image: string | null): Promise<ExtractionResult> {
    const { ocrText, first } = await this.ocrReading(file);
    const firstCheck = checkInvoice(first.data);
    if (!firstCheck.problems.length) {
      return { success: true, data: first.data, raw: { provider: 'direct', data: first.structured, ocrText } };
    }

    // The photo — also the one inside a scanner-app PDF — lets the model follow the lines; a text PDF just gets the hints.
    const problems = firstCheck.problems.map((p) => p.message);
    const second = await this.read(this.llm, invoiceRereadPrompt(ocrText, problems, Boolean(image)), image ?? undefined).catch(() => null);
    if (second && second.data.items.length && !checkInvoice(second.data).problems.length) {
      return { success: true, data: second.data, raw: { provider: 'direct', data: second.structured, first: first.structured, ocrText } };
    }
    return {
      success: true,
      data: first.data,
      error: AMOUNTS_UNCHECKED,
      raw: { provider: 'direct', data: first.structured, reread: second?.structured ?? null, problems: firstCheck.problems.map((p) => p.detail), ocrText }
    };
  }

  /**
   * Two independent readings at once: the vision model from the photo (the one
   * used), and OCR → text model (only to compare against: OCR keeps a
   * handwritten total's digits but drops its zeros, and gets dates wrong).
   * Every field that disagrees or fails a check is named in the warning.
   */
  private async extractHandwritten(file: OcrFile, image: string): Promise<ExtractionResult> {
    const [vision, ocr] = await Promise.all([
      this.read(this.vision, invoiceHandwrittenPrompt(todayJalali()), image),
      this.ocrReading(file).catch(() => null)
    ]);
    const { structured } = vision;
    let data = vision.data;
    const uncertain = new Set(
      (Array.isArray(structured.uncertainFields) ? structured.uncertainFields : []).map((f) => String(f).split(/[.[]/)[0])
    );

    // The total in words, parsed here (the model's own value follows its misreadings), is the reference
    // amount: lines that only add up to it with zeros restored get them back.
    const words = typeof structured.totalInWords === 'string' ? structured.totalInWords : null;
    const inWords = persianWordsToNumber(words) ?? num(structured.totalInWordsValue);
    const reference = inWords ?? data.totalAmount;
    const restored = reference !== null ? restoreDroppedZeros(data.items, reference) : null;
    if (restored) data = { ...data, items: restored };
    if (inWords !== null && data.totalAmount !== inWords) {
      const lines = data.items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
      if (lines === inWords) data = { ...data, totalAmount: inWords, subtotal: data.subtotal === data.totalAmount ? inWords : data.subtotal };
      else uncertain.add('totalAmount');
    }
    // The unit written in words beats the model's guess.
    const unit = words?.includes('تومان') ? 'IRT' : words?.includes('ریال') ? 'IRR' : null;
    if (unit) data = { ...data, currency: unit };
    if (checkInvoice(data).problems.length) uncertain.add('items');
    if (!isRecent(data.invoiceDate)) uncertain.add('invoiceDate');
    if (!data.vendorName) uncertain.add('vendorName');
    if (ocr) {
      const other = ocr.first.data.totalAmount;
      if (data.totalAmount !== null && other !== null && !sameDigits(data.totalAmount, other)) uncertain.add('totalAmount');
    }

    const fields = REVIEW_FIELDS.filter((f) => uncertain.has(f));
    return {
      success: true,
      data,
      error: handwrittenWarning(fields),
      raw: { provider: 'direct', mode: 'handwritten', data: structured, totalInWords: inWords, restoredZeros: Boolean(restored), uncertain: fields, ocrReading: ocr?.first.structured ?? null, ocrText: ocr?.ocrText ?? null }
    };
  }

  private async ocrReading(file: OcrFile): Promise<{ ocrText: string; first: Reading }> {
    const ocrText = await retryStep(() => this.ocr.extractText(file));
    if (!ocrText.trim()) throw new Error('No text found on the document - please upload a clearer photo or PDF');
    return { ocrText, first: await this.read(this.llm, invoiceStructurePrompt(ocrText)) };
  }

  private async read(llm: LlmClient, prompt: string, image?: string): Promise<Reading> {
    const answer = await retryStep(() => llm.complete({ ...EXTRACT_INVOICE, prompt, image }));
    const structured = parseJsonObject(answer);
    return { structured, data: toInvoiceData(structured) };
  }
}

function handwrittenWarning(fields: string[]): string {
  return fields.length ? `${HANDWRITTEN_CHECK}. Check especially: ${fields.join(', ')}` : HANDWRITTEN_CHECK;
}

/** OCR drops zeros written one per box: 76 and 76000000 are the same reading of the digits. */
function sameDigits(a: number, b: number): boolean {
  const digits = (n: number) => String(Math.round(n)).replace(/0+$/, '');
  return digits(a) === digits(b);
}

/** An expense receipt from the last year, not from the future: otherwise a digit of the year was likely misread. */
function isRecent(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const age = Date.now() - new Date(isoDate).getTime();
  return age > -2 * 86_400_000 && age < 366 * 86_400_000;
}
