import type { PdfRenderer } from '@yazdan-learning/ai';
import sharp from 'sharp';
import { MAX_SPLIT_PAGES, pageImages } from '../ai/page-image';

// The document's pages as the one set of images that the review page shows,
// the vision model locates fields on, and regions are cropped from. They must
// be the same pixels: a box found on an unrotated photo would sit in the
// wrong place on the rotated one the browser shows.

export type PageImage = {
  buffer: Buffer;
  width: number;
  height: number;
  /** For a scanned PDF page: its pixels per inch across the paper's width (below ~150, small print is hard to read). */
  dpi?: number;
  /** Drawn from a PDF made from text: its words and their places are in the PDF itself. */
  rendered?: boolean;
};

/** Text PDFs are drawn at this resolution: small print stays readable when zoomed, and receipts are narrow paper. */
export const RENDER_DPI = 200;

/** Images narrower than this on their short side aren't pages (banners, logos): no dpi. */
const MIN_MEASURED_SIDE = 200;

/** Larger than A3 (11.7 x 16.5 in) is not paper: tools that make a PDF from a photo give the page its pixel size in points. */
const MAX_PAPER_INCHES = 17;

/** The first page's paper size in inches, from the PDF's MediaBox (points, 72 to the inch); null when not found or not a real paper size. */
export function pdfPaperInches(pdf: Buffer): { width: number; height: number } | null {
  const box = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  if (!box) return null;
  const width = Math.abs(Number(box[3]) - Number(box[1])) / 72;
  const height = Math.abs(Number(box[4]) - Number(box[2])) / 72;
  return width > 0 && height > 0 && Math.max(width, height) <= MAX_PAPER_INCHES ? { width, height } : null;
}

/** A scan fitted onto the paper: its pixels per inch along the side that fills it. */
export const scanDpi = (pixels: { width: number; height: number }, paper: { width: number; height: number }) =>
  Math.round(Math.max(pixels.width / paper.width, pixels.height / paper.height));

/** Large enough to read handwritten digits, small enough for a quick upload to the vision model. */
const MAX_SIDE = 2000;

/**
 * The photo itself, or the photos inside a scanner-app PDF, each turned
 * upright (EXIF orientation) and scaled down to MAX_SIDE, as JPEG. A PDF
 * without photos inside (made from text) is drawn page by page by the
 * renderer; without one it has no page images.
 */
export async function documentPages(buffer: Buffer, mimeType: string, renderer?: PdfRenderer | null): Promise<PageImage[]> {
  const sources = pageImages({ buffer, filename: 'document', contentType: mimeType }, MAX_SPLIT_PAGES).map((dataUrl) =>
    Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  );
  const pages: PageImage[] = [];
  const paper = mimeType === 'application/pdf' ? pdfPaperInches(buffer) : null;
  for (const source of sources) {
    const { data, info } = await sharp(source)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    // The scan's own pixels, before scaling down to MAX_SIDE.
    const original = paper ? await sharp(source).metadata() : null;
    // A strip (a scanner app's banner, 895 x 101) isn't a page: not measured.
    const pageLike = original?.width && original.height && Math.min(original.width, original.height) >= MIN_MEASURED_SIDE;
    const dpi = paper && pageLike ? scanDpi({ width: original.width!, height: original.height! }, paper) : undefined;
    pages.push({ buffer: data, width: info.width, height: info.height, ...(dpi ? { dpi } : {}) });
  }
  if (!pages.length && mimeType === 'application/pdf' && renderer) {
    for (const page of (await renderer.renderPdf(buffer, { dpi: RENDER_DPI })).slice(0, MAX_SPLIT_PAGES)) {
      const { data, info } = await sharp(page.buffer)
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      pages.push({ buffer: data, width: info.width, height: info.height, rendered: true });
    }
  }
  return pages;
}

export type Region = { x: number; y: number; width: number; height: number };

/** A small region is enlarged so its short side has at least this many pixels: models read tiny digits badly. */
const MIN_CROP_SIDE = 384;
/** …but no side longer than this (a wide, thin line would otherwise become a huge image). */
const MAX_CROP_SIDE = 2048;
const PADDING = 0.08;

