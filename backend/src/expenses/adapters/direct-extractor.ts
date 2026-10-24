import { fitToPaidAmount, paidByTransfer, restoreDroppedZeros } from '../../ai/handwritten-fixes';
import { checkInvoice, withoutTaxLine } from '../../ai/invoice-checks';
import { LlmClient } from '../../ai/gateway/llm';
import { OcrClient, OcrFile } from '../../ai/gateway/ocr';
import { MAX_SPLIT_PAGES, pageImage, pageImages } from '../../ai/page-image';
import {
  EXTRACT_INVOICE,
  invoiceHandwrittenPrompt,
  invoiceRereadPrompt,
  invoiceSplitPrompt,
  invoiceStructurePrompt,
  SPLIT_INVOICES
} from '../../ai/prompts/invoice-structure';
import { applyCurrencyUnits, num, parseJsonObject, toInvoiceData, toTransfer, TransferReceipt } from '../../ai/replies';
import { retryStep } from '../../ai/retry';
import { Calendar, getCalendar } from '../../countries/calendars';
import { HandwritingRules, InvoiceRules } from '../../countries/country-profile';
import { international } from '../../countries/international';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../ports';

/** Kept as the expense's errorMessage when the reading is used despite failed checks. */
export const AMOUNTS_UNCHECKED = 'The items do not add up to the invoice total - please check the amounts before submitting';

/**
 * Kept as the errorMessage of every handwritten reading; the fields to look at
 * first follow after "Check especially: " (the review page lists them).
 */
/** When a file holds several invoices but they couldn't be read apart. */
export const severalInvoicesWarning = (count: number) =>
  `This file seems to hold ${count} invoices, but only the first was read - please upload the others separately`;

/** A bank transfer receipt scanned with the invoice (countries whose profile reads one) disagrees with the reading. */
export const PAID_AMOUNT_DIFFERS = 'The amounts do not match the bank transfer in the file - please check them before submitting';
/** The amounts were put in the unit, or given the zeros, that make them match the bank transfer. */
export const PAID_AMOUNT_FITTED = 'The amounts were corrected to match the bank transfer in the file - please check them before submitting';
/** A file of several invoices and one bank transfer that paid the others, not this one (e.g. a courier receipt the sender paid). */
export const NOT_IN_TRANSFER = 'The bank transfer in the file paid the other invoices of this file, not this one - please check who paid it';
/** Nothing but the bank transfer could be read. */
export const TRANSFER_ONLY = 'Only the bank transfer in the file could be read: the vendor, date and amount come from it - please check them against the invoice';

export const HANDWRITTEN_CHECK = 'Handwritten invoice - please compare every field with the photo before submitting';

/** Field names the review page can point at; anything else the model calls uncertain is dropped. */
const REVIEW_FIELDS = ['vendorName', 'vendorAddress', 'vendorTaxId', 'customerName', 'invoiceNumber', 'invoiceDate', 'subtotal', 'taxAmount', 'totalAmount', 'currency', 'items'];

type Reading = { structured: Record<string, unknown>; data: ExtractedInvoiceData };

/** What one extraction needs from the organization's country profile. */
type Locale = { rules: InvoiceRules; calendar: Calendar };

// Extraction in-process (the receipt scanner from Nestmate): OCR → structuring
// prompt → sanity checks; if the numbers don't add up, one re-read with the
// photo next to the OCR text. Unlike Nestmate, a reading that still doesn't
// add up is kept (with a warning) — the user reviews every field before
// submitting anyway. Handwritten invoices (only in countries whose profile has
// handwriting rules) are read from the photo by the vision model instead (OCR
// loses handwritten digits), cross-checked against the OCR reading. Never
// throws: failures come back as { success: false }.
export class DirectInvoiceExtractor implements InvoiceExtractor {
  constructor(
    private readonly ocr: OcrClient,
    private readonly llm: LlmClient,
    /** Reads handwriting; defaults to the main model when no separate vision model is configured. */
    private readonly vision: LlmClient = llm
  ) {}

  async extract(upload: UploadedFile, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const country = options.country ?? international;
    const locale: Locale = { rules: country.invoice, calendar: getCalendar(country.calendar) };
    const result = await this.extractAny(upload, locale, options.handwritten ? country.invoice.handwriting : undefined);
    // Last, so every check above works in the units printed on the invoice.
    const inStoredUnits = (data: ExtractedInvoiceData) => applyCurrencyUnits(data, locale.rules.currencyUnits);
    return result.data
      ? { ...result, data: inStoredUnits(result.data), more: result.more?.map((part) => ({ ...part, data: inStoredUnits(part.data) })) }
      : result;
  }

