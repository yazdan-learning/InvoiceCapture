import { AppModule, MaterialMatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

const withPending = { proposals: { where: { status: 'PENDING' as const }, take: 1 } };

export type StoredMaterial = Prisma.RawMaterialGetPayload<{ include: typeof withPending }>;
export type StoredProposal = Prisma.MaterialPriceProposalGetPayload<{ include: { material: true } }>;

export type PricingSettings = {
  modules: AppModule[];
  defaultCurrency: string;
  currencyConverter: string;
  materialMatcher: string;
};

/** What the AI last said about a material; all null = clear it. */
export type SuggestionFields = {
  suggestedSeriesId: string | null;
  suggestionConfidence: number | null;
  suggestionReason: string | null;
  suggestedBy: string | null;
  matchError: string | null;
};

export type MaterialUpdate = Partial<
  SuggestionFields & {
    name: string;
    unit: string | null;
    currentPrice: number;
    currentPriceDate: Date;
    matchStatus: MaterialMatchStatus;
    seriesId: string | null;
  }
>;

export type ProposalInput = {
  seriesId: string;
  previousPrice: number;
  previousDate: Date;
  proposedPrice: number;
  asOf: Date;
  indexFrom: number;
  indexTo: number;
  indexPeriod: string;
  fxFrom: number;
  fxTo: number;
};

export const pricingRepository = {
  async getSettings(organizationId: string): Promise<PricingSettings> {
    return prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { modules: true, defaultCurrency: true, currencyConverter: true, materialMatcher: true }
    });
  },

  listMaterials(organizationId: string): Promise<StoredMaterial[]> {
    return prisma.rawMaterial.findMany({ where: { organizationId }, include: withPending, orderBy: { name: 'asc' } });
  },

  findMaterial(organizationId: string, id: string): Promise<StoredMaterial | null> {
    return prisma.rawMaterial.findFirst({ where: { id, organizationId }, include: withPending });
  },

  findMaterialByName(organizationId: string, name: string) {
    return prisma.rawMaterial.findUnique({ where: { organizationId_name: { organizationId, name } }, select: { id: true } });
  },

  /** Materials a person has decided on: reused for same-named materials and shown to the AI as examples. */
  listConfirmed(organizationId: string) {
    return prisma.rawMaterial.findMany({
      where: { organizationId, matchStatus: { in: ['CONFIRMED', 'NO_INDEX'] } },
      select: { id: true, name: true, seriesId: true },
      orderBy: { updatedAt: 'desc' },
      take: 500
    });
  },

  createMaterial(data: SuggestionFields & { organizationId: string; name: string; unit: string | null; currency: string; currentPrice: number; currentPriceDate: Date }): Promise<StoredMaterial> {
    return prisma.rawMaterial.create({ data, include: withPending });
  },

  updateMaterial(id: string, data: MaterialUpdate): Promise<StoredMaterial> {
    return prisma.rawMaterial.update({ where: { id }, data, include: withPending });
  },

  async deleteMaterial(id: string): Promise<void> {
    await prisma.rawMaterial.delete({ where: { id } });
  },

  findProposal(organizationId: string, id: string): Promise<StoredProposal | null> {
    return prisma.materialPriceProposal.findFirst({ where: { id, material: { organizationId } }, include: { material: true } });
  },

  /** A price change that no longer applies (the price or the category changed by hand, or it fell under the threshold). */
  async dropPendingProposals(materialId: string): Promise<void> {
    await prisma.materialPriceProposal.deleteMany({ where: { materialId, status: 'PENDING' } });
  },

  /** At most one pending proposal per material: a new run replaces the old one. */
  async replacePendingProposal(materialId: string, input: ProposalInput): Promise<void> {
    await prisma.$transaction([
      prisma.materialPriceProposal.deleteMany({ where: { materialId, status: 'PENDING' } }),
      prisma.materialPriceProposal.create({ data: { materialId, ...input } })
    ]);
  },

  async approveProposal(proposal: StoredProposal, userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.materialPriceProposal.update({
        where: { id: proposal.id },
        data: { status: 'APPROVED', decidedBy: userId, decidedAt: new Date() }
      }),
      prisma.rawMaterial.update({
        where: { id: proposal.materialId },
        data: { currentPrice: proposal.proposedPrice, currentPriceDate: proposal.asOf }
      })
    ]);
  },

  async rejectProposal(id: string, userId: string): Promise<void> {
    await prisma.materialPriceProposal.update({ where: { id }, data: { status: 'REJECTED', decidedBy: userId, decidedAt: new Date() } });
  }
};

export type PricingRepository = typeof pricingRepository;