/** The region (0–1 fractions of the page) with a little padding around it, enlarged when small, as JPEG. */
export async function cropRegion(page: PageImage, region: Region): Promise<Buffer> {
  const padX = region.width * PADDING;
  const padY = region.height * PADDING;
  const left = Math.max(0, Math.floor((region.x - padX) * page.width));
  const top = Math.max(0, Math.floor((region.y - padY) * page.height));
  const right = Math.min(page.width, Math.ceil((region.x + region.width + padX) * page.width));
  const bottom = Math.min(page.height, Math.ceil((region.y + region.height + padY) * page.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const scale = Math.max(1, Math.min(MIN_CROP_SIDE / Math.min(width, height), MAX_CROP_SIDE / Math.max(width, height)));
  return sharp(page.buffer)
    .extract({ left, top, width, height })
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Text in an OCR crop is at least this tall (px)… */
const OCR_MIN_HEIGHT = 120;
/** …enlarged at most this much, and no wider than OCR_MAX_WIDTH. */
const OCR_MAX_SCALE = 4;
const OCR_MAX_WIDTH = 4000;

/**
 * The region with a margin around it, enlarged for word OCR ("read from box"
 * on an invoice whose page words are not at hand), and where that crop sits on
 * the page (fractions), to map the words back.
 */
export async function cropForOcr(page: PageImage, region: Region): Promise<{ buffer: Buffer; frame: Region }> {
  const margin = (v: number) => Math.max(0.01, v * 0.15);
  const x = Math.max(0, region.x - margin(region.width));
  const y = Math.max(0, region.y - margin(region.height));
  const right = Math.min(1, region.x + region.width + margin(region.width));
  const bottom = Math.min(1, region.y + region.height + margin(region.height));
  const left = Math.floor(x * page.width);
  const top = Math.floor(y * page.height);
  const width = Math.max(1, Math.ceil(right * page.width) - left);
  const height = Math.max(1, Math.ceil(bottom * page.height) - top);
  const scale = Math.max(1, Math.min(OCR_MAX_SCALE, OCR_MIN_HEIGHT / height, OCR_MAX_WIDTH / width));
  const buffer = await sharp(page.buffer)
    .extract({ left, top, width, height })
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer, frame: { x: left / page.width, y: top / page.height, width: width / page.width, height: height / page.height } };
}

/**
 * The region framed in red with some of the page around it, enlarged: enough
 * to read the framed value and see its label ("نام مشتری:" next to a name),
 * at a fraction of the whole page's size.
 */
export async function regionInContext(page: PageImage, region: Region): Promise<Buffer> {
  const marginX = Math.max(region.width, 0.15);
  const marginY = Math.max(region.height * 2, 0.04);
  const left = Math.max(0, Math.floor((region.x - marginX) * page.width));
  const top = Math.max(0, Math.floor((region.y - marginY) * page.height));
  const right = Math.min(page.width, Math.ceil((region.x + region.width + marginX) * page.width));
  const bottom = Math.min(page.height, Math.ceil((region.y + region.height + marginY) * page.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const stroke = Math.max(2, Math.round(Math.min(width, height) / 150));
  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${region.x * page.width - left}" y="${
      region.y * page.height - top
    }" width="${region.width * page.width}" height="${region.height * page.height}" fill="none" stroke="#ff0000" stroke-width="${stroke}"/></svg>`
  );
  const scale = Math.max(1, Math.min(MIN_CROP_SIDE / Math.min(width, height), MAX_CROP_SIDE / Math.max(width, height)));
  const framed = await sharp(page.buffer).extract({ left, top, width, height }).composite([{ input: frame }]).toBuffer();
  return sharp(framed)
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** The page with the region framed in red: the vision model reads it in the context of the whole page. */
export async function markRegion(page: PageImage, region: Region): Promise<Buffer> {
  const stroke = Math.max(3, Math.round(Math.min(page.width, page.height) / 300));
  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"><rect x="${region.x * page.width}" y="${
      region.y * page.height
    }" width="${region.width * page.width}" height="${region.height * page.height}" fill="none" stroke="#ff0000" stroke-width="${stroke}"/></svg>`
  );
  return sharp(page.buffer).composite([{ input: frame }]).jpeg({ quality: 85 }).toBuffer();
}

export const jpegDataUrl = (buffer: Buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`;
