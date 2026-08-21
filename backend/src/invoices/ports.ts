// Ports for the two things v1 already knows will be swapped later:
// where extraction happens (n8n today), and where files land (local disk today, S3 later).
// Everything else in this feature stays plain layering — see backend/README.md.

export type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type ExtractedInvoiceItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  taxRate?: number | null;
};

export type ExtractedInvoiceData = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  items: ExtractedInvoiceItem[];
  subtotal: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  notes: string | null;
};

export type ExtractionResult = {
  success: boolean;
  data?: ExtractedInvoiceData;
  error?: string;
  raw: unknown; // full provider response, stored as-is on the invoice for audit/debugging
};

export interface InvoiceExtractor {
  extract(file: UploadedFile): Promise<ExtractionResult>;
}

export interface FileStorage {
  save(params: { organizationId: string; invoiceId: string; file: UploadedFile }): Promise<string>;
  read(storedPath: string): Promise<Buffer>;
}

export type Approver = {
  id: string;
  role: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
};

// The one thing this module needs from auth: who does this person report to,
// and can that person actually approve. The auth module's authService satisfies
// this structurally — invoices never imports anything else from auth, which is
// what keeps it extractable later.
export interface ApproverResolver {
  getApprover(userId: string): Promise<Approver | null>;
}
