export type InvoiceItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  taxRate?: number | null;
};

export type InvoiceData = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  items: InvoiceItem[];
  subtotal: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  notes: string | null;
};

export type ExtractResponse = {
  success: boolean;
  message: string;
  timestamp: string;
  data?: InvoiceData;
  metadata?: Record<string, unknown>;
  error?: string;
};
