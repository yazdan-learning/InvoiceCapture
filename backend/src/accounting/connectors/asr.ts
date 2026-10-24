import { AccountingConnector, AccountingInvoice, SentInvoice } from '../ports';

// ASR's partner API (POST /api/partner/manual-invoice): the invoice is created
// there as a Draft in Rial, and ASR staff confirm it. ASR doesn't recalculate
// anything: subTotal must be the sum of the line totals and total must be
// subTotal − discount, so the amounts sent here are checked against the
// invoice first. There is no tax field: VAT is sent as a line of its own.
// ASR has no duplicate check either: every successful call is a new invoice.

export type AsrConfig = { baseUrl: string; apiKey: string; timeoutMs: number };

type AsrLine = { rowNumber: number; itemDesc: string; unitPrice: number; measure: number; total: number };

export type AsrManualInvoice = {
  creditorName: string;
  title: string;
  invoiceDescription?: string;
  invoiceDate: string;
  subTotal: number;
  discount: number;
  total: number;
  manualInvoiceDetailList: AsrLine[];
};

type AsrResponse = { succeed?: boolean; message?: string; data?: unknown };

// ASR's column sizes; a longer value is rejected (ORA-12899), so we cut instead.
const LIMITS = { creditorName: 200, title: 50, invoiceDescription: 200, itemDesc: 100, lines: 999 };
// Amounts are whole Rial in practice; allow a rounding difference of 1 Rial.
const TOLERANCE = 1;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const formatRial = (value: number) => value.toLocaleString('en-US');

/** Turns our checked invoice into ASR's request, or throws with what the accountant has to fix. */
export function toAsrInvoice(invoice: AccountingInvoice): AsrManualInvoice {
  if (invoice.currency !== 'IRR') {
    throw new Error(`ASR only accepts invoices in Rial (IRR); this one is in ${invoice.currency ?? 'an unknown currency'}`);
  }
  const vendor = invoice.vendorName?.trim();
  if (!vendor) throw new Error('ASR needs the vendor name');
  if (!invoice.invoiceDate) throw new Error('ASR needs the invoice date');

  const lines: Omit<AsrLine, 'rowNumber'>[] = invoice.items.map((item, index) => {
    const measure = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const unitPrice = item.unitPrice ?? (item.totalPrice != null ? item.totalPrice / measure : null);
    if (unitPrice == null) throw new Error(`Line ${index + 1} has no price`);
    const description = item.description?.trim() || `ردیف ${index + 1}`;
    return { itemDesc: cut(description, LIMITS.itemDesc), unitPrice: round3(unitPrice), measure: round3(measure), total: round3(unitPrice * measure) };
  });
  const tax = invoice.taxAmount ?? 0;
  const discount = round3(invoice.discountAmount ?? 0);
  if (lines.length === 0) {
    // No lines read: one line for the amount before discount and tax (the tax line follows).
    const net = round3(invoice.subtotal ?? invoice.totalAmount + discount - tax);
    lines.push({ itemDesc: cut(invoice.notes?.trim() || 'اقلام فاکتور', LIMITS.itemDesc), unitPrice: net, measure: 1, total: net });
  }

  const sum = (rows: { total: number }[]) => round3(rows.reduce((total, row) => total + row.total, 0));
  // VAT printed under the lines becomes a line of its own, since ASR has no tax
  // field; when the lines already include it, nothing is added.
  if (tax > 0 && Math.abs(sum(lines) - discount + tax - invoice.totalAmount) <= TOLERANCE) {
    lines.push({ itemDesc: 'مالیات و عوارض ارزش افزوده', unitPrice: round3(tax), measure: 1, total: round3(tax) });
  }
  const subTotal = sum(lines);
  const total = round3(subTotal - discount);
  if (Math.abs(total - invoice.totalAmount) > TOLERANCE) {
    const afterDiscount = discount ? ` minus the discount of ${formatRial(discount)} is ${formatRial(total)},` : '';
    throw new Error(
      `The lines add up to ${formatRial(subTotal)},${afterDiscount} but the invoice total is ${formatRial(invoice.totalAmount)}. ` +
        'ASR saves these amounts as they are, so correct the lines, the discount or the total first'
    );
  }
  if (lines.length > LIMITS.lines) throw new Error(`ASR accepts at most ${LIMITS.lines} lines`);

  const description = [
    invoice.invoiceNumber && `شماره فاکتور: ${invoice.invoiceNumber}`,
    invoice.vendorTaxId && `شناسه فروشنده: ${invoice.vendorTaxId}`,
    invoice.notes?.trim()
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    creditorName: cut(vendor, LIMITS.creditorName),
    title: cut(invoice.invoiceNumber ? `فاکتور خرید ${invoice.invoiceNumber}` : `فاکتور خرید ${vendor}`, LIMITS.title),
    ...(description ? { invoiceDescription: cut(description, LIMITS.invoiceDescription) } : {}),
    invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    subTotal,
    discount,
    total,
    manualInvoiceDetailList: lines.map((line, index) => ({ rowNumber: index + 1, ...line }))
  };
}

export class AsrConnector implements AccountingConnector {
  constructor(private readonly config: AsrConfig) {}

  async send(invoice: AccountingInvoice): Promise<SentInvoice> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new Error('ASR is not configured on the server (ASR_BASE_URL / ASR_API_KEY)');
    }
    const body = toAsrInvoice(invoice);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/partner/manual-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      // A timeout may mean ASR saved it but didn't answer in time; resending
      // would then create a second invoice, since ASR doesn't check duplicates.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error('ASR did not answer in time. Check in ASR whether the invoice was created before sending it again');
      }
      throw new Error('Could not reach ASR');
    }

    if (response.status === 401) throw new Error('ASR refused the API key');
    const result = (await response.json().catch(() => null)) as AsrResponse | null;
    if (!response.ok) throw new Error(`ASR answered with HTTP ${response.status}${result?.message ? `: ${result.message}` : ''}`);
    // A business rejection still comes back as 200, with succeed: false (nothing saved).
    if (!result?.succeed) throw new Error(`ASR rejected the invoice: ${result?.message ?? 'no reason given'}`);
    return { reference: result.data != null ? String(result.data) : null };
  }
}
