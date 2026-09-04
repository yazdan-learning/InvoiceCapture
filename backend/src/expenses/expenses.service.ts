import { randomUUID } from 'crypto';
import { ExpenseStatus, Prisma } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../shared/errors';
import { toCsv } from '../shared/csv';
import { expensesRepository, LineItemInput } from './expenses.repository';
import { ApproverResolver, DistanceCalculator, FileStorage, InvoiceExtractor, UploadedFile } from './ports';
import { CreateMileageInput, ListExpensesQuery, UpdateExpenseInput } from './expenses.schema';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type Actor = { userId: string; role: 'EMPLOYEE' | 'APPROVER' | 'ADMIN' };

// Admins see everything in the org; everyone else only sees expenses they
// submitted, or ones routed to them as an approver (current or past step).
function canView(expense: { uploadedBy: string; approvals: { approverId: string }[] }, actor: Actor): boolean {
  if (actor.role === 'ADMIN') return true;
  if (expense.uploadedBy === actor.userId) return true;
  return expense.approvals.some((a) => a.approverId === actor.userId);
}

// Only the submitter (or an admin) may edit or submit — an approver reviews,
// they don't get to change the numbers they're approving.
function canEdit(expense: { uploadedBy: string }, actor: Actor): boolean {
  return actor.role === 'ADMIN' || expense.uploadedBy === actor.userId;
}

type Deps = {
  extractor: InvoiceExtractor;
  fileStorage: FileStorage;
  approverResolver: ApproverResolver;
  distanceCalculator: DistanceCalculator;
};

// mileageDistanceKm always stores the one-way distance; the round-trip factor
// is applied here, at the single point where totalAmount is derived, so an
// edit can never accidentally double- (or halve-) count it.
function computeMileageTotal(distanceKm: number, roundTrip: boolean, ratePerKm: number): number {
  return (roundTrip ? distanceKm * 2 : distanceKm) * ratePerKm;
}

