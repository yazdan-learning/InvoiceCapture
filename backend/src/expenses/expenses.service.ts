import { randomUUID } from 'crypto';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../shared/errors';
import { toCsv } from '../shared/csv';
import { invoicesRepository, LineItemInput } from './invoices.repository';
import { ApproverResolver, FileStorage, InvoiceExtractor, UploadedFile } from './ports';
import { ListInvoicesQuery, UpdateInvoiceInput } from './invoices.schema';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type Actor = { userId: string; role: 'EMPLOYEE' | 'APPROVER' | 'ADMIN' };

// Admins see everything in the org; everyone else only sees invoices they
// submitted, or ones routed to them as an approver (current or past step).
function canView(invoice: { uploadedBy: string; approvals: { approverId: string }[] }, actor: Actor): boolean {
  if (actor.role === 'ADMIN') return true;
  if (invoice.uploadedBy === actor.userId) return true;
  return invoice.approvals.some((a) => a.approverId === actor.userId);
}

// Only the submitter (or an admin) may edit or submit — an approver reviews,
// they don't get to change the numbers they're approving.
function canEdit(invoice: { uploadedBy: string }, actor: Actor): boolean {
  return actor.role === 'ADMIN' || invoice.uploadedBy === actor.userId;
}

type Deps = {
  extractor: InvoiceExtractor;
  fileStorage: FileStorage;
  approverResolver: ApproverResolver;
};

export function createInvoicesService({ extractor, fileStorage, approverResolver }: Deps) {
  return {
    async uploadAndExtract(organizationId: string, userId: string, file: UploadedFile) {
      const invoiceId = randomUUID();
      const relativePath = await fileStorage.save({ organizationId, invoiceId, file });

      let extraction: Awaited<ReturnType<InvoiceExtractor['extract']>> | null = null;
      let errorMessage: string | null = null;
      try {
        extraction = await extractor.extract(file);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Extraction failed';
      }

      const data = extraction?.success ? extraction.data : undefined;
      const status: InvoiceStatus = data ? 'EXTRACTED' : 'FAILED';
      const totalAmount = data?.totalAmount ?? null;

      const duplicate = data
        ? await invoicesRepository.findPotentialDuplicate(organizationId, {
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

      return invoicesRepository.create({
        id: invoiceId,
        organizationId,
        uploadedBy: userId,
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

    async list(organizationId: string, filters: ListInvoicesQuery, actor: Actor) {
      const scoped = actor.role === 'ADMIN' ? filters : { ...filters, uploadedBy: actor.userId };
      const [invoices, total] = await invoicesRepository.list(organizationId, scoped);
      return { invoices, total, page: filters.page, pageSize: filters.pageSize };
    },

    async getById(organizationId: string, id: string, actor: Actor) {
      const invoice = await invoicesRepository.findById(organizationId, id);
      if (!invoice || !canView(invoice, actor)) throw new NotFoundError('Invoice not found');
      return invoice;
    },

    async getFile(organizationId: string, id: string, actor: Actor) {
      const invoice = await invoicesRepository.findById(organizationId, id);
      if (!invoice || !canView(invoice, actor)) throw new NotFoundError('Invoice not found');
      const buffer = await fileStorage.read(invoice.filePath);
      return { buffer, mimeType: invoice.mimeType };
    },

    // Pure field edits — no status transitions here. Every status change has
    // its own dedicated action (submit/approve/reject) so there's exactly one
    // way to move an invoice forward, not an ambiguous status field on PATCH.
    async update(organizationId: string, id: string, patch: UpdateInvoiceInput, actor: Actor) {
      const existing = await invoicesRepository.findById(organizationId, id);
      if (!existing || !canView(existing, actor)) throw new NotFoundError('Invoice not found');
      if (!canEdit(existing, actor)) {
        throw new BadRequestError('Only the person who submitted this invoice can edit it');
      }

      const { items, ...fields } = patch;

      return invoicesRepository.update(id, fields as Prisma.InvoiceUpdateInput, items);
    },

    async submitForApproval(organizationId: string, id: string, actor: Actor) {
      const invoice = await invoicesRepository.findById(organizationId, id);
      if (!invoice || !canView(invoice, actor)) throw new NotFoundError('Invoice not found');
      if (!canEdit(invoice, actor)) {
        throw new BadRequestError('Only the person who submitted this invoice can submit it for approval');
      }
      if (!['EXTRACTED', 'FAILED', 'REJECTED'].includes(invoice.status)) {
        throw new BadRequestError('This invoice has already been submitted');
      }
      if (invoice.totalAmount == null) {
        throw new BadRequestError('Cannot submit without a total amount');
      }

      // Route to the actual submitter's manager, even if an admin is doing this on their behalf.
      const approver = await approverResolver.getApprover(invoice.uploadedBy);

      if (!approver) {
        // Nobody above them in the hierarchy — nothing to route to, so they're
        // self-certifying. Matches the solo/small-operator case directly.
        return invoicesRepository.update(id, { status: 'APPROVED' });
      }

      if (approver.role === 'EMPLOYEE') {
        throw new BadRequestError(
          "Your manager isn't set up as an approver yet. Ask an admin to update their role."
        );
      }

      await invoicesRepository.createApproval({ invoiceId: id, approverId: approver.id, stepOrder: 1 });
      return invoicesRepository.update(id, { status: 'SUBMITTED' });
    },

    async decide(
      organizationId: string,
      id: string,
      approverId: string,
      decision: 'APPROVED' | 'REJECTED',
      comment: string | null
    ) {
      const invoice = await invoicesRepository.findById(organizationId, id);
      if (!invoice) throw new NotFoundError('Invoice not found');

      const pending = await invoicesRepository.findPendingApproval(id);
      if (!pending || pending.approverId !== approverId) {
        throw new BadRequestError('You do not have a pending approval for this invoice');
      }

      await invoicesRepository.decideApproval(pending.id, decision, comment);
      return invoicesRepository.update(id, { status: decision });
    },

    getApprovalQueue(organizationId: string, approverId: string) {
      return invoicesRepository.listApprovalQueue(organizationId, approverId);
    },

    async exportCsv(organizationId: string, status: InvoiceStatus | undefined, actor: Actor) {
      const uploadedBy = actor.role === 'ADMIN' ? undefined : actor.userId;
      const invoices = await invoicesRepository.listForExport(organizationId, status, uploadedBy);

      return toCsv(
        ['Invoice Number', 'Invoice Date', 'Vendor', 'Category', 'Subtotal', 'Tax', 'Total', 'Currency', 'Status'],
        invoices.map((invoice) => [
          invoice.invoiceNumber,
          invoice.invoiceDate ? invoice.invoiceDate.toISOString().slice(0, 10) : null,
          invoice.vendorName,
          invoice.category?.name,
          invoice.subtotal?.toString(),
          invoice.taxAmount?.toString(),
          invoice.totalAmount?.toString(),
          invoice.currency,
          invoice.status
        ])
      );
    }
  };
}

export type InvoicesService = ReturnType<typeof createInvoicesService>;
