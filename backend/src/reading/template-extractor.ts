import {
  cents,
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
  VatRow,
  StaticShopGuidance,
  vatTotals,
  type OcrPage,
  type PdfRenderer,
  type PositionedOcrClient
} from '@yazdan-learning/ai';
import { LlmClient } from '../ai/gateway/llm';
import { OcrClient, OcrFile } from '../ai/gateway/ocr';
import { SUMMARY_LINE, withoutTaxLine } from '../ai/invoice-checks';
import { pageImage } from '../ai/page-image';
import { EXTRACT_INVOICE, invoiceRereadPrompt } from '../ai/prompts/invoice-structure';
import { applyCurrencyUnits, toInvoiceData } from '../ai/replies';
import { printedAmount, printedDate } from './box-text';
import { getCalendar } from '../countries/calendars';
import { CountryProfile } from '../countries/country-profile';
import { international } from '../countries/international';
import { AMOUNTS_UNCHECKED } from '../expenses/adapters/direct-extractor';
import { ExtractedInvoiceData, ExtractionResult, ExtractOptions, InvoiceExtractor, UploadedFile } from '../expenses/ports';
import { documentPages } from './page-images';
import { pdfText } from './pdf-text';
import { findTemplate, READABLE_PAGE, readPageWords, TemplateMatch, WORDS_MATCH } from './template-finder';
import { checkGuidedReading, differences, GuidedOutcome, isTrusted, templateHints, withRuledFields } from './template-guide';
import { matchWords, pageLook, readableWords, wordKey } from './template-match';
import { cheapUsuallyFails, guideRequiredLabels, hasGuide, withGuideFields, withoutZeroCharges } from './form-guide';
import { hasLabel, labelKey, requiredLabels, ruledFields, taxIdsInText, vendorKeysInText } from './templates';
import type { TemplatesRepository } from './templates.repository';

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
//   - the VAT and net amounts come from the receipt's VAT table when it adds up
//     to the total (the model makes up a tax that merely adds up: dm 5,80
//     instead of the printed 4,60 + 1,51); a table that disagrees with the
//     reading gets a warning;
// Handwritten invoices are read as in CLASSIC (the vision model from the photo,
// cross-checked against OCR at the same time, so no OCR first), with the small
// photo enlarged. Several invoices in one file: each one gets the far-off
// warning; the VAT-code fix and the last look are for single invoices (the
// file's VAT tables and photo hold all of them).
// Invoice templates (known forms' layouts; see template-finder.ts and
// template-guide.ts): before the reading, the document's template is looked
// for, free — its vendor's tax ID or name anywhere in the OCR text, else the
// form's printed words (Tesseract), else the page's look — and the reading's
// prompt says where that form prints each value. The guided reading is checked
// (box contents, vendor, main values, sums) and, failing any check, read again
// without the template. While a template is new, both readings are made, the
// plain one is used, and their differences are kept (rawExtraction.template.match).

/** What finding templates on upload needs: the templates, and the Tesseract service for word positions and drawing text PDFs. */
export type TemplateGuideDeps = {
  templates: TemplatesRepository;
  words: () => PositionedOcrClient | null;
  renderer: () => PdfRenderer | null;
  /** Reads the page image when the OCR keeps missing what the form always prints; null or absent: not done. */
  vision?: () => LlmClient | null;
};

/** More OCR calls when its text lacks what the form always prints (Mistral OCR now and then skips part of a page). */
const OCR_RETRIES = 2;

type FoundTemplate = { match: TemplateMatch; words: () => Promise<OcrPage[] | null> };

/**
 * The missing labels that are gone from the page rather than missed by the OCR:
 * word OCR (Tesseract) reads the page well (READABLE_PAGE words, the form's
 * printed words where the template has them, WORDS_MATCH), and finds none of
 * a label's distinctive words, which it read on this form before (among the
 * template's printed words: printed once, in place). Unsure (a poor scan, a
 * label it never read): none.
 */
async function labelsGone(found: FoundTemplate, missing: string[]): Promise<string[]> {
  const template = found.match.template;
  const read = await found.words().catch(() => null);
  if (!read || readableWords(read) < READABLE_PAGE || template.words.length === 0) return [];
  if (matchWords(template.words, read).score < WORDS_MATCH) return [];
  const known = new Set(template.words.map((w) => w.text));
  const onPage = new Set(read.flatMap((p) => p.words.map((w) => wordKey(w.text))));
  // The label's distinctive words: the ones learned as printed once on the form ("کل" of "هزینه کل"; not "هزینه", printed 4 times).
  return missing.filter((label) => {
    const distinctive = label.split(/\s+/).map(wordKey).filter((w) => w.length >= 2 && /\p{L}/u.test(w) && known.has(w));
    return distinctive.length > 0 && !distinctive.some((w) => onPage.has(w));
  });
}

