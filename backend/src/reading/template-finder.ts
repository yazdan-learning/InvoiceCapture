import { enlargeSmallImage, type OcrPage, type PositionedOcrClient } from '@yazdan-learning/ai';
import type { PageImage } from './page-images';
import { compareLooks, IDENTITY, matchWords, PageLook, readableWords, Transform } from './template-match';
import { bestTemplate, distrusted, fitsPages, sameLayout, StoredTemplate, TemplateMatchKind } from './templates';
import type { TemplateKeys, TemplatesRepository } from './templates.repository';

// Finding the template for a document, free, in this order:
// 1. its vendor's, by tax ID or name — as the reading has them (review page), or
//    every tax ID and name the OCR text could hold (upload, before the reading);
//    skipped when its printed words are missing from a page that has plenty
//    (another of the vendor's forms);
// 2. by the form's printed words (the name misread, a vendor new here);
// 3. by the first page's look (handwritten or blurry: few words to go by).
// 2 and 3 need a clear winner and skip templates whose boxes usually had to
// be moved. Only templates whose pages have the document's shape. Used on
// upload (the reading is guided by it) and on the review page (its boxes).

/** A template is found by the form when at least this share of its printed words sit where one alignment puts them … */
export const WORDS_MATCH = 0.4;
/** … and at least this many. */
const WORDS_MATCHED_MIN = 6;
/** A template needs this many printed words to be found by them. */
export const WORDS_TEMPLATE_MIN = 8;
/** A vendor's template with this few of its words on a page that has plenty (READABLE_PAGE) is another of the vendor's forms. */
export const WORDS_OTHER_FORM = 0.15;
export const READABLE_PAGE = 30;
/** Pages that look this alike (compareLooks) are the same form; other forms seldom pass 0.6. */
const LOOK_MATCH = 0.7;
/** The winner must beat a template of another layout by this much: two forms about as alike are no answer. */
const WORDS_MARGIN = 0.1;
const LOOK_MARGIN = 0.05;

/** A template found for a document: how, and where each page of it sits on this scan. */
export type TemplateMatch = { template: StoredTemplate; by: TemplateMatchKind; transforms: Transform[] };

/** What finding needs of the document; words and look are asked for only when needed (word OCR takes a second or two). */
export type FindInput = {
  organizationId: string;
  /** Height ÷ width of each page. */
  aspects: number[];
  /** The vendor keys to look up: from the reading (one of each) or from the OCR text (every candidate). */
  vendor: TemplateKeys;
  /** The reading's own keys, when there is a reading: they rank the vendor's templates. */
  read?: { taxId: string | null; key: string | null };
  words: () => Promise<OcrPage[] | null>;
  look: () => Promise<PageLook | null>;
};

/** The best-scored candidate, unless one of another layout scores about as well (then none). */
function clearWinner<T extends { template: StoredTemplate; score: number }>(scored: T[], min: number, margin: number): T | null {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const [best] = sorted;
  if (!best || best.score < min) return null;
  const rival = sorted.find((c) => c !== best && !sameLayout(c.template, best.template));
  return rival && rival.score > best.score - margin ? null : best;
}

/** Where a template's pages sit on this scan: from its printed words when enough are found, else from the page's look, else as they are. */
export async function alignTemplate(template: StoredTemplate, read: OcrPage[] | null, look: PageLook | null): Promise<Transform[]> {
  const byWords = read && template.words.length ? matchWords(template.words, read) : null;
  if (byWords && byWords.matched >= 3) return byWords.transforms;
  if (look && template.look) {
    const compared = compareLooks(template.look, look);
    if (compared.score >= LOOK_MATCH) return [compared.transform];
  }
  return [IDENTITY];
}

/** The same vendor: by tax ID when both have one, else by name. */
const vendorOf = (t: StoredTemplate) => t.vendorTaxId ?? t.vendorKey ?? t.id;

