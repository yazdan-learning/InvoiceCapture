// The accounting system a checked purchase invoice is handed to. Each company
// connects its own (an API, a file export, or nothing); the expenses service
// only knows this port — see ./registry.ts for the adapters.

export type AccountingInvoiceItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  taxRate: number | null;
};

/** The checked invoice, in the organization's currency. */
export type AccountingInvoice = {
  /** Ours: lets a connector make a retried send idempotent. */
  id: string;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  subtotal: number | null;
  /** On the whole invoice, positive; subtotal is before it, totalAmount after it. */
  discountAmount: number | null;
  taxAmount: number | null;
  totalAmount: number;
  currency: string | null;
  notes: string | null;
  items: AccountingInvoiceItem[];
};

export type SentInvoice = {
  /** The invoice's id in the accounting system, when it returns one. */
  reference: string | null;
};

export interface AccountingConnector {
  /**
   * Creates the invoice in the accounting system — as a draft there, where it
   * supports that, so the accountant still posts it. Throws when it couldn't.
   */
  send(invoice: AccountingInvoice): Promise<SentInvoice>;
}
