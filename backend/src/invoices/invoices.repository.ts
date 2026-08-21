import { Prisma, InvoiceStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export type LineItemInput = {
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  taxRate?: number | null;
};

export type CreateInvoiceInput = {
  id: string;
  organizationId: string;
  uploadedBy: string;
  filePath: string;
  mimeType: string;
  fileSizeB: number;
  status: InvoiceStatus;
  invoiceNumber?: string | null;
  invoiceDate?: Date | null;
  dueDate?: Date | null;
  vendorName?: string | null;
  vendorAddress?: string | null;
  vendorTaxId?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  subtotal?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  currency?: string | null;
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  rawExtraction?: Prisma.InputJsonValue;
  errorMessage?: string | null;
  items: LineItemInput[];
};

const invoiceInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  category: true,
  uploader: { select: { id: true, name: true } },
  approvals: {
    include: { approver: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' as const }
  }
};

export const invoicesRepository = {
  create(input: CreateInvoiceInput) {
    const { items, ...invoiceFields } = input;
    return prisma.invoice.create({
      data: {
        ...invoiceFields,
        items: {
          create: items.map((item, index) => ({ ...item, sortOrder: index }))
        }
      },
      include: invoiceInclude
    });
  },

  findById(organizationId: string, id: string) {
    return prisma.invoice.findFirst({
      where: { id, organizationId },
      include: invoiceInclude
    });
  },

  findPotentialDuplicate(
    organizationId: string,
    params: { vendorName?: string | null; invoiceNumber?: string | null; totalAmount?: number | null }
  ) {
    if (!params.vendorName || !params.invoiceNumber || params.totalAmount == null) {
      return null;
    }
    return prisma.invoice.findFirst({
      where: {
        organizationId,
        vendorName: params.vendorName,
        invoiceNumber: params.invoiceNumber,
        totalAmount: params.totalAmount
      }
    });
  },

  list(
    organizationId: string,
    filters: { status?: InvoiceStatus; search?: string; page: number; pageSize: number; uploadedBy?: string }
  ) {
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      ...(filters.uploadedBy ? { uploadedBy: filters.uploadedBy } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search
        ? {
            OR: [
              { vendorName: { contains: filters.search, mode: 'insensitive' } },
              { invoiceNumber: { contains: filters.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    return Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: invoiceInclude
      }),
      prisma.invoice.count({ where })
    ]);
  },

  listForExport(organizationId: string, status?: InvoiceStatus, uploadedBy?: string) {
    return prisma.invoice.findMany({
      where: { organizationId, ...(status ? { status } : {}), ...(uploadedBy ? { uploadedBy } : {}) },
      include: invoiceInclude,
      orderBy: { createdAt: 'desc' }
    });
  },

  update(id: string, data: Prisma.InvoiceUpdateInput, items?: LineItemInput[]) {
    return prisma.$transaction(async (tx) => {
      if (items) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLineItem.createMany({
          data: items.map((item, index) => ({ ...item, invoiceId: id, sortOrder: index }))
        });
      }
      return tx.invoice.update({
        where: { id },
        data,
        include: invoiceInclude
      });
    });
  },

  createApproval(data: { invoiceId: string; approverId: string; stepOrder: number }) {
    return prisma.approval.create({ data });
  },

  findPendingApproval(invoiceId: string) {
    return prisma.approval.findFirst({ where: { invoiceId, decision: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  },

  decideApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', comment: string | null) {
    return prisma.approval.update({ where: { id: approvalId }, data: { decision, comment, decidedAt: new Date() } });
  },

  listApprovalQueue(organizationId: string, approverId: string) {
    return prisma.invoice.findMany({
      where: { organizationId, approvals: { some: { approverId, decision: 'PENDING' } } },
      include: invoiceInclude,
      orderBy: { createdAt: 'asc' }
    });
  }
};
