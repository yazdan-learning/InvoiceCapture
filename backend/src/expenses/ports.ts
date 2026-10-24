import { Role } from '@prisma/client';
import { CountryProfile } from '../countries/country-profile';

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
  /** Discount on the whole invoice (تخفیف), as a positive amount. */
  discount?: number | null;
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
  /** Further invoices found in the same file (several receipts scanned into one PDF), each saved as its own expense. */
  more?: { data: ExtractedInvoiceData; error?: string; raw: unknown }[];
};

export type ExtractOptions = {
  /** The user ticked "handwritten": read from the photo with the vision model (where the country supports it). */
  handwritten?: boolean;
  /** The organization's country: its prompt rules, calendar and currency units. International when not given. */
  country?: CountryProfile;
};

export interface InvoiceExtractor {
  extract(file: UploadedFile, options?: ExtractOptions): Promise<ExtractionResult>;
}

export interface FileStorage {
  save(params: { organizationId: string; expenseId: string; file: UploadedFile }): Promise<string>;
  read(storedPath: string): Promise<Buffer>;
  delete(storedPath: string): Promise<void>;
}

export type Approver = {
  id: string;
  role: Role;
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

// Exchange rates are their own port, shared with material pricing — see ../currency.
export type { CurrencyConverter, ExchangeRate } from '../currency/ports';
