import { OcrFile } from './gateway/ocr';

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

/**
 * The document as a data: URL a vision model can look at: the photo itself,
 * or the photo inside a scanner-app PDF (CamScanner and the like wrap one JPEG
 * per page; the largest is taken). Null for a PDF made from text — its OCR is
 * exact anyway.
 */
export function pageImage(file: OcrFile): string | null {
  if (file.contentType.startsWith('image/')) return `data:${file.contentType};base64,${file.buffer.toString('base64')}`;
  if (file.contentType !== 'application/pdf') return null;

  const pdf = file.buffer;
  let best: Buffer | null = null;
  for (let at = pdf.indexOf('stream'); at >= 0; at = pdf.indexOf('stream', at + 6)) {
    const start = pdf.indexOf(JPEG_START, at);
    // The JPEG must start right after the "stream" keyword, not somewhere further on.
    if (start < 0 || start > at + 16) continue;
    const stream = pdf.subarray(start, pdf.indexOf('endstream', start));
    const jpeg = stream.subarray(0, stream.lastIndexOf(JPEG_END) + 2);
    if (jpeg.length > 2 && (!best || jpeg.length > best.length)) best = jpeg;
  }
  return best ? `data:image/jpeg;base64,${best.toString('base64')}` : null;
}
