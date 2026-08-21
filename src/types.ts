export type InvoiceStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'EXTRACTED'
  | 'FAILED'
  | 'REVIEWED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type Role = 'EMPLOYEE' | 'APPROVER' | 'ADMIN';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type InvoiceLineItem = {
  id: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  taxRate: string | null;
};

export type Category = {
  id: string;
  name: string;
};

export type ApprovalDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

export type Approval = {
  id: string;
  approverId: string;
  approver: { id: string; name: string };
  stepOrder: number;
  decision: ApprovalDecision;
  comment: string | null;
  decidedAt: string | null;
  createdAt: string;
};

// Mirrors the backend's Invoice model (backend/prisma/schema.prisma). Numeric
// money fields come back as strings — Prisma serializes Decimal via toJSON().
export type Invoice = {
  id: string;
  status: InvoiceStatus;
  mimeType: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  subtotal: string | null;
  taxRate: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  currency: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  notes: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  errorMessage: string | null;
  category: Category | null;
  items: InvoiceLineItem[];
  approvals: Approval[];
  uploader: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  createdAt: string;
};

export type ExtractResponse = {
  success: boolean;
  message: string;
  timestamp: string;
  data?: Invoice;
  error?: string;
};
