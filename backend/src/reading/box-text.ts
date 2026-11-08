import type { OcrPage, OcrWord } from '@yazdan-learning/ai';
import { getCalendar } from '../countries/calendars';
import { westernDigits } from '../ai/replies';
import { Region } from './page-images';
import { amountCents } from './word-boxes';

// "Read from box": the value of a box the user drew, taken from the words the
// page already has (Tesseract, or a text PDF's own words), with no model.

/** A word counts as inside when its centre is, with this much slack for a frame drawn tight on the text. */
const SLACK = 0.003;

const ARABIC_LETTER = /[؀-ۿﭐ-﷿ﹰ-﻿]/;

/** The words whose centre lies in the region. */
export function wordsInRegion(page: OcrPage, region: Region): OcrWord[] {
  return page.words.filter((w) => {
    const cx = w.box.x + w.box.width / 2;
    const cy = w.box.y + w.box.height / 2;
    return cx >= region.x - SLACK && cx <= region.x + region.width + SLACK && cy >= region.y - SLACK && cy <= region.y + region.height + SLACK;
  });
}

/** The words as text: lines top to bottom, each left to right, or right to left when it is mostly Persian/Arabic. */
export function regionText(words: OcrWord[]): string {
  const lines = new Map<number, OcrWord[]>();
  for (const w of words) (lines.get(w.line) ?? lines.set(w.line, []).get(w.line)!).push(w);
  return [...lines.values()]
    .sort((a, b) => Math.min(...a.map((w) => w.box.y)) - Math.min(...b.map((w) => w.box.y)))
    .map((line) => {
      const rtl = line.filter((w) => ARABIC_LETTER.test(w.text)).length * 2 > line.length;
      return [...line].sort((a, b) => (rtl ? b.box.x - a.box.x : a.box.x - b.box.x)).map((w) => w.text).join(' ');
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The amount in printed text ("Summe 16,72", "-0,40", "۲٬۳۹۰٬۰۰۰"): the last one when there are several (a total follows its label). */
export function printedAmount(text: string): number | null {
  const tokens = westernDigits(text).split(/\s+/).filter((t) => /\d/.test(t));
  for (let i = tokens.length - 1; i >= 0; i--) {
    const cents = amountCents(tokens[i]);
    if (cents === null) continue;
    const negative = /^[-−–]|[-−–]$/.test(tokens[i].replace(/[^\d.,٬٫\-−–]/g, ''));
    return ((negative ? -1 : 1) * cents) / 100;
  }
  return null;
}

const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 0;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The first date in printed text as "YYYY-MM-DD" (Gregorian): year first
 * ("2026-11-07", Shamsi "1405/07/28"), or day first as printed in Europe and
 * Turkey ("07.11.26", "07/11/2026").
 */
export function printedDate(text: string): string | null {
  const s = westernDigits(text);
  for (const m of s.matchAll(/(\d{1,4})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{1,4})/g)) {
    const [a, b, c] = [m[1], m[2], m[3]];
    if (a.length === 4) {
      const [y, mo, d] = [Number(a), Number(b), Number(c)];
      if (!validDay(y, mo, d)) continue;
      // A Shamsi year is around 1400; the Persian calendar converts it.
      if (y < 1700) return getCalendar('persian').toIsoDate(`${y}/${pad(mo)}/${pad(d)}`);
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
    if (c.length === 2 || c.length === 4) {
      const y = c.length === 2 ? 2000 + Number(c) : Number(c);
      const [mo, d] = [Number(b), Number(a)];
      if (!validDay(y, mo, d)) continue;
      if (y < 1700) return getCalendar('persian').toIsoDate(`${y}/${pad(mo)}/${pad(d)}`);
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  return null;
}
