import { ExtractedInvoiceData } from '../expenses/ports';

// Sanity checks on a read receipt. The model happily returns a well-formed
// answer for a photo it misread: a receipt photographed curved or at an angle
// puts the price column a row off the names, and every price lands on the
// wrong item. The printed numbers then stop adding up — that's what's checked.

export type InvoiceProblem = {
  code: 'total_mismatch' | 'summary_line';
  /** For the model when re-reading: may quote the receipt, so never logged. */
  message: string;
  /** For logs: amounts and positions only. */
  detail: Record<string, number>;
};

export type InvoiceCheck = {
  /** Reasons not to trust the reading. */
  problems: InvoiceProblem[];
  /** Logged only: odd but harmless, or can't be checked. */
  warnings: string[];
};

/** Rounding slack: weight lines (0,624 kg x 1,69) are printed rounded. */
const TOLERANCE_CENTS = 2;

// "Summe", "Zwischensumme", "Total", "Gesamt", payment and change lines (and
// the Persian جمع کل, تخفیف, مالیات, قابل پرداخت): the receipt's footer, never
// something bought.
const SUMMARY_LINE = /^\s*(zwischen)?summe\b|^\s*(sub)?total\b|^\s*gesamt(betrag|summe)?\b|^\s*(karten|bar)zahlung\b|^\s*(r[uü]ck|wechsel)geld\b|^\s*gegeben\b|^\s*(mwst|ust)\b|^\s*(جمع|تخفیف|مالیات|عوارض|ارزش افزوده|مبلغ (قابل )?پرداخت|مبلغ کل به ?حروف)/i;

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

const cents = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null);
const euros = (c: number) => (c / 100).toFixed(2);

function lineCents(line: ExtractedInvoiceData['items'][number]): number | null {
  const total = cents(line.totalPrice);
  if (total !== null) return total;
  const unit = cents(line.unitPrice);
  return unit !== null ? Math.round(unit * (line.quantity ?? 1)) : null;
}

/**
 * Item prices include VAT on most receipts (lines = total); Persian invoices
 * list net prices with the discount and VAT applied below them.
 */
function totalMatches(lines: number, paid: number, discount: number, tax: number): boolean {
  return [lines, lines - discount, lines + tax, lines - discount + tax].some((sum) => Math.abs(sum - paid) <= TOLERANCE_CENTS);
}

export function checkInvoice(data: ExtractedInvoiceData): InvoiceCheck {
  const problems: InvoiceProblem[] = [];
  const warnings: string[] = [];

  data.items.forEach((line, index) => {
    if (SUMMARY_LINE.test(line.description)) {
      problems.push({
        code: 'summary_line',
        message: `"${line.description}" is a total/payment line of the receipt, not an item.`,
        detail: { line: index }
      });
    }
    const unit = cents(line.unitPrice);
    const total = cents(line.totalPrice);
    if (line.quantity !== null && unit !== null && total !== null && Math.abs(Math.round(line.quantity * unit) - total) > TOLERANCE_CENTS) {
      warnings.push(`line ${index}: quantity x unitPrice != totalPrice`);
    }
  });

  const paid = cents(data.totalAmount);
  const sum = data.items.reduce((s, line) => s + (lineCents(line) ?? 0), 0);
  if (paid === null) {
    warnings.push('no total on the receipt: line sum not checked');
  } else if (!totalMatches(sum, paid, cents(data.discount) ?? 0, cents(data.taxAmount) ?? 0)) {
    problems.push({
      code: 'total_mismatch',
      message: `The items add up to ${euros(sum)} but the receipt's total is ${euros(paid)}.`,
      detail: { linesCents: sum, totalCents: paid, diffCents: sum - paid }
    });
  }
  if (data.items.some((line) => lineCents(line) === null)) warnings.push('a line without a price');

  return { problems, warnings };
}
