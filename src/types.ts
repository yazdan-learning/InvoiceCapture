export type ExpenseStatus = 'PENDING' | 'PROCESSING' | 'EXTRACTED' | 'FAILED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type ExpenseType = 'RECEIPT' | 'MILEAGE' | 'PER_DIEM' | 'GENERAL';

export type Role = 'EMPLOYEE' | 'APPROVER' | 'ADMIN';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type ExpenseLineItem = {
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

// Mirrors the backend's Expense model (backend/prisma/schema.prisma). Numeric
// money fields come back as strings — Prisma serializes Decimal via toJSON().
// expenseType "RECEIPT" and "MILEAGE" are fully supported in the UI; PER_DIEM
// and GENERAL are reserved on the model for later.
export type Expense = {
  id: string;
  status: ExpenseStatus;
  expenseType: ExpenseType;
  mimeType: string | null;
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
  // Snapshot of what was on the invoice before currency conversion — set once
  // at extraction, never touched by later edits. Non-null only when a
  // conversion actually happened (extracted currency differed from the org's
  // default at the time).
  originalCurrency: string | null;
  originalSubtotal: string | null;
  originalTaxAmount: string | null;
  originalTotalAmount: string | null;
  exchangeRate: string | null;
  exchangeRateDate: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  errorMessage: string | null;
  mileageDate: string | null;
  mileageFrom: string | null;
  mileageTo: string | null;
  mileageDistanceKm: string | null;
  mileageRoundTrip: boolean;
  category: Category | null;
  items: ExpenseLineItem[];
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
  data?: Expense;
  error?: string;
};
