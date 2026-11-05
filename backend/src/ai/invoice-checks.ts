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

// The shared footer words ("Summe", "Total", "Gesamt", payment and change
// lines) plus the Persian جمع کل, تخفیف, مالیات, قابل پرداخت: never something bought.
export const SUMMARY_LINE = new RegExp(
  `${SHARED_SUMMARY_LINE.source}|^\\s*(جمع|تخفیف|مالیات|عوارض|ارزش افزوده|مبلغ (قابل )?پرداخت|مبلغ کل به ?حروف)`,
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
  return checkReading(data, { summaryLine: SUMMARY_LINE, totalMatches: linesWithDiscountOrTax });
}
