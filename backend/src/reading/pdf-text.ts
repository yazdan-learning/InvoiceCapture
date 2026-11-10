import type { OcrPage } from '@yazdan-learning/ai';
import type { OcrFile } from '../ai/gateway/ocr';
import { pageImages } from '../ai/page-image';

// A PDF made from text (an accounting program's export) holds its own words:
// read from it (pdftotext, through the Tesseract service), they are exact and
// free, so the template reader uses them instead of Mistral OCR — when they
// pass the checks below. Otherwise Mistral OCR reads the page, as for a photo.
// Not used: a scanner app's PDF (CamScanner puts its own OCR text over the
// photo — OCR, often worse than Mistral's), a page without text (read by OCR
// in the service), text whose characters came out broken (fonts without a
// character map give replacement marks or private-use codes), and right-to-left
// text: pdftotext puts a Persian line's parts in the wrong order ("شماره فاکتور:
// 5521 | تاریخ: 1405/08/12" came out "1405/08/12 تاریخ: | 5521 فاکتور: شماره",
// "کالا" as "کاال", table cells one per line), where Mistral OCR reads it right.

/** Words a document's text needs to be the invoice (not a stray caption over a scan). */
const MIN_WORDS = 20;
/** Persian/Arabic words, as a share of all words, from which the text is right-to-left. */
const RIGHT_TO_LEFT = 0.2;

const ARABIC_WORD = /[؀-ۿ]/;
/** U+FFFD, the private-use area and "(cid:12)": characters the PDF's font has no Unicode for. */
const BROKEN = /\uFFFD|[\uE000-\uF8FF]|\(cid:\d+\)/;

export type PdfText = { text: string } | { problem: string };

/** The PDF's own text when it can be used instead of OCR, else why not. `pages`: its words from the Tesseract service. */
export function pdfText(pages: OcrPage[] | null, file: OcrFile): PdfText {
  if (file.contentType !== 'application/pdf') return { problem: 'not a PDF' };
  if (!pages?.length) return { problem: 'no words read from it' };
  if (pages.some((p) => p.source !== 'text-layer')) return { problem: 'a page without text (scanned)' };
  if (pageImages(file).length) return { problem: "a scanner app's PDF (its text is the app's OCR)" };
  const text = pages.map((p) => p.text).join('\n\n').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return { problem: 'too little text' };
  if (!/\d/.test(text)) return { problem: 'no digits' };
  if (BROKEN.test(text)) return { problem: 'characters the font has no Unicode for' };
  if (words.filter((w) => ARABIC_WORD.test(w)).length / words.length > RIGHT_TO_LEFT) return { problem: 'right-to-left text (its order comes out mixed)' };
  return { text };
}
