import sharp from 'sharp';
import { MAX_SPLIT_PAGES, pageImages } from '../ai/page-image';

// The document's pages as the one set of images that the review page shows,
// the vision model locates fields on, and regions are cropped from. They must
// be the same pixels: a box found on an unrotated photo would sit in the
// wrong place on the rotated one the browser shows.

export type PageImage = { buffer: Buffer; width: number; height: number };

/** Large enough to read handwritten digits, small enough for a quick upload to the vision model. */
const MAX_SIDE = 2000;

/**
 * The photo itself, or the photos inside a scanner-app PDF, each turned
 * upright (EXIF orientation) and scaled down to MAX_SIDE, as JPEG. Empty for
 * a PDF made from text (no page images to draw on yet).
 */
export async function documentPages(buffer: Buffer, mimeType: string): Promise<PageImage[]> {
  const sources = pageImages({ buffer, filename: 'document', contentType: mimeType }, MAX_SPLIT_PAGES).map((dataUrl) =>
    Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  );
  const pages: PageImage[] = [];
  for (const source of sources) {
    const { data, info } = await sharp(source)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    pages.push({ buffer: data, width: info.width, height: info.height });
  }
  return pages;
}

export type Region = { x: number; y: number; width: number; height: number };

/** A small region is enlarged so its short side has at least this many pixels: models read tiny digits badly. */
const MIN_CROP_SIDE = 384;
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
  const scale = Math.max(1, MIN_CROP_SIDE / Math.min(width, height));
  return sharp(page.buffer)
    .extract({ left, top, width, height })
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
