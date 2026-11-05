// The review page's fields that get a box on the photo and can be picked from
// it: what kind of value each one is (how a region is read), how the model is
// told what to look for, and its name in the reading's JSON (rawExtraction.data).

export type FieldKind = 'text' | 'amount' | 'date';

type PickableField = { kind: FieldKind; label: string; readingKey: string };

export const PICKABLE_FIELDS: Record<string, PickableField> = {
  vendorName: { kind: 'text', label: "the seller's name (the vendor; on Persian invoices often on the stamp)", readingKey: 'vendorName' },
  vendorTaxId: { kind: 'text', label: "the seller's tax ID or economic code (شماره اقتصادی)", readingKey: 'vendorTaxId' },
  vendorAddress: { kind: 'text', label: "the seller's address", readingKey: 'vendorAddress' },
  invoiceNumber: { kind: 'text', label: 'the invoice number', readingKey: 'invoiceNumber' },
  invoiceDate: { kind: 'date', label: 'the invoice date', readingKey: 'invoiceDate' },
  dueDate: { kind: 'date', label: 'the due date', readingKey: 'dueDate' },
  subtotal: { kind: 'amount', label: 'the subtotal (before tax and invoice discount)', readingKey: 'subtotal' },
  discountAmount: { kind: 'amount', label: 'the discount on the whole invoice', readingKey: 'discount' },
  taxAmount: { kind: 'amount', label: 'the tax / VAT amount', readingKey: 'taxAmount' },
  totalAmount: { kind: 'amount', label: 'the total amount to pay', readingKey: 'totalAmount' }
};

export const isPickableField = (field: string) => Object.prototype.hasOwnProperty.call(PICKABLE_FIELDS, field);

/** A line item's box field: "items.2" for the third row. */
export const itemField = (index: number) => `items.${index}`;
export const isItemField = (field: string) => /^items\.\d+$/.test(field);
