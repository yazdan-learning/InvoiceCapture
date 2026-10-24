import { describe, expect, it } from 'vitest';
import { pageImages } from '../src/ai/page-image';

const jpeg = (fill: number, size: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(size, fill), Buffer.from([0xff, 0xd9])]);
const pdf = (...images: Buffer[]) =>
  Buffer.concat(images.flatMap((image) => [Buffer.from('obj stream\n'), image, Buffer.from('\nendstream\n')]));

describe('pageImages', () => {
  it('returns every page photo of a scanner-app PDF in order, without the logo repeated on each page', () => {
    const logo = jpeg(1, 30_000);
    const pages = pageImages({ buffer: pdf(logo, jpeg(2, 50_000), logo, jpeg(3, 40_000)), filename: 'scan.pdf', contentType: 'application/pdf' }, 8);
    expect(pages.map((page) => Buffer.from(page.split(',')[1], 'base64')[4])).toEqual([2, 3]);
  });
});
