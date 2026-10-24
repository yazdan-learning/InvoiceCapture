import { OcrFile } from './gateway/ocr';

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

/** Smaller JPEGs inside a PDF are logos and thumbnails, not pages. */
const MIN_PAGE_BYTES = 20_000;
/** Enough for an invoice and its payment receipt; more pages only slow the vision model down. */
const MAX_PAGES = 4;
/** A file of several receipts: as many pages as the OCR reads. */
export const MAX_SPLIT_PAGES = 8;

/**
 * The document as data: URLs a vision model can look at: the photo itself, or
 * the photos inside a scanner-app PDF (CamScanner and the like wrap one JPEG
 * per page), in page order. Empty for a PDF made from text — its OCR is exact
 * anyway.
 */
export function pageImages(file: OcrFile, maxPages = MAX_PAGES): string[] {
  if (file.contentType.startsWith('image/')) return [`data:${file.contentType};base64,${file.buffer.toString('base64')}`];
  if (file.contentType !== 'application/pdf') return [];

  const pdf = file.buffer;
  const pages: Buffer[] = [];
  for (let at = pdf.indexOf('stream'); at >= 0; at = pdf.indexOf('stream', at + 6)) {
    const start = pdf.indexOf(JPEG_START, at);
    // The JPEG must start right after the "stream" keyword, not somewhere further on.
    if (start < 0 || start > at + 16) continue;
    const stream = pdf.subarray(start, pdf.indexOf('endstream', start));
    const jpeg = stream.subarray(0, stream.lastIndexOf(JPEG_END) + 2);
    if (jpeg.length > 2) pages.push(jpeg);
  }
  // An image repeated on several pages is the scanner app's logo, not a page.
  const unique = pages.filter((jpeg) => pages.filter((other) => other.equals(jpeg)).length === 1);
  if (unique.length) pages.splice(0, pages.length, ...unique);
  const largest = Math.max(0, ...pages.map((jpeg) => jpeg.length));
  return pages
    .filter((jpeg) => jpeg.length >= Math.min(MIN_PAGE_BYTES, largest))
    .slice(0, maxPages)
    .map((jpeg) => `data:image/jpeg;base64,${jpeg.toString('base64')}`);
}

/** The largest page: the one photo a re-read looks at. Null for a PDF made from text. */
export function pageImage(file: OcrFile): string | null {
  return pageImages(file).reduce<string | null>((best, page) => (!best || page.length > best.length ? page : best), null);
}
