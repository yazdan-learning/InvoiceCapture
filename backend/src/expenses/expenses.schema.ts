import { z } from 'zod';

const statusEnum = z.enum(['PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED']);

export const listExpensesQuerySchema = z.object({
  status: statusEnum.optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const exportExpensesQuerySchema = z.object({
  status: statusEnum.optional()
});

export const expenseIdParamsSchema = z.object({
  id: z.string().uuid()
});

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  totalPrice: z.number().nullable().optional(),
  taxRate: z.number().nullable().optional()
});

// Pure field edits — no status here. Every status change goes through its own
// action endpoint (submit/approve/reject), so there's exactly one way to move
// an expense forward, not an ambiguous status field mixed into a field-edit PATCH.
export const updateExpenseSchema = z.object({
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  vendorAddress: z.string().nullable().optional(),
  vendorTaxId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  customerAddress: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  taxRate: z.number().nullable().optional(),
  taxAmount: z.number().nullable().optional(),
  totalAmount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  items: z.array(lineItemSchema).optional(),
  // Editable after creation regardless of how the distance was first
  // populated (typed, or map-calculated) — totalAmount is always re-derived
  // server-side from these, never trusted from the client.
  mileageDate: z.coerce.date().nullable().optional(),
  mileageFrom: z.string().nullable().optional(),
  mileageTo: z.string().nullable().optional(),
  mileageDistanceKm: z.number().positive().nullable().optional(),
  mileageRoundTrip: z.boolean().optional()
});

// Distance is optional at creation time — saving a draft with just a date
// (nothing else filled in yet) is allowed, same as a receipt can exist with
// every extracted field still null. One-way distance, when present, is
// either given directly or calculated from from/to via the DistanceCalculator
// port. submitForApproval is what actually enforces a total amount exists —
// this schema only shapes the input, it doesn't decide what's submittable.
export const createMileageSchema = z.object({
  date: z.coerce.date(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  distanceKm: z.number().positive().optional(),
  roundTrip: z.boolean().default(false),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional()
});

export const mileageDistancePreviewSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1)
});

export const approveSchema = z.object({
  comment: z.string().trim().min(1).nullable().optional()
});

// Rejecting without saying why leaves the submitter with nothing to fix.
export const rejectSchema = z.object({
  comment: z.string().trim().min(1, 'A reason is required when rejecting an expense')
});

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type ExportExpensesQuery = z.infer<typeof exportExpensesQuerySchema>;
export type CreateMileageInput = z.infer<typeof createMileageSchema>;
export type MileageDistancePreviewInput = z.infer<typeof mileageDistancePreviewSchema>;