  private async extractAny(upload: UploadedFile, locale: Locale, handwriting: HandwritingRules | undefined): Promise<ExtractionResult> {
    const file: OcrFile = { buffer: upload.buffer, filename: upload.originalname, contentType: upload.mimetype };
    const image = pageImage(file);
    try {
      if (!handwriting) return await this.extractPrinted(file, image, locale);

      const pages = pageImages(file);
      const handwritten = pages.length ? await this.extractHandwritten(file, pages, locale, handwriting).catch((err: Error) => err) : null;
      if (handwritten && !(handwritten instanceof Error)) return handwritten;
      // No photo to look at, or the vision model is down: the OCR reading is still better than nothing.
      const printed = await this.extractPrinted(file, image, locale);
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

  private async extractPrinted(file: OcrFile, image: string | null, locale: Locale): Promise<ExtractionResult> {
    const { ocrText, first } = await this.ocrReading(file, locale);
    const count = Math.round(num(first.structured.invoiceCount) ?? 1);
    if (count < 2) {
      const transfer = toTransfer(first.structured, locale.calendar);
      return withTransfer(await this.checkedReading(ocrText, first, image, locale, transfer), transfer, locale);
    }

    // From the page photos when there are any (OCR misses receipts photographed side by side), else from the text.
    const pages = pageImages(file, MAX_SPLIT_PAGES);
    const transfer = toTransfer(first.structured, locale.calendar);
    const several =
      (pages.length ? await this.readSeveral(ocrText, count, locale, transfer, pages).catch(() => null) : null) ??
      (await this.readSeveral(ocrText, count, locale, transfer).catch(() => null));
    if (several) return several;
    const single = await this.checkedReading(ocrText, first, image, locale);
    return { ...single, error: [severalInvoicesWarning(count), single.error].filter(Boolean).join('. ') };
  }

  /**
   * Every invoice of a file that holds several, from one more reading of the
   * OCR text; null when fewer than two came back, so the caller falls back to
   * the first one. No re-read per invoice: one that doesn't add up keeps the warning.
   */
  private async readSeveral(
    ocrText: string,
    count: number,
    locale: Locale,
    firstTransfer: TransferReceipt | null,
    pages?: string[]
  ): Promise<ExtractionResult | null> {
    const llm = pages ? this.vision : this.llm;
    const prompt = invoiceSplitPrompt(ocrText, count, locale.rules, Boolean(pages));
    const answer = await retryStep(async () => parseJsonObject(await llm.complete({ ...SPLIT_INVOICES, prompt, image: pages })));
    const list = answer.invoices;
    if (!Array.isArray(list)) return null;
    const parts = list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((structured) => {
        const data = withoutTaxLine(toInvoiceData(structured, locale.calendar));
        return { data, error: checkInvoice(data).problems.length ? AMOUNTS_UNCHECKED : undefined, structured };
      })
      .filter((part) => part.data.totalAmount !== null || part.data.items.length > 0);
    if (parts.length < 2) return null;

    // A bank transfer in the file pays some of them: the others get a warning. Each reading of it is tried (this
    // one's, from the photos, first: OCR misreads Persian digits), and the one the invoices add up to wins.
    const transfers = [answer, ...parts.map((part) => part.structured)]
      .map((structured) => toTransfer(structured, locale.calendar))
      .concat(firstTransfer)
      .filter((t): t is TransferReceipt => !!t);
    const fits = transfers.map((t) => ({ transfer: t, paid: paidByTransfer(parts.map((part) => part.data), t, locale.rules.currencyUnits) }));
    const { transfer, paid } = fits.find((f) => f.paid) ?? { transfer: transfers[0] ?? null, paid: null };
    const [first, ...more] = parts.map(({ structured, ...part }, index) => ({
      ...part,
      // No set of them adds up to it: some amount is likely misread.
      error: transfer && (!paid || !paid[index]) ? [paid ? NOT_IN_TRANSFER : PAID_AMOUNT_DIFFERS, part.error].filter(Boolean).join('. ') : part.error,
      raw: { provider: 'direct', mode: 'split', fromPhotos: Boolean(pages), part: index + 1, of: parts.length, data: structured, ocrText }
    }));
    return { success: true, ...first, more };
  }

  /**
   * The first reading, or one re-read when its numbers don't add up — or, with
   * a bank transfer receipt in the file, don't match what was paid.
   */
  private async checkedReading(
    ocrText: string,
    first: Reading,
    image: string | null,
    locale: Locale,
    transfer: TransferReceipt | null = null
  ): Promise<ExtractionResult> {
    const firstCheck = checkInvoice(first.data);
    const unpaid = transfer && first.data.totalAmount !== null && !fitToPaidAmount(first.data, transfer, locale.rules.currencyUnits);
    if (!firstCheck.problems.length && !unpaid) {
      return { success: true, data: first.data, raw: { provider: 'direct', data: first.structured, ocrText } };
    }

    // The photo — also the one inside a scanner-app PDF — lets the model follow the lines; a text PDF just gets the hints.
    const problems = firstCheck.problems.map((p) => p.message);
    if (unpaid) {
      problems.push(
        `The bank transfer receipt in the file paid ${transfer.amount} ${transfer.currency ?? ''}, but the invoice was read as ${first.data.totalAmount}: re-read the amounts (an amount printed as 0 is 0).`
      );
    }
    const prompt = invoiceRereadPrompt(ocrText, problems, Boolean(image), locale.rules);
    const second = await this.read(this.llm, prompt, locale.calendar, image ?? undefined).catch(() => null);
    const secondAddsUp = second && second.data.items.length && !checkInvoice(second.data).problems.length;
    // A transfer that still doesn't match may pay several invoices, or part of one (withTransfer says so):
    // then the second reading only wins when the first didn't add up.
    const secondFits = second && (!unpaid || firstCheck.problems.length || fitToPaidAmount(second.data, transfer, locale.rules.currencyUnits));
    if (second && secondAddsUp && secondFits) {
      return { success: true, data: second.data, raw: { provider: 'direct', data: second.structured, first: first.structured, ocrText } };
    }
    return {
      success: true,
      data: first.data,
      error: firstCheck.problems.length ? AMOUNTS_UNCHECKED : undefined,
      raw: { provider: 'direct', data: first.structured, reread: second?.structured ?? null, problems: firstCheck.problems.map((p) => p.detail), ocrText }
    };
  }

  /**
   * Two independent readings at once: the vision model from the photo (the one
   * used), and OCR → text model (only to compare against: OCR keeps a
   * handwritten total's digits but drops its zeros, and gets dates wrong).
   * Every field that disagrees or fails a check is named in the warning.
   */
  private async extractHandwritten(file: OcrFile, pages: string[], locale: Locale, handwriting: HandwritingRules): Promise<ExtractionResult> {
    const [vision, ocr] = await Promise.all([
      this.read(this.vision, invoiceHandwrittenPrompt({ ...locale.rules, handwriting }, locale.calendar.today()), locale.calendar, pages),
      this.ocrReading(file, locale).catch(() => null)
    ]);
    const { structured } = vision;
    let data = vision.data;
    const uncertain = new Set(
      (Array.isArray(structured.uncertainFields) ? structured.uncertainFields : []).map((f) => String(f).split(/[.[]/)[0])
    );

    // The total in words, parsed here (the model's own value follows its misreadings), is the reference
    // amount: lines that only add up to it with zeros restored get them back.
    const words = typeof structured.totalInWords === 'string' ? structured.totalInWords : null;
    const inWords = handwriting.wordsToNumber(words) ?? num(structured.totalInWordsValue);
    const reference = inWords ?? data.totalAmount;
    const restored = reference !== null ? restoreDroppedZeros(data.items, reference) : null;
    if (restored) data = { ...data, items: restored };
    if (inWords !== null && data.totalAmount !== inWords) {
      const lines = data.items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
      if (lines === inWords) data = { ...data, totalAmount: inWords, subtotal: data.subtotal === data.totalAmount ? inWords : data.subtotal };
      else uncertain.add('totalAmount');
    }
    // The unit written in words beats the model's guess.
    const unit = Object.entries(handwriting.currencyWords).find(([word]) => words?.includes(word))?.[1];
    if (unit) data = { ...data, currency: unit };
    // A bank transfer receipt in the same file (OCR reads its printed digits exactly) is what was paid.
    // Both readings look for it; the one the invoice fits wins (either can misread a digit).
    const transfers = [ocr && toTransfer(ocr.first.structured, locale.calendar), toTransfer(structured, locale.calendar)].filter(
      (t): t is TransferReceipt => !!t
    );
    const fits = transfers.map((t) => ({ transfer: t, fitted: fitToPaidAmount(data, t, locale.rules.currencyUnits) }));
    const { transfer, fitted } = fits.find((f) => f.fitted) ?? { transfer: transfers[0] ?? null, fitted: null };
    if (transfer) {
      if (fitted) data = fitted;
      else uncertain.add('totalAmount');
      // A misread year: the payment is normally made the day of the invoice, or soon after.
      if (!isRecent(data.invoiceDate) && isRecent(transfer.date)) {
        data = { ...data, invoiceDate: transfer.date };
        uncertain.add('invoiceDate');
      }
      if (!data.vendorName && transfer.payee) {
        data = { ...data, vendorName: transfer.payee };
        uncertain.add('vendorName');
      }
      data = { ...data, paymentMethod: data.paymentMethod ?? 'bank transfer' };
    }
    if (checkInvoice(data).problems.length) uncertain.add('items');
    if (!isRecent(data.invoiceDate)) uncertain.add('invoiceDate');
    if (!data.vendorName) uncertain.add('vendorName');
    if (ocr && !transfer) {
      const other = ocr.first.data.totalAmount;
      if (data.totalAmount !== null && other !== null && !sameDigits(data.totalAmount, other)) uncertain.add('totalAmount');
    }

    const fields = REVIEW_FIELDS.filter((f) => uncertain.has(f));
    // Several handwritten receipts in one file are read as one: say so (the vision prompt reads one invoice).
    const count = Math.round(num(ocr?.first.structured.invoiceCount) ?? 1);
    return {
      success: true,
      data,
      error: [count > 1 ? severalInvoicesWarning(count) : null, handwrittenWarning(fields)].filter(Boolean).join('. '),
      raw: { provider: 'direct', mode: 'handwritten', data: structured, totalInWords: inWords, restoredZeros: Boolean(restored), transfer, uncertain: fields, ocrReading: ocr?.first.structured ?? null, ocrText: ocr?.ocrText ?? null }
    };
  }

  private async ocrReading(file: OcrFile, locale: Locale): Promise<{ ocrText: string; first: Reading }> {
    const ocrText = await retryStep(() => this.ocr.extractText(file));
    if (!ocrText.trim()) throw new Error('No text found on the document - please upload a clearer photo or PDF');
    return { ocrText, first: await this.read(this.llm, invoiceStructurePrompt(ocrText, locale.rules), locale.calendar) };
  }

  private async read(llm: LlmClient, prompt: string, calendar: Calendar, image?: string | string[]): Promise<Reading> {
    // A cut-off or malformed answer (the vision model now and then) is retried like any other failed call.
    const structured = await retryStep(async () => parseJsonObject(await llm.complete({ ...EXTRACT_INVOICE, prompt, image })));
    return { structured, data: withoutTaxLine(toInvoiceData(structured, calendar)) };
  }
}

/**
 * A printed reading against the bank transfer receipt scanned with it (only
 * countries whose profile reads one): the transfer's printed digits are exact,
 * so amounts off by a unit or by zeros are fitted to it, and a file in which
 * nothing else could be read is recorded as the payment.
 */
function withTransfer(result: ExtractionResult, transfer: TransferReceipt | null, locale: Locale): ExtractionResult {
  if (!transfer || !result.data) return result;
  const data = { ...result.data, paymentMethod: result.data.paymentMethod ?? 'bank transfer' };
  if (data.totalAmount === null && !data.items.length) {
    return {
      ...result,
      data: {
        ...data,
        vendorName: data.vendorName ?? transfer.payee,
        invoiceDate: data.invoiceDate ?? transfer.date,
        subtotal: transfer.amount,
        totalAmount: transfer.amount,
        currency: transfer.currency ?? data.currency,
        paymentMethod: 'bank transfer'
      },
      error: TRANSFER_ONLY
    };
  }
  const fitted = fitToPaidAmount(data, transfer, locale.rules.currencyUnits);
  if (!fitted) return { ...result, data, error: [result.error, PAID_AMOUNT_DIFFERS].filter(Boolean).join('. ') };
  if (fitted.totalAmount === data.totalAmount && fitted.items === data.items) return { ...result, data: fitted };
  const unchecked = checkInvoice(fitted).problems.length ? AMOUNTS_UNCHECKED : null;
  return { ...result, data: fitted, error: [PAID_AMOUNT_FITTED, unchecked].filter(Boolean).join('. ') };
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
