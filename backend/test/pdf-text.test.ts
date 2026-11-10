import { describe, expect, it } from 'vitest';
import type { OcrPage } from '@yazdan-learning/ai';
import { pdfText } from '../src/reading/pdf-text';

const TEXT = 'Werkzeug Müller GmbH Rechnung Rechnungsnummer 2026-0412 Datum 07.11.2026 Pos Artikel Menge Einzelpreis Gesamt 1 Schraubendreher 4 12,50 50,00 2 Zange 2 19,00 38,00 Nettobetrag 88,00 MwSt 19% 16,72 Gesamtbetrag 104,72 EUR';
const page = (text: string, source: OcrPage['source'] = 'text-layer'): OcrPage => ({ index: 0, width: 595, height: 842, source, text, words: [] });
const pdf = (body = '%PDF-1.4 text only') => ({ buffer: Buffer.from(body), filename: 'f.pdf', contentType: 'application/pdf' });

describe('pdfText', () => {
  it("uses a text PDF's own words", () => {
    expect(pdfText([page(TEXT)], pdf())).toEqual({ text: TEXT });
  });

  it('does not use a page without text, a photo, or a PDF with too little text', () => {
    expect(pdfText([page(TEXT), page('', 'ocr')], pdf())).toEqual({ problem: 'a page without text (scanned)' });
    expect(pdfText([page(TEXT)], { ...pdf(), contentType: 'image/jpeg' })).toEqual({ problem: 'not a PDF' });
    expect(pdfText([page('Scanned with CamScanner 1')], pdf())).toEqual({ problem: 'too little text' });
    expect(pdfText(null, pdf())).toEqual({ problem: 'no words read from it' });
  });

  it("does not use a scanner app's PDF: its text is the app's OCR over the photo", () => {
    const jpeg = Buffer.concat([Buffer.from('stream\r\n'), Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(60_000, 1), Buffer.from([0xff, 0xd9]), Buffer.from('endstream')]);
    const scanned = { ...pdf(), buffer: Buffer.concat([Buffer.from('%PDF-1.4 /Subtype /Image /Filter /DCTDecode '), jpeg]) };
    expect(pdfText([page(TEXT)], scanned)).toEqual({ problem: "a scanner app's PDF (its text is the app's OCR)" });
  });

  it('does not use broken characters', () => {
    expect(pdfText([page(`${TEXT} �`)], pdf())).toEqual({ problem: 'characters the font has no Unicode for' });
    expect(pdfText([page(`${TEXT} (cid:42)`)], pdf())).toEqual({ problem: 'characters the font has no Unicode for' });
  });

  it('does not use Persian or Arabic text: pdftotext mixes up its order', () => {
    const persian = '1405/08/12 تاریخ: | 5521 فاکتور: شماره ردیف تعداد شرح کاال مبلغ واحد (ریال) مبلغ کل (ریال) 1 پیچ گوشتی 4 1,250,000 5,000,000 جمع کل: 15,300,000 ریال';
    expect(pdfText([page(persian)], pdf())).toEqual({ problem: 'right-to-left text (its order comes out mixed)' });
  });
});
