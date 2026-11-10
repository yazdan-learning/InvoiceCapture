import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { PageLook, TemplateWord } from './template-match';
import { guideOf, type FormGuide } from './form-guide';
import { ASPECT_TOLERANCE, ChosenField, StoredTemplate, TemplateItems, TemplateLayout } from './templates';

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
  updatedAt: row.updatedAt,
  words: (row.words as TemplateWord[] | null) ?? [],
  samples: row.samples,
  look: (row.look as PageLook | null) ?? null,
  chosen: Object.fromEntries(
    Object.entries((row.chosen as Record<string, ChosenField | number> | null) ?? {}).map(([f, c]) => [f, typeof c === 'number' ? { times: c, label: null } : c])
  ),
  guide: guideOf(row.guide),
  learnedFrom: (row.learnedFrom as string[] | null) ?? [],
  cheapReads: row.cheapReads,
  cheapFailed: row.cheapFailed
});

/** What a template learns from the form besides its boxes. */
export type FormFeatures = {
  words: TemplateWord[];
  samples: number;
  look: PageLook | null;
  chosen: Record<string, ChosenField>;
  guide?: FormGuide;
  learnedFrom?: string[];
};

const formData = ({ words, samples, look, chosen, guide, learnedFrom }: FormFeatures) => ({
  words,
  samples,
  look: look ?? Prisma.DbNull,
  chosen,
  ...(guide ? { guide: guide as unknown as Prisma.InputJsonValue } : {}),
  ...(learnedFrom ? { learnedFrom } : {})
});

/** The vendor keys to look templates up by: one of each from a reading, or every one an invoice's text could hold. */
export type TemplateKeys = { taxIds: string[]; keys: string[] };
export type NewTemplate = TemplateLayout &
  FormFeatures & { organizationId: string; shared: boolean; vendorTaxId: string | null; vendorKey: string | null; vendorName: string | null };

const visibleTo = (organizationId: string) => ({ OR: [{ organizationId }, { shared: true, organization: { shareTemplates: true } }] });

/** Templates looked through to find one by the form (printed words, page look): the most recently used. */
const FORM_CANDIDATES = 300;

export const templatesRepository = {
  /** The templates with one of the vendor tax IDs or name keys: the organization's own, and the ones others share. */
  async findCandidates(organizationId: string, { taxIds, keys }: TemplateKeys): Promise<StoredTemplate[]> {
    const vendor = [...(taxIds.length ? [{ vendorTaxId: { in: taxIds } }] : []), ...(keys.length ? [{ vendorKey: { in: keys } }] : [])];
    if (!vendor.length) return [];
    const rows = await prisma.invoiceTemplate.findMany({
      where: { AND: [{ OR: vendor }, visibleTo(organizationId)] },
      take: 50
    });
    return rows.map(toStored);
  },

  /** The templates (own or shared) whose first page has about this height ÷ width: candidates to find by the form. */
  async findByShape(organizationId: string, firstPageAspect: number): Promise<StoredTemplate[]> {
    const rows = await prisma.invoiceTemplate.findMany({
      where: {
        AND: [
          { firstPageAspect: { gte: firstPageAspect * (1 - ASPECT_TOLERANCE), lte: firstPageAspect * (1 + ASPECT_TOLERANCE) } },
          visibleTo(organizationId)
        ]
      },
      orderBy: { updatedAt: 'desc' },
      take: FORM_CANDIDATES
    });
    return rows.map(toStored);
  },

  async findById(id: string): Promise<StoredTemplate | null> {
    const row = await prisma.invoiceTemplate.findUnique({ where: { id } });
    return row ? toStored(row) : null;
  },

  async create(template: NewTemplate): Promise<StoredTemplate> {
    const { pageAspects, fields, items, words, samples, look, chosen, guide, learnedFrom, ...rest } = template;
    return toStored(
      await prisma.invoiceTemplate.create({
        data: { ...rest, pageAspects, firstPageAspect: pageAspects[0] ?? null, fields, items: items ?? Prisma.DbNull, ...formData({ words, samples, look, chosen, guide, learnedFrom }) }
      })
    );
  },

  /** The latest layout (and any vendor key it lacked) from an invoice just sent. */
  async update(id: string, change: TemplateLayout & FormFeatures & { vendorTaxId?: string | null; vendorKey?: string | null; vendorName?: string | null }): Promise<StoredTemplate> {
    const { pageAspects, fields, items, words, samples, look, chosen, guide, learnedFrom, ...keys } = change;
    const data = Object.fromEntries(Object.entries(keys).filter(([, v]) => v !== undefined && v !== null));
    return toStored(
      await prisma.invoiceTemplate.update({
        where: { id },
        data: { ...data, pageAspects, firstPageAspect: pageAspects[0] ?? null, fields, items: items ?? Prisma.DbNull, ...formData({ words, samples, look, chosen, guide, learnedFrom }) }
      })
    );
  },

  /** The cheaper model read an invoice of this form; `failed`: its reading failed a check (read again with the usual model). */
  async recordCheapReading(id: string, failed: boolean): Promise<void> {
    await prisma.invoiceTemplate.update({
      where: { id },
      data: { cheapReads: { increment: 1 }, ...(failed ? { cheapFailed: { increment: 1 } } : {}) }
    });
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
