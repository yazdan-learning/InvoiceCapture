import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { StoredTemplate, TemplateItems, TemplateLayout } from './templates';

type TemplateRow = Prisma.InvoiceTemplateGetPayload<object>;

const toStored = (row: TemplateRow): StoredTemplate => ({
  id: row.id,
  organizationId: row.organizationId,
  shared: row.shared,
  vendorTaxId: row.vendorTaxId,
  vendorKey: row.vendorKey,
  vendorName: row.vendorName,
  pageAspects: row.pageAspects as number[],
  fields: row.fields as TemplateLayout['fields'],
  items: (row.items as TemplateItems | null) ?? null,
  timesSent: row.timesSent,
  timesCorrected: row.timesCorrected,
  updatedAt: row.updatedAt
});

export type TemplateKeys = { taxId: string | null; key: string | null };
export type NewTemplate = TemplateLayout & { organizationId: string; shared: boolean; vendorTaxId: string | null; vendorKey: string | null; vendorName: string | null };

export const templatesRepository = {
  /** The templates with the vendor's tax ID or name key: the organization's own, and the ones others share. */
  async findCandidates(organizationId: string, { taxId, key }: TemplateKeys): Promise<StoredTemplate[]> {
    const vendor = [...(taxId ? [{ vendorTaxId: taxId }] : []), ...(key ? [{ vendorKey: key }] : [])];
    if (!vendor.length) return [];
    const rows = await prisma.invoiceTemplate.findMany({
      where: {
        AND: [{ OR: vendor }, { OR: [{ organizationId }, { shared: true, organization: { shareTemplates: true } }] }]
      },
      take: 50
    });
    return rows.map(toStored);
  },

  async findById(id: string): Promise<StoredTemplate | null> {
    const row = await prisma.invoiceTemplate.findUnique({ where: { id } });
    return row ? toStored(row) : null;
  },

  async create(template: NewTemplate): Promise<StoredTemplate> {
    const { pageAspects, fields, items, ...rest } = template;
    return toStored(
      await prisma.invoiceTemplate.create({
        data: { ...rest, pageAspects, fields, items: items ?? Prisma.DbNull }
      })
    );
  },

  /** The latest layout (and any vendor key it lacked) from an invoice just sent. */
  async update(id: string, change: TemplateLayout & { vendorTaxId?: string | null; vendorKey?: string | null; vendorName?: string | null }): Promise<StoredTemplate> {
    const { pageAspects, fields, items, ...keys } = change;
    const data = Object.fromEntries(Object.entries(keys).filter(([, v]) => v !== undefined && v !== null));
    return toStored(
      await prisma.invoiceTemplate.update({ where: { id }, data: { ...data, pageAspects, fields, items: items ?? Prisma.DbNull } })
    );
  },

  /** An invoice that used the template was sent: one more use, and one more correction when its boxes had to be moved. */
  async recordUse(id: string, corrected: boolean): Promise<void> {
    await prisma.invoiceTemplate.update({
      where: { id },
      data: { timesSent: { increment: 1 }, ...(corrected ? { timesCorrected: { increment: 1 } } : {}) }
    });
  }
};

export type TemplatesRepository = typeof templatesRepository;