export function createExpensesService({ extractor, fileStorage, approverResolver, distanceCalculator }: Deps) {
  // The calculator throws plain Errors (not set up, no route found, etc.) —
  // rethrow as BadRequestError so the real message reaches the client instead
  // of being masked as a 500 by the global error handler.
  async function resolveDistance(from: string, to: string) {
    try {
      return await distanceCalculator.getDistance(from, to);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Could not calculate distance');
    }
  }

  return {
    async uploadAndExtract(organizationId: string, userId: string, file: UploadedFile) {
      const expenseId = randomUUID();
      const relativePath = await fileStorage.save({ organizationId, expenseId, file });

      let extraction: Awaited<ReturnType<InvoiceExtractor['extract']>> | null = null;
      let errorMessage: string | null = null;
      try {
        extraction = await extractor.extract(file);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Extraction failed';
      }

      const data = extraction?.success ? extraction.data : undefined;
      const status: ExpenseStatus = data ? 'EXTRACTED' : 'FAILED';
      const totalAmount = data?.totalAmount ?? null;

      const duplicate = data
        ? await expensesRepository.findPotentialDuplicate(organizationId, {
            vendorName: data.vendorName,
            invoiceNumber: data.invoiceNumber,
            totalAmount
          })
        : null;

      const items: LineItemInput[] = (data?.items ?? []).map((item) => ({
        description: item.description,
        quantity: item.quantity ?? null,
        unitPrice: item.unitPrice ?? null,
        totalPrice: item.totalPrice ?? null,
        taxRate: item.taxRate ?? null
      }));

      return expensesRepository.create({
        id: expenseId,
        organizationId,
        uploadedBy: userId,
        expenseType: 'RECEIPT',
        filePath: relativePath,
        mimeType: file.mimetype,
        fileSizeB: file.size,
        status,
        invoiceNumber: data?.invoiceNumber ?? null,
        invoiceDate: toDate(data?.invoiceDate),
        dueDate: toDate(data?.dueDate),
        vendorName: data?.vendorName ?? null,
        vendorAddress: data?.vendorAddress ?? null,
        vendorTaxId: data?.vendorTaxId ?? null,
        customerName: data?.customerName ?? null,
        customerAddress: data?.customerAddress ?? null,
        subtotal: data?.subtotal ?? null,
        taxRate: data?.taxRate ?? null,
        taxAmount: data?.taxAmount ?? null,
        totalAmount,
        currency: data?.currency ?? null,
        paymentMethod: data?.paymentMethod ?? null,
        paymentTerms: data?.paymentTerms ?? null,
        notes: data?.notes ?? null,
        isDuplicate: Boolean(duplicate),
        duplicateOfId: duplicate?.id ?? null,
        rawExtraction: extraction ? (extraction.raw as Prisma.InputJsonValue) : undefined,
        errorMessage: errorMessage ?? extraction?.error ?? null,
        items
      });
    },

    async createMileageExpense(organizationId: string, userId: string, input: CreateMileageInput) {
      let distanceKm: number | null = input.distanceKm ?? null;
      if (distanceKm == null && input.from && input.to) {
        distanceKm = (await resolveDistance(input.from, input.to)).distanceKm;
      }

      let totalAmount: number | null = null;
      if (distanceKm != null) {
        const ratePerKm = await expensesRepository.getOrganizationMileageRate(organizationId);
        totalAmount = computeMileageTotal(distanceKm, input.roundTrip, ratePerKm);
      }

      return expensesRepository.create({
        id: randomUUID(),
        organizationId,
        uploadedBy: userId,
        expenseType: 'MILEAGE',
        status: 'EXTRACTED',
        mileageDate: input.date,
        mileageFrom: input.from ?? null,
        mileageTo: input.to ?? null,
        mileageDistanceKm: distanceKm,
        mileageRoundTrip: input.roundTrip,
        totalAmount,
        categoryId: input.categoryId ?? null,
        notes: input.notes ?? null,
        isDuplicate: false,
        items: []
      });
    },

    getDistancePreview(from: string, to: string) {
      return resolveDistance(from, to);
    },

    // Lets the frontend show a live "this trip will reimburse ~X" estimate
    // before saving — the actual totalAmount is still always recomputed
    // server-side from this same rate, never trusted from the client.
    async getMileageRate(organizationId: string) {
      return { ratePerKm: await expensesRepository.getOrganizationMileageRate(organizationId) };
    },

    async list(organizationId: string, filters: ListExpensesQuery, actor: Actor) {
      const scoped = actor.role === 'ADMIN' ? filters : { ...filters, uploadedBy: actor.userId };
      const [expenses, total] = await expensesRepository.list(organizationId, scoped);
      return { expenses, total, page: filters.page, pageSize: filters.pageSize };
    },

    async getById(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      return expense;
    },

    async getFile(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      if (!expense.filePath || !expense.mimeType) throw new NotFoundError('This expense has no document attached');
      const buffer = await fileStorage.read(expense.filePath);
      return { buffer, mimeType: expense.mimeType };
    },

    // Pure field edits — no status transitions here. Every status change has
    // its own dedicated action (submit/approve/reject) so there's exactly one
    // way to move an expense forward, not an ambiguous status field on PATCH.
    async update(organizationId: string, id: string, patch: UpdateExpenseInput, actor: Actor) {
      const existing = await expensesRepository.findById(organizationId, id);
      if (!existing || !canView(existing, actor)) throw new NotFoundError('Expense not found');
      if (!canEdit(existing, actor)) {
        throw new BadRequestError('Only the person who submitted this expense can edit it');
      }

      const { items, ...fields } = patch;

      // totalAmount is never trusted from the client for mileage — always
      // re-derived from the (possibly just-edited) distance/round-trip fields.
      if (existing.expenseType === 'MILEAGE') {
        const distanceKm = fields.mileageDistanceKm ?? Number(existing.mileageDistanceKm ?? 0);
        const roundTrip = fields.mileageRoundTrip ?? existing.mileageRoundTrip;
        const ratePerKm = await expensesRepository.getOrganizationMileageRate(organizationId);
        (fields as Record<string, unknown>).totalAmount = computeMileageTotal(distanceKm, roundTrip, ratePerKm);
      }

      return expensesRepository.update(id, fields as Prisma.ExpenseUpdateInput, items);
    },

    async submitForApproval(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      if (!canEdit(expense, actor)) {
        throw new BadRequestError('Only the person who submitted this expense can submit it for approval');
      }
      if (!['EXTRACTED', 'FAILED', 'REJECTED'].includes(expense.status)) {
        throw new BadRequestError('This expense has already been submitted');
      }
      if (expense.totalAmount == null) {
        throw new BadRequestError('Cannot submit without a total amount');
      }

      // Route to the actual submitter's manager, even if an admin is doing this on their behalf.
      const approver = await approverResolver.getApprover(expense.uploadedBy);

      if (!approver) {
        // Nobody above them in the hierarchy — nothing to route to, so they're
        // self-certifying. Matches the solo/small-operator case directly.
        return expensesRepository.update(id, { status: 'APPROVED' });
      }

      if (approver.role === 'EMPLOYEE') {
        throw new BadRequestError(
          "Your manager isn't set up as an approver yet. Ask an admin to update their role."
        );
      }

      await expensesRepository.createApproval({ expenseId: id, approverId: approver.id, stepOrder: 1 });
      return expensesRepository.update(id, { status: 'SUBMITTED' });
    },

    async decide(
      organizationId: string,
      id: string,
      approverId: string,
      decision: 'APPROVED' | 'REJECTED',
      comment: string | null
    ) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense) throw new NotFoundError('Expense not found');

      const pending = await expensesRepository.findPendingApproval(id);
      if (!pending || pending.approverId !== approverId) {
        throw new BadRequestError('You do not have a pending approval for this expense');
      }

      await expensesRepository.decideApproval(pending.id, decision, comment);
      return expensesRepository.update(id, { status: decision });
    },

    getApprovalQueue(organizationId: string, approverId: string) {
      return expensesRepository.listApprovalQueue(organizationId, approverId);
    },

    async exportCsv(organizationId: string, status: ExpenseStatus | undefined, actor: Actor) {
      const uploadedBy = actor.role === 'ADMIN' ? undefined : actor.userId;
      const expenses = await expensesRepository.listForExport(organizationId, status, uploadedBy);

      return toCsv(
        ['Invoice Number', 'Invoice Date', 'Vendor', 'Category', 'Subtotal', 'Tax', 'Total', 'Currency', 'Status'],
        expenses.map((expense) => [
          expense.invoiceNumber,
          expense.invoiceDate ? expense.invoiceDate.toISOString().slice(0, 10) : null,
          expense.vendorName,
          expense.category?.name,
          expense.subtotal?.toString(),
          expense.taxAmount?.toString(),
          expense.totalAmount?.toString(),
          expense.currency,
          expense.status
        ])
      );
    }
  };
}

export type ExpensesService = ReturnType<typeof createExpensesService>;
