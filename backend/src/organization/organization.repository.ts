import { prisma } from '../config/prisma';
import { UpdateOrganizationSettingsInput } from './organization.schema';

export const organizationRepository = {
  async get(organizationId: string) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { mileageRatePerKm: true, defaultCurrency: true }
    });
    return { mileageRatePerKm: Number(org.mileageRatePerKm), defaultCurrency: org.defaultCurrency };
  },

  async updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.mileageRatePerKm !== undefined ? { mileageRatePerKm: input.mileageRatePerKm } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {})
      },
      select: { mileageRatePerKm: true, defaultCurrency: true }
    });
    return { mileageRatePerKm: Number(org.mileageRatePerKm), defaultCurrency: org.defaultCurrency };
  }
};