/** Name keys looked up from one document's text at most (a long receipt has many word runs). */
const MAX_TEXT_KEYS = 2000;

/** Kept as the errorMessage when the lines are far off the total after every look. */
export const AMOUNTS_FAR_OFF =
  'The items are far off the invoice total, so the photo was probably misread - please upload a clearer photo or check every line before submitting';

/** Kept as the errorMessage when the VAT table printed on the receipt doesn't agree with the reading. */
export const TAX_UNCHECKED = 'The VAT table on the receipt does not match the amounts read - please check the tax and the total before submitting';

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
  /** Tax and net amounts: as read, taken from the VAT table, or the table disagrees. */
  vatTable?: 'none' | 'agrees' | 'used' | 'disagrees';
  /** The invoice template the reading was guided by, and what came of it. */
  match?: GuidedOutcome;
  /** The form's labels (the user's rules) the OCR text lacked after every try; the page image was read then. */
  ocrMissing?: string[];
  /** More OCR calls made because its text lacked one of them. */
  ocrRetries?: number;
  /**
   * Labels the form used to print that are gone from this page (word OCR reads the page well, finds the
   * form's other printed words, but not these, which it read on this form before): the form changed, so
   * no more OCR calls or image reading for them.
   */
  formChanged?: string[];
  /** Where the text read came from: the PDF's own words (exact, free) or Mistral OCR. */
  textFrom?: 'pdf' | 'ocr';
  /** Why a PDF's own text wasn't used (scanned, a scanner app's, broken characters, …). */
  pdfTextUnused?: string;
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
    private readonly large: LlmClient | null,
    /** Invoice templates; absent: no template guides the reading. */
    private readonly guide?: TemplateGuideDeps,
    /**
     * The classic reading with a cheaper model (LLM_MODEL_TEMPLATE), for a trusted
     * form with something learned to go by; its reading is checked like any guided
     * one and falls back to the usual model. Null or absent: the usual model.
     */
    private readonly cheap: InvoiceExtractor | null = null
  ) {}

  /** The document's template, found before the reading (free), and its words (read only when asked; null without word OCR). */
  private async templateFor(
    upload: UploadedFile,
    organizationId: string | undefined,
    ocrText: string | null,
    rules: CountryProfile,
    /** The document's words, when already read (a PDF's own words, read before the OCR). */
    preRead: OcrPage[] | null = null
  ): Promise<{ match: TemplateMatch; words: () => Promise<OcrPage[] | null> } | null> {
    const guide = this.guide;
    if (!guide || !organizationId) return null;
    // The same page images the review page shows (the stored file), so the template's boxes fit both.
    const pages = await documentPages(upload.buffer, upload.mimetype, guide.renderer());
    if (!pages.length) return null;
    let read: Promise<OcrPage[] | null> | undefined = preRead ? Promise.resolve(preRead.slice(0, pages.length)) : undefined;
    const words = () =>
      (read ??= (async () => {
        const ocr = guide.words();
        if (!ocr) return null;
        const pdf = upload.mimetype === 'application/pdf' ? upload.buffer : null;
        return readPageWords(ocr, pages, pdf, rules.ocrLanguages).catch(() => null);
      })());
    const vendor = ocrText ? { taxIds: taxIdsInText(ocrText), keys: vendorKeysInText(ocrText).slice(0, MAX_TEXT_KEYS) } : { taxIds: [], keys: [] };
    const match = await findTemplate(guide.templates, {
      organizationId,
      aspects: pages.map((p) => p.height / p.width),
      vendor,
      words,
      look: () => pageLook(pages[0].buffer).catch(() => null)
    });
    return match ? { match, words } : null;
  }

  private findQuietly(upload: UploadedFile, options: ExtractOptions, ocrText: string | null, rules: CountryProfile, preRead: OcrPage[] | null = null): Promise<FoundTemplate | null> {
    return this.templateFor(upload, options.organizationId, ocrText, rules, preRead).catch((err: Error) => {
      console.warn(`template reading: lookup failed: ${err.message}`);
      return null;
    });
  }

  /**
   * OCR text that has every label the form always prints (the user's rules,
   * requiredLabels): when one is missing, Mistral OCR skipped part of the page
   * (a receipt read as "مازاد 45,000,000" without its "هزینه کل" line), so it is
   * asked again, up to OCR_RETRIES times; the text missing the fewest is kept.
   */
  private async completeOcrText(file: OcrFile, ocrText: string, found: FoundTemplate | null, info: TemplateReadingInfo): Promise<{ ocrText: string; missing: string[] }> {
    // The labels of the user's rules and the form guide's learned ones: printed on every invoice of the form.
    const labels = found ? [...requiredLabels(found.match.template), ...guideRequiredLabels(found.match.template.guide)] : [];
    let required = labels.filter((l, i) => labels.findIndex((o) => labelKey(o) === labelKey(l)) === i);
    let missing = required.filter((l) => !hasLabel(ocrText, l));
    // The PDF's own text is exact: a label missing from it is no longer printed (no OCR to ask again).
    if (info.textFrom === 'pdf') {
      if (missing.length) info.formChanged = missing;
      return { ocrText, missing: [] };
    }
    // Did the OCR miss it, or is it no longer printed? Word OCR (read anyway, to confirm the form) tells.
    const gone = missing.length && found ? await labelsGone(found, missing) : [];
    if (gone.length) {
      info.formChanged = gone;
      console.log(`template reading: the form no longer prints ${gone.map((l) => `"${l}"`).join(', ')} (word OCR reads the rest of it): not asked again`);
      required = required.filter((l) => !gone.includes(l));
      missing = missing.filter((l) => !gone.includes(l));
    }
    for (let i = 0; i < OCR_RETRIES && missing.length; i++) {
      const again = await retryStep(() => this.ocr.extractText(file)).catch(() => null);
      if (again === null) break;
      info.ocrRetries = i + 1;
      const still = required.filter((l) => !hasLabel(again, l));
      if (still.length < missing.length) {
        ocrText = again;
        missing = still;
      }
    }
    if (info.ocrRetries) console.log(`template reading: OCR missed ${required.length ? 'the form\'s labels' : ''}, asked ${info.ocrRetries} more time(s); still missing: ${missing.join(', ') || 'nothing'}`);
    return { ocrText, missing };
  }

  /** The reading from the page image (the vision model), with the OCR text and what it missed: when the OCR keeps skipping part of the page. */
  private async readFromImage(file: OcrFile, ocrText: string, missing: string[], rules: CountryProfile, hints = ''): Promise<ExtractionResult> {
    const vision = this.guide?.vision?.();
    const image = pageImage(file);
    if (!vision || !image) throw new Error('no vision model or page image');
    const problem = `The OCR text below missed part of the page: this form always prints ${missing.map((l) => `"${l}"`).join(', ')}, which is not in it, so values near it may be wrong or missing. Read every value, above all the amounts, from the photo.`;
    const prompt = `${invoiceRereadPrompt(ocrText, [problem], true, rules.invoice)}${hints}`;
    const structured = await retryStep(async () => parseJsonObject(await vision.complete({ ...EXTRACT_INVOICE, prompt, image })));
    const data = applyCurrencyUnits(withoutTaxLine(toInvoiceData(structured, getCalendar(rules.calendar))), rules.invoice.currencyUnits);
    return { success: true, data, raw: { provider: 'direct', data: structured, ocrText, readFromImage: missing } };
  }

  /**
   * The reading, guided by the document's template when there is one (see the
   * comment at the top): `readWith(hints)` reads, with or without the hints.
   */
  private async guidedReading(
    upload: UploadedFile,
    options: ExtractOptions,
    ocrText: string | null,
    rules: CountryProfile,
    /** `cheap`: with the cheaper model, when there is one (reading OCR text only). */
    readWith: (hints?: string, cheap?: boolean) => Promise<ExtractionResult>,
    /** The template when it was already looked for (undefined: look now). */
    preFound?: FoundTemplate | null,
    /** The reading is made from the page image (the OCR kept missing text). */
    imageReading = false
  ): Promise<{ result: ExtractionResult; match?: GuidedOutcome }> {
    const found = preFound !== undefined ? preFound : await this.findQuietly(upload, options, ocrText, rules);
    if (!found) return { result: await readWith() };
    const { match, words } = found;
    // Places on the page only when the model sees it (handwriting; the image fallback when the OCR keeps missing text).
    const hints = templateHints(match, { withImage: !!options.handwritten || imageReading });
    // Tesseract can't read handwriting: its boxes are not compared then.
    const boxWords = () => (options.handwritten ? Promise.resolve(null) : words());
    const base = { id: match.template.id, by: match.by, vendorName: match.template.vendorName };
    // The user's rules (a field chosen from its box on several invoices) win over any reading, so they are
    // applied first and the checks see the reading as it will be used. Amounts in the form's stored units.
    let pages: OcrPage[] | null = null;
    const ruledSet = new Set<string>();
    /** An amount as printed, in the stored units of the currency the reading found (Toman as Rial). */
    const storedAmountFor = (r: ExtractionResult) => {
      const printedCurrency = String((r.raw as { data?: { currency?: unknown } } | null)?.data?.currency ?? '').toUpperCase();
      const unit = rules.invoice.currencyUnits.find((u) => u.code === printedCurrency || u.aliases.includes(printedCurrency));
      return (text: string) => {
        const amount = printedAmount(text);
        return amount === null ? null : amount * (unit?.factor ?? 1);
      };
    };
    const check = (r: ExtractionResult) => checkGuidedReading(r, match, pages, { ocrText, storedAmount: storedAmountFor(r) });
    const withRules = (given: ExtractionResult) => {
      // The form's 0 charges are not lines (as on the invoices sent from it).
      const r = given.data ? { ...given, data: withoutZeroCharges(match.template.guide, given.data) } : given;
      const ruled = withRuledFields(r, match, pages, ocrText, storedAmountFor(r));
      for (const f of ruled.ruled) ruledSet.add(f);
      return ruled.result;
    };
    let outcome: GuidedOutcome;
    let result: ExtractionResult;
    if (!isTrusted(match.template)) {
      const [guided, plain, read] = await Promise.all([readWith(hints), readWith(), boxWords()]);
      pages = read;
      const [guidedRuled, plainRuled] = [withRules(guided), withRules(plain)];
      result = plainRuled;
      outcome = { ...base, outcome: 'compared', problems: check(guidedRuled), differences: differences(guidedRuled.data, plainRuled.data) };
    } else {
      // A trusted form with the user's rules or a learned guide: the cheaper model reads it (checked as always, the
      // usual model on a fall-back), unless it has usually failed this form's checks.
      const template = match.template;
      const cheap =
        !!this.cheap && !options.handwritten && !imageReading && (hasGuide(template.guide) || ruledFields(template).length > 0) && !cheapUsuallyFails(template);
      const [guided, read] = await Promise.all([readWith(hints, cheap), boxWords()]);
      pages = read;
      let guidedRuled = withRules(guided);
      let problems = check(guidedRuled);
      // Fix instead of reading again: a learned field the reading got wrong is set to what the form prints after its
      // label in this OCR text; used when every check then passes (the lines still have to add up to it).
      let fixed: string[] = [];
      if (problems.length && guidedRuled.data) {
        const repaired = withGuideFields(template.guide, guidedRuled.data as unknown as Record<string, unknown>, ocrText, storedAmountFor(guidedRuled), ruledFields(template));
        if (repaired.fixed.length) {
          const candidate = { ...guidedRuled, data: repaired.data as unknown as ExtractedInvoiceData };
          if (!check(candidate).length) {
            guidedRuled = candidate;
            fixed = repaired.fixed;
            problems = [];
          }
        }
      }
      result = problems.length ? withRules(await readWith()) : guidedRuled;
      outcome = { ...base, outcome: problems.length ? 'fell-back' : 'used', problems, ...(cheap ? { cheapModel: true } : {}), ...(fixed.length ? { fixed } : {}) };
      if (cheap) this.guide?.templates.recordCheapReading(template.id, problems.length > 0).catch(() => undefined);
    }
    if (ruledSet.size) outcome.ruled = [...ruledSet];
    console.log(
      `template reading: ${match.template.vendorName ?? match.template.id} (by ${match.by}): ${outcome.outcome}${outcome.cheapModel ? ' (cheaper model)' : ''}` +
        (outcome.problems.length ? `; problems: ${outcome.problems.join('; ')}` : '') +
        (outcome.differences ? `; differs from the plain reading in: ${outcome.differences.join(', ') || 'nothing'}` : '') +
        (outcome.ruled ? `; taken from the user's rule: ${outcome.ruled.join(', ')}` : '') +
        (outcome.fixed ? `; set to what the form prints after its label: ${outcome.fixed.join(', ')}` : '')
    );
    return { result, match: outcome };
  }

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
    const tagged = (r: ExtractionResult, part: Partial<TemplateReadingInfo> = {}) =>
      withReadDates({ ...r, raw: { ...(r.raw as object), template: { ...info, ...part } } });

    // Handwritten (countries with handwriting rules): the vision model reads the photo, OCR runs alongside to compare.
    if (options.handwritten && country.invoice.handwriting) {
      info.mode = 'handwritten';
      const guided = await this.guidedReading(upload, options, null, country, (hints) => this.classic.extract(read, { ...options, hints }));
      return tagged(guided.result, { match: guided.match });
    }

    // A PDF made from text: its own words (exact, free) instead of OCR, when they pass the checks (pdf-text.ts).
    let pdfWords: OcrPage[] | null = null;
    let ocrText: string | null = null;
    const wordOcr = upload.mimetype === 'application/pdf' ? this.guide?.words() : null;
    if (wordOcr) {
      pdfWords = await wordOcr
        .readWords({ buffer: upload.buffer, filename: upload.originalname, contentType: upload.mimetype }, { languages: country.ocrLanguages })
        .then((r) => r.pages)
        .catch(() => null);
      const own = pdfText(pdfWords, file);
      if ('text' in own) {
        ocrText = own.text;
        info.textFrom = 'pdf';
      } else info.pdfTextUnused = own.problem;
    }
    if (ocrText === null) {
      try {
        ocrText = await retryStep(() => this.ocr.extractText(file));
        info.textFrom = 'ocr';
      } catch {
        // The classic reader tries the OCR again and reports the failure the usual way.
        return tagged(await this.classic.extract(read, options));
      }
    }

    info.foreignReceipt = country.id === 'IR' && !ARABIC_SCRIPT.test(ocrText);
    const rules: CountryProfile = info.foreignReceipt ? international : country;
    const found = await this.findQuietly(upload, options, ocrText, rules, pdfWords);
    const complete = await this.completeOcrText(file, ocrText, found, info);
    ocrText = complete.ocrText;
    const fromText = (hints?: string, cheap = false) => (cheap && this.cheap ? this.cheap : this.classic).extract(read, { ...options, country: rules, ocrText, hints });
    let readWith = fromText;
    if (complete.missing.length) {
      info.ocrMissing = complete.missing;
      // Still missing after the retries: the page image is read (the text reading when that fails).
      readWith = (hints) => this.readFromImage(file, ocrText, complete.missing, rules, hints).catch(() => fromText(hints));
    }
    const guided = await this.guidedReading(upload, options, ocrText, rules, readWith, found, complete.missing.length > 0);
    const result = guided.result;
    info.match = guided.match;
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

    const vat = withVatTable(data, review.vatRows);
    data = vat.data;
    info.vatTable = vat.outcome;
    if (vat.outcome === 'disagrees') error = [error, TAX_UNCHECKED].filter(Boolean).join('. ');

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
 * A date the model wrote with words around it ("1405/07/26 (Shamsi)",
 * "Datum: 07.11.26") is lost by the strict conversion: taken from its text
 * here (template reader only; the classic one keeps its strict reading).
 */
