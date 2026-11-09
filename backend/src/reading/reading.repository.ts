import { FieldBoxSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { LocatedBox } from './vision-fields';
import type { TemplateMatchKind } from './templates';

const BOX_SELECT = { field: true, source: true, page: true, x: true, y: true, width: true, height: true, value: true } as const;

export type StoredBox = LocatedBox & { source: FieldBoxSource; value: string | null };

export const readingRepository = {
  getReadingSettings(organizationId: string): Promise<{ invoiceReader: string; country: string; shareTemplates: boolean }> {
    return prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { invoiceReader: true, country: true, shareTemplates: true } });
  },

  listBoxes(expenseId: string): Promise<StoredBox[]> {
    return prisma.expenseFieldBox.findMany({ where: { expenseId }, select: BOX_SELECT, orderBy: { createdAt: 'asc' } });
  },

  /**
   * The located boxes (found on the page: MODEL; from a template: TEMPLATE)
   * replace earlier ones, and the expense is marked as located (also with none
   * found), with the template it used.
   */
  async saveModelBoxes(
    expenseId: string,
    boxes: (LocatedBox & { source?: 'MODEL' | 'TEMPLATE'; value?: string | null })[],
    template: { id: string; by: TemplateMatchKind } | null = null
  ): Promise<void> {
    await prisma.$transaction([
      prisma.expenseFieldBox.deleteMany({ where: { expenseId, source: { in: ['MODEL', 'TEMPLATE'] } } }),
      prisma.expenseFieldBox.createMany({ data: boxes.map(({ source = 'MODEL', ...box }) => ({ ...box, expenseId, source })) }),
      prisma.expense.update({ where: { id: expenseId }, data: { boxesLocatedAt: new Date(), templateId: template?.id ?? null, templateMatch: template?.by ?? null } })
    ]);
  },

  /** Moved or drawn by the user: a value read from an earlier box of theirs is kept. */
  async moveUserBox(expenseId: string, box: LocatedBox): Promise<void> {
    const { field, ...position } = box;
    await prisma.expenseFieldBox.upsert({
      where: { expenseId_field_source: { expenseId, field, source: 'USER' } },
      create: { expenseId, field, source: 'USER', ...position },
      update: position
    });
    await unmarkRemoved(expenseId, field);
  },

  /** The user removed a field's box: gone from this invoice, and noted so the vendor's template forgets it on send. */
  async removeBoxes(expenseId: string, field: string): Promise<void> {
    const { removedBoxFields } = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { removedBoxFields: true } });
    await prisma.$transaction([
      prisma.expenseFieldBox.deleteMany({ where: { expenseId, field } }),
      prisma.expense.update({ where: { id: expenseId }, data: { removedBoxFields: [...new Set([...removedBoxFields, field])] } })
    ]);
  },

  /** The fields whose box the user removed on this invoice (and didn't draw again). */
  async listRemovedFields(expenseId: string): Promise<string[]> {
    return (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { removedBoxFields: true } })).removedBoxFields;
  },

  async saveUserBox(expenseId: string, box: LocatedBox, value: string | null): Promise<void> {
    const { field, ...position } = box;
    await prisma.expenseFieldBox.upsert({
      where: { expenseId_field_source: { expenseId, field, source: 'USER' } },
      create: { expenseId, field, source: 'USER', ...position, value },
      update: { ...position, value }
    });
    await unmarkRemoved(expenseId, field);
  }
};

/** A box drawn again for a field the user had removed: it is no longer removed. */
async function unmarkRemoved(expenseId: string, field: string): Promise<void> {
  const { removedBoxFields } = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { removedBoxFields: true } });
  if (removedBoxFields.includes(field)) {
    await prisma.expense.update({ where: { id: expenseId }, data: { removedBoxFields: removedBoxFields.filter((f) => f !== field) } });
  }
}

export type ReadingRepository = typeof readingRepository;