export async function findTemplate(templates: TemplatesRepository, input: FindInput): Promise<TemplateMatch | null> {
  const { organizationId, aspects } = input;
  if (!aspects.length) return null;
  let words: OcrPage[] | null | undefined;
  const pageWords = async () => (words === undefined ? (words = await input.words()) : words);
  let look: PageLook | null | undefined;
  const pageLook = async () => (look === undefined ? (look = await input.look()) : look);
  const done = async (template: StoredTemplate, by: TemplateMatchKind): Promise<TemplateMatch> => ({
    template,
    by,
    transforms: await alignTemplate(template, words ?? null, await pageLook())
  });

  // 1. The vendor's.
  const ofVendor = (await templates.findCandidates(organizationId, input.vendor)).filter((t) => fitsPages(t, aspects));
  if (ofVendor.length) {
    // Words are read only when they can decide something: the vendor's forms with words, or several vendors in the text.
    const vendors = new Set(ofVendor.map(vendorOf));
    const needWords = vendors.size > 1 || ofVendor.some((t) => t.words.length >= WORDS_TEMPLATE_MIN);
    const read = needWords ? await pageWords() : null;
    const readable = read ? readableWords(read) : 0;
    const scored = ofVendor
      .map((template) => ({ template, words: read && template.words.length ? matchWords(template.words, read) : null }))
      .filter(({ template, words }) => !(words && template.words.length >= WORDS_TEMPLATE_MIN && readable >= READABLE_PAGE && words.score < WORDS_OTHER_FORM));
    if (scored.length && new Set(scored.map((c) => vendorOf(c.template))).size === 1) {
      // One vendor; several of its forms: the one whose words are on the page, else the usual order.
      const byForm = scored.filter((c) => c.words && c.words.score >= WORDS_MATCH).sort((a, b) => b.words!.score - a.words!.score)[0];
      const keys = input.read ?? { taxId: scored[0].template.vendorTaxId, key: scored[0].template.vendorKey };
      return done(byForm?.template ?? bestTemplate(scored.map((c) => c.template), organizationId, keys)!, 'vendor');
    }
    if (scored.length) {
      // Several vendors in the text (the customer is a vendor here too): the form tells which one this is.
      const byWords = clearWinner(
        scored.filter((c) => c.words).map((c) => ({ template: c.template, score: c.words!.score })),
        WORDS_MATCH,
        WORDS_MARGIN
      );
      if (byWords) return done(byWords.template, 'vendor');
      const now = await pageLook();
      const byLook = now
        ? clearWinner(
            scored.filter((c) => c.template.look).map((c) => ({ template: c.template, score: compareLooks(c.template.look!, now).score })),
            LOOK_MATCH,
            LOOK_MARGIN
          )
        : null;
      if (byLook) return done(byLook.template, 'vendor');
    }
  }

  // 2–3. By the form.
  const ofForm = (await templates.findByShape(organizationId, aspects[0])).filter((t) => fitsPages(t, aspects) && !distrusted(t));
  if (!ofForm.length) return null;
  const read = ofForm.some((t) => t.words.length >= WORDS_TEMPLATE_MIN) ? await pageWords() : null;
  if (read) {
    const scored = ofForm
      .filter((t) => t.words.length >= WORDS_TEMPLATE_MIN)
      .map((template) => ({ template, ...matchWords(template.words, read) }))
      .filter((c) => c.matched >= WORDS_MATCHED_MIN);
    const best = clearWinner(scored, WORDS_MATCH, WORDS_MARGIN);
    if (best) return { template: best.template, by: 'words', transforms: best.transforms };
  }
  const now = await pageLook();
  if (!now) return null;
  const scored = ofForm.filter((t) => t.look).map((template) => ({ template, ...compareLooks(template.look!, now) }));
  const best = clearWinner(scored, LOOK_MATCH, LOOK_MARGIN);
  return best ? { template: best.template, by: 'look', transforms: [best.transform] } : null;
}

/**
 * Each page image's words with their boxes (the Tesseract service): a PDF made
 * from text gives its own words, exact (`pdf`: the file); other pages are
 * read from the page image itself, so the boxes fit what the review page
 * shows (small ones enlarged; boxes are fractions).
 */
export async function readPageWords(ocr: PositionedOcrClient, pages: PageImage[], pdf: Buffer | null, languages: string): Promise<OcrPage[]> {
  if (pages.length && pages.every((p) => p.rendered) && pdf) {
    return (await ocr.readWords({ buffer: pdf, filename: 'document.pdf', contentType: 'application/pdf' }, { languages })).pages.slice(0, pages.length);
  }
  const read: OcrPage[] = [];
  for (const [index, page] of pages.entries()) {
    const file = await enlargeSmallImage({ buffer: page.buffer, filename: `page-${index}.jpg`, contentType: 'image/jpeg' });
    const [first] = (await ocr.readWords(file, { languages })).pages;
    read.push(first ?? { index, width: page.width, height: page.height, source: 'ocr', text: '', words: [] });
  }
  return read;
}
