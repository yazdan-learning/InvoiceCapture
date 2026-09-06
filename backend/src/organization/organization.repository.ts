import { prisma } from '../config/prisma';
import { UpdateOrganizationSettingsInput } from './organization.schema';

const SETTINGS_SELECT = { mileageRatePerKm: true, defaultCurrency: true, defaultLanguage: true };

function toSettings(org: { mileageRatePerKm: unknown; defaultCurrency: string; defaultLanguage: string }) {
  return {
    mileageRatePerKm: Number(org.mileageRatePerKm),
    defaultCurrency: org.defaultCurrency,
    defaultLanguage: org.defaultLanguage
  };
}

export const organizationRepository = {
  async get(organizationId: string) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: SETTINGS_SELECT
    });
    return toSettings(org);
  },

  async updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.mileageRatePerKm !== undefined ? { mileageRatePerKm: input.mileageRatePerKm } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.defaultLanguage !== undefined ? { defaultLanguage: input.defaultLanguage } : {})
      },
      select: SETTINGS_SELECT
    });
    return toSettings(org);
  }
};
