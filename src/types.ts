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
// Only expenseType "RECEIPT" is fully supported in the UI today; the others
// are reserved on the model for when mileage/per-diem/general expenses land.
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
  isDuplicate: boolean;
  duplicateOfId: string | null;
  errorMessage: string | null;
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
