import {
  checkReading,
  CheckOptions,
  enlargeSmallImage,
  GERMAN_RETAIL_SHOPS,
  guidancePromptBlock,
  isSmallImage,
  linesWithDiscountOrTax,
  parseJsonObject,
  ReadingCheck,
  retryStep,
  reviewReading,
  smallGapCents,
  StaticShopGuidance
} from '@yazdan-learning/ai';
import { LlmClient } from '../ai/gateway/llm';
import { OcrClient, OcrFile } from '../ai/gateway/ocr';
import { SUMMARY_LINE, withoutTaxLine } from '../ai/invoice-checks';
import { pageImage } from '../ai/page-image';
import { EXTRACT_INVOICE, invoiceRereadPrompt } from '../ai/prompts/invoice-structure';
import { toInvoiceData } from '../ai/replies';
import { getCalendar } from '../countries/calendars';
import { CountryProfile } from '../countries/country-profile';
import { international } from '../countries/international';
import { AMOUNTS_UNCHECKED } from '../expenses/adapters/direct-extractor';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../expenses/ports';

// The template-guided reader (Organization.invoiceReader = TEMPLATE): every
// kind of file — printed, handwritten, several invoices in one file. It reads
// with the classic extractor (the stable reader, kept as it is until this one
// replaces it) and adds the shared steps of @yazdan-learning/ai around it:
//   - OCR first, so a foreign receipt (no Persian text) in an Iranian
//     organization is read with the international rules, not the Persian ones
//     (which turned a Lidl receipt's VAT into a discount and dropped its
//     discount lines);
//   - a small photo or screenshot (under 600 px on its short side) is
//     enlarged 2× before OCR and the re-read: Mistral OCR then reads its small
//     print right (a 270 px Lidl screenshot: 0,65 → 0,85, −0,40 → −0,48);
//   - VAT codes read as quantities (dm's "2,95 2") are taken out when the total
//     and every VAT group then add up;
//   - one last look with a stronger model when the amounts still don't add up
//     (LLM_MODEL_LARGE; skipped when empty);
//   - an invoice still far off its total gets a stronger warning than a few cents.
// Handwritten invoices are read as in CLASSIC (the vision model from the photo,
// cross-checked against OCR at the same time, so no OCR first), with the small
// photo enlarged. Several invoices in one file: each one gets the far-off
// warning; the VAT-code fix and the last look are for single invoices (the
// file's VAT tables and photo hold all of them).
// Template matching (known vendors' layouts) comes in here next.

/** Kept as the errorMessage when the lines are far off the total after every look. */
export const AMOUNTS_FAR_OFF =
  'The items are far off the invoice total, so the photo was probably misread - please upload a clearer photo or check every line before submitting';

/** Persian/Arabic letters: an Iranian invoice has them, a German till receipt doesn't. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

const CHECKS: CheckOptions = { summaryLine: SUMMARY_LINE, totalMatches: linesWithDiscountOrTax };

const shops = new StaticShopGuidance(GERMAN_RETAIL_SHOPS);

/** What this reader did, kept in rawExtraction.template (the review's checks read smallImage from it). */
export type TemplateReadingInfo = {
  mode: 'printed' | 'handwritten' | 'several';
  foreignReceipt: boolean;
  vatCodeLines: number[];
  largeModel: 'not-needed' | 'not-configured' | 'added-up' | 'no-better' | 'failed';
  farOff: boolean;
  smallImage: boolean | null;
  /** The photo was enlarged 2× before reading. */
  enlarged: boolean;
};

const hasGap = (check: ReadingCheck) => check.problems.some((p) => p.code === 'total_mismatch');
/** The lines are off the total by more than a digit or two (and nothing else is wrong): shifted or missed lines. */
const isFarOff = (check: ReadingCheck) => hasGap(check) && check.problems.length === 1 && smallGapCents(check) === null;

/** The error message without one of its parts (parts are joined with ". "). */
function withoutMessage(error: string | undefined, message: string): string | undefined {
  const rest = (error ?? '')
    .split('. ')
    .filter((part) => part && part !== message)
    .join('. ');
  return rest || undefined;
}

export class TemplateInvoiceExtractor implements InvoiceExtractor {
  constructor(
    private readonly classic: InvoiceExtractor,
    private readonly ocr: OcrClient,
    /** The stronger model for the last look; null when LLM_MODEL_LARGE is empty. */
    private readonly large: LlmClient | null
  ) {}

