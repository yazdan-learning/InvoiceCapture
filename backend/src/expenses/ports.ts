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
  save(params: { organizationId: string; expenseId: string; file: UploadedFile }): Promise<string>;
  read(storedPath: string): Promise<Buffer>;
  delete(storedPath: string): Promise<void>;
}

export type Approver = {
  id: string;
  role: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
};

// The one thing this module needs from auth: who does this person report to,
// and can that person actually approve. The auth module's authService satisfies
// this structurally — expenses never imports anything else from auth, which is
// what keeps it extractable later.
export interface ApproverResolver {
  getApprover(userId: string): Promise<Approver | null>;
}

export type DistanceResult = {
  distanceKm: number;
  durationMinutes: number;
};

// Third port with the same shape as the other two: today's implementation
// (Google Directions) is swappable for Mapbox or anything else later without
// touching the service. Takes plain address text on purpose — Directions does
// its own geocoding, so no separate Places/autocomplete dependency is needed
// just to get an accurate distance.
export interface DistanceCalculator {
  getDistance(from: string, to: string): Promise<DistanceResult>;
}

export type ExchangeRate = {
  rate: number;
  asOf: Date;
};

// Fourth port, same shape as the other three: today's implementation
// (Frankfurter/ECB) is swappable for a paid provider later without touching
// the service. Returns just the rate, not a converted amount — a receipt
// needs subtotal/tax/total all converted at the same rate, so the caller
// fetches the rate once and does the multiplication itself rather than
// making three round trips for one invoice. `date`, when given, asks for the
// rate as of that day (e.g. the invoice's own date) rather than today's —
// someone uploading a receipt a few days late shouldn't get today's rate
// applied to a purchase made earlier.
export interface CurrencyConverter {
  getRate(from: string, to: string, date?: Date): Promise<ExchangeRate>;
}
