import { Prisma, ExpenseStatus, ExpenseType } from '@prisma/client';
import { prisma } from '../config/prisma';

export type LineItemInput = {
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  taxRate?: number | null;
};

export type CreateExpenseInput = {
  id: string;
  organizationId: string;
  uploadedBy: string;
  expenseType: ExpenseType;
  filePath?: string | null;
  mimeType?: string | null;
  fileSizeB?: number | null;
  status: ExpenseStatus;
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
  originalCurrency?: string | null;
  originalSubtotal?: number | null;
  originalTaxAmount?: number | null;
  originalTotalAmount?: number | null;
  exchangeRate?: number | null;
  exchangeRateDate?: Date | null;
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  rawExtraction?: Prisma.InputJsonValue;
  errorMessage?: string | null;
  categoryId?: string | null;
  mileageDate?: Date | null;
  mileageFrom?: string | null;
  mileageTo?: string | null;
  mileageDistanceKm?: number | null;
  mileageRoundTrip?: boolean;
  items: LineItemInput[];
};

const expenseInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  category: true,
  uploader: { select: { id: true, name: true } },
  approvals: {
    include: { approver: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' as const }
  }
};

export const expensesRepository = {
  create(input: CreateExpenseInput) {
    const { items, ...expenseFields } = input;
    return prisma.expense.create({
      data: {
        ...expenseFields,
        items: {
          create: items.map((item, index) => ({ ...item, sortOrder: index }))
        }
      },
      include: expenseInclude
    });
  },

  findById(organizationId: string, id: string) {
    return prisma.expense.findFirst({
      where: { id, organizationId },
      include: expenseInclude
    });
  },

  findPotentialDuplicate(
    organizationId: string,
    params: { vendorName?: string | null; invoiceNumber?: string | null; totalAmount?: number | null }
  ) {
    if (!params.vendorName || !params.invoiceNumber || params.totalAmount == null) {
      return null;
    }
    return prisma.expense.findFirst({
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
    filters: { status?: ExpenseStatus; search?: string; page: number; pageSize: number; uploadedBy?: string }
  ) {
    const where: Prisma.ExpenseWhereInput = {
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
      prisma.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: expenseInclude
      }),
      prisma.expense.count({ where })
    ]);
  },

  listForExport(organizationId: string, status?: ExpenseStatus, uploadedBy?: string) {
    return prisma.expense.findMany({
      where: { organizationId, ...(status ? { status } : {}), ...(uploadedBy ? { uploadedBy } : {}) },
      include: expenseInclude,
      orderBy: { createdAt: 'desc' }
    });
  },

  update(id: string, data: Prisma.ExpenseUpdateInput, items?: LineItemInput[]) {
    return prisma.$transaction(async (tx) => {
      if (items) {
        await tx.expenseLineItem.deleteMany({ where: { expenseId: id } });
        await tx.expenseLineItem.createMany({
          data: items.map((item, index) => ({ ...item, expenseId: id, sortOrder: index }))
        });
      }
      return tx.expense.update({
        where: { id },
        data,
        include: expenseInclude
      });
    });
  },

  createApproval(data: { expenseId: string; approverId: string; stepOrder: number }) {
    return prisma.approval.create({ data });
  },

  findPendingApproval(expenseId: string) {
    return prisma.approval.findFirst({ where: { expenseId, decision: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  },

  decideApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', comment: string | null) {
    return prisma.approval.update({ where: { id: approvalId }, data: { decision, comment, decidedAt: new Date() } });
  },

  listApprovalQueue(organizationId: string, approverId: string) {
    return prisma.expense.findMany({
      where: { organizationId, approvals: { some: { approverId, decision: 'PENDING' } } },
      include: expenseInclude,
      orderBy: { createdAt: 'asc' }
    });
  },

  async getOrganizationMileageRate(organizationId: string): Promise<number> {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { mileageRatePerKm: true }
    });
    return Number(org.mileageRatePerKm);
  },

  async getOrganizationDefaultCurrency(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultCurrency: true }
    });
    return org.defaultCurrency;
  },

  async getOrganizationDefaultLanguage(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultLanguage: true }
    });
    return org.defaultLanguage;
  }
};