export function withReadDates(result: ExtractionResult): ExtractionResult {
  const rescue = (data: ExtractedInvoiceData | undefined, raw: unknown) => {
    const read = (raw as { data?: Record<string, unknown> } | null)?.data;
    if (!data || !read) return data;
    const fix = (value: string | null, text: unknown) => (value === null && typeof text === 'string' ? printedDate(text) : value);
    return { ...data, invoiceDate: fix(data.invoiceDate, read.invoiceDate), dueDate: fix(data.dueDate, read.dueDate) };
  };
  return {
    ...result,
    data: rescue(result.data, result.raw),
    ...(result.more ? { more: result.more.map((part) => ({ ...part, data: rescue(part.data, part.raw)! })) } : {})
  };
}

/**
 * The tax and net amounts from the receipt's VAT table, when every row adds up
 * and the gross amounts equal the total. A table whose rows add up but not to
 * the total disagrees with the reading (a misread total or tax): warned about.
 */
export function withVatTable(data: ExtractedInvoiceData, rows: VatRow[]): { data: ExtractedInvoiceData; outcome: NonNullable<TemplateReadingInfo['vatTable']> } {
  if (!rows.length) return { data, outcome: 'none' };
  const totals = vatTotals(rows, cents(data.totalAmount));
  if (!totals) {
    const readable = rows.every((r) => r.consistent);
    const tableTax = rows.reduce((sum, r) => sum + (r.taxCents ?? 0), 0);
    return { data, outcome: readable && cents(data.taxAmount) !== tableTax ? 'disagrees' : 'none' };
  }
  if (cents(data.taxAmount) === totals.taxCents && cents(data.subtotal) === totals.netCents) return { data, outcome: 'agrees' };
  return {
    data: {
      ...data,
      taxAmount: totals.taxCents / 100,
      subtotal: totals.netCents / 100,
      // One rate: that's the rate. Several (dm: 19 % and 7 %): no single rate.
      taxRate: rows.length === 1 ? rows[0].ratePercent : null
    },
    outcome: 'used'
  };
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
