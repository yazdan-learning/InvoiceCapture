import {
  cents,
  checkReading,
  lineCents,
  linesWithDiscountOrTax,
  ReadingCheck,
  ReadingProblem,
  SUMMARY_LINE as SHARED_SUMMARY_LINE,
  TOLERANCE_CENTS
} from '@yazdan-learning/ai';
import { ExtractedInvoiceData } from '../expenses/ports';

// Sanity checks on a read receipt, from @yazdan-learning/ai (shared with
// Nestmate). The model happily returns a well-formed answer for a photo it
// misread: a receipt photographed curved or at an angle puts the price column
// a row off the names, and every price lands on the wrong item. The printed
// numbers then stop adding up — that's what's checked. Invoices here may list
// net prices with the discount and VAT applied below them (Persian invoices),
// so any of lines, lines − discount, lines + VAT, lines − discount + VAT may be the total.

export type InvoiceProblem = ReadingProblem;
export type InvoiceCheck = ReadingCheck;

const PERSIAN_SUMMARY = '^\\s*(جمع|تخفیف|مالیات|عوارض|ارزش افزوده|مبلغ (قابل )?پرداخت|مبلغ کل به ?حروف)';

// TEMPLATE: the shared footer words (totals, payment, change and VAT lines in
// the common European languages) plus the Persian جمع کل, تخفیف, مالیات, قابل پرداخت: never something bought.
export const SUMMARY_LINE = new RegExp(`${SHARED_SUMMARY_LINE.source}|${PERSIAN_SUMMARY}`, 'i');

// CLASSIC keeps the German and English words it was built with (its behaviour stays as it is).
const CLASSIC_SUMMARY_LINE = new RegExp(
  `^\\s*(zwischen)?summe\\b|^\\s*(sub)?total\\b|^\\s*gesamt(betrag|summe)?\\b|^\\s*(karten|bar)zahlung\\b|^\\s*(r[uü]ck|wechsel)geld\\b|^\\s*gegeben\\b|^\\s*(mwst|ust)\\b|${PERSIAN_SUMMARY}`,
  'i'
);

const TAX_LINE = /^\s*(mwst|ust|vat|tax\b|مالیات|عوارض|ارزش افزوده)/i;

/**
 * Some receipts (a courier's list of charges) print VAT among the charges, and
 * the model lists it as an item although it is also the taxAmount: that line
 * is dropped, so the lines plus tax add up to the total again.
 */
export function withoutTaxLine(data: ExtractedInvoiceData): ExtractedInvoiceData {
  const tax = cents(data.taxAmount);
  if (!tax) return data;
  const taxLines = data.items.filter((line) => TAX_LINE.test(line.description) && Math.abs((lineCents(line) ?? 0) - tax) <= TOLERANCE_CENTS);
  return taxLines.length === 1 ? { ...data, items: data.items.filter((line) => line !== taxLines[0]) } : data;
}

export function checkInvoice(data: ExtractedInvoiceData): InvoiceCheck {
  return checkReading(data, { summaryLine: CLASSIC_SUMMARY_LINE, totalMatches: linesWithDiscountOrTax });
}