  async extract(upload: UploadedFile, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const country = options.country ?? international;
    const { enlarged, ...file } = await enlargeSmallImage<OcrFile>({ buffer: upload.buffer, filename: upload.originalname, contentType: upload.mimetype });
    // The classic reader gets the enlarged photo too, for its re-read with the photo; the stored file stays the original.
    const read: UploadedFile = enlarged ? { ...upload, buffer: file.buffer, mimetype: file.contentType, originalname: file.filename, size: file.buffer.length } : upload;
    const info: TemplateReadingInfo = {
      mode: 'printed',
      foreignReceipt: false,
      vatCodeLines: [],
      largeModel: 'not-needed',
      farOff: false,
      smallImage: isSmallImage(upload.buffer, upload.mimetype),
      enlarged
    };
    const tagged = (r: ExtractionResult, part: Partial<TemplateReadingInfo> = {}) => ({ ...r, raw: { ...(r.raw as object), template: { ...info, ...part } } });

    // Handwritten (countries with handwriting rules): the vision model reads the photo, OCR runs alongside to compare.
    if (options.handwritten && country.invoice.handwriting) {
      info.mode = 'handwritten';
      return tagged(await this.classic.extract(read, options));
    }

    let ocrText: string;
    try {
      ocrText = await retryStep(() => this.ocr.extractText(file));
    } catch {
      // The classic reader tries the OCR again and reports the failure the usual way.
      return tagged(await this.classic.extract(read, options));
    }

    info.foreignReceipt = country.id === 'IR' && !ARABIC_SCRIPT.test(ocrText);
    const rules: CountryProfile = info.foreignReceipt ? international : country;
    const result = await this.classic.extract(read, { ...options, country: rules, ocrText });
    if (!result.data) return tagged(result);
    if (result.more?.length) info.mode = 'several';
    // The checks below work in the units printed on the invoice; stored units differ only with a currency unit (Toman).
    if (rules.invoice.currencyUnits.length) return tagged(result);

    if (result.more?.length) {
      const parts = [{ data: result.data, error: result.error, raw: result.raw }, ...result.more].map((part) => {
        const farOff = isFarOff(checkReading(part.data, CHECKS));
        const error = farOff ? [withoutMessage(part.error, AMOUNTS_UNCHECKED), AMOUNTS_FAR_OFF].filter(Boolean).join('. ') : part.error;
        return tagged({ success: true, data: part.data, error, raw: part.raw }, { farOff });
      });
      const [first, ...more] = parts;
      return { ...first, more: more.map(({ data, error, raw }) => ({ data: data!, error, raw })) };
    }

    let data = result.data;
    let error = result.error;
    const review = reviewReading(data, { ...CHECKS, ocrText });
    if (review.vatCodeLines.length) {
      data = review.reading;
      info.vatCodeLines = review.vatCodeLines;
    }
    let check = checkReading(data, CHECKS);

    if (hasGap(check)) {
      const image = pageImage(file);
      if (!this.large) info.largeModel = 'not-configured';
      else if (image) {
        const better = await this.lastLook(ocrText, check, image, rules).catch(() => null);
        if (!better) info.largeModel = 'failed';
        else {
          const betterCheck = checkReading(better, CHECKS);
          if (!hasGap(betterCheck) && better.items.length) {
            data = better;
            check = betterCheck;
            info.largeModel = 'added-up';
          } else {
            info.largeModel = 'no-better';
          }
        }
      }
    }

    if (!hasGap(check)) {
      error = withoutMessage(error, AMOUNTS_UNCHECKED);
    } else if (isFarOff(check)) {
      // Not a digit or two: lines shifted or missed. Say so plainly.
      info.farOff = true;
      error = [withoutMessage(error, AMOUNTS_UNCHECKED), AMOUNTS_FAR_OFF].filter(Boolean).join('. ');
    }
    return tagged({ ...result, data, error });
  }

  /** One more reading with the stronger model, the photo, what didn't add up, and what is known about the shop. */
  private async lastLook(ocrText: string, check: ReadingCheck, image: string, rules: CountryProfile): Promise<ExtractedInvoiceData> {
    const guidance = shops.guidanceFor({ ocrText });
    const prompt = `${invoiceRereadPrompt(ocrText, check.problems.map((p) => p.message), true, rules.invoice)}${guidancePromptBlock(guidance)}`;
    const structured = await retryStep(async () => parseJsonObject(await this.large!.complete({ ...EXTRACT_INVOICE, prompt, image })));
    return withoutTaxLine(toInvoiceData(structured, getCalendar(rules.calendar)));
  }
}

/**
 * Picks the reader by Organization.invoiceReader (passed as options.reader):
 * TEMPLATE goes through the template-guided reader, anything else to the
 * classic extractor exactly as it was.
 */
export class ReaderSwitchExtractor implements InvoiceExtractor {
  constructor(
    private readonly classic: InvoiceExtractor,
    private readonly template: InvoiceExtractor
  ) {}

  extract(file: UploadedFile, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const { reader, ...rest } = options;
    return reader === 'TEMPLATE' ? this.template.extract(file, rest) : this.classic.extract(file, rest);
  }
}
