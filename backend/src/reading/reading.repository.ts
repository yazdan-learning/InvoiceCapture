import { FieldBoxSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { LocatedBox } from './vision-fields';

const BOX_SELECT = { field: true, source: true, page: true, x: true, y: true, width: true, height: true, value: true } as const;

export type StoredBox = LocatedBox & { source: FieldBoxSource; value: string | null };

export const readingRepository = {
  getReadingSettings(organizationId: string): Promise<{ invoiceReader: string; country: string }> {
    return prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { invoiceReader: true, country: true } });
  },

  listBoxes(expenseId: string): Promise<StoredBox[]> {
    return prisma.expenseFieldBox.findMany({ where: { expenseId }, select: BOX_SELECT, orderBy: { createdAt: 'asc' } });
  },

  /** The located boxes replace earlier ones, and the expense is marked as located (also with none found). */
  async saveModelBoxes(expenseId: string, boxes: LocatedBox[]): Promise<void> {
    await prisma.$transaction([
      prisma.expenseFieldBox.deleteMany({ where: { expenseId, source: 'MODEL' } }),
      prisma.expenseFieldBox.createMany({ data: boxes.map((box) => ({ ...box, expenseId, source: 'MODEL' as const })) }),
      prisma.expense.update({ where: { id: expenseId }, data: { boxesLocatedAt: new Date() } })
    ]);
  },

  async saveUserBox(expenseId: string, box: LocatedBox, value: string | null): Promise<void> {
    const { field, ...position } = box;
    await prisma.expenseFieldBox.upsert({
      where: { expenseId_field_source: { expenseId, field, source: 'USER' } },
      create: { expenseId, field, source: 'USER', ...position, value },
      update: { ...position, value }
    });
  }
};

export type ReadingRepository = typeof readingRepository;
