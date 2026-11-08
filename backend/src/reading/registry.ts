// How an organization's invoices are read (Organization.invoiceReader).
// CLASSIC is the stable extractor (DirectInvoiceExtractor) exactly as it was;
// TEMPLATE is the template-guided reader being built on top of it: the same
// extractor plus the field boxes on the photo, editing them, and invoice
// templates (learned on send, matched by vendor). Going back to the
// stable reading is this setting only.
export const INVOICE_READER_IDS = ['CLASSIC', 'TEMPLATE'] as const;
export type InvoiceReaderId = (typeof INVOICE_READER_IDS)[number];

export const INVOICE_READER_NAMES: Record<InvoiceReaderId, string> = {
  CLASSIC: 'Classic (stable)',
  TEMPLATE: 'Template-guided (beta): shows on the photo where each field was read'
};

/** Whether the review page shows the field boxes and offers "pick from photo". */
export function showsFieldBoxes(reader: string): boolean {
  return reader === 'TEMPLATE';
}
