import { prisma } from '../config/prisma';
import { UpdateOrganizationSettingsInput } from './organization.schema';

const SETTINGS_SELECT = { mileageRatePerKm: true, defaultCurrency: true, defaultLanguage: true, country: true };

export type OrganizationSettings = {
  mileageRatePerKm: number;
  defaultCurrency: string;
  defaultLanguage: string;
  country: string;
};

function toSettings(org: { mileageRatePerKm: unknown; defaultCurrency: string; defaultLanguage: string; country: string }): OrganizationSettings {
  return {
    mileageRatePerKm: Number(org.mileageRatePerKm),
    defaultCurrency: org.defaultCurrency,
    defaultLanguage: org.defaultLanguage,
    country: org.country
  };
}

export const organizationRepository = {
  async get(organizationId: string): Promise<OrganizationSettings> {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: SETTINGS_SELECT
    });
    return toSettings(org);
  },

  async updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput): Promise<OrganizationSettings> {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.mileageRatePerKm !== undefined ? { mileageRatePerKm: input.mileageRatePerKm } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.defaultLanguage !== undefined ? { defaultLanguage: input.defaultLanguage } : {}),
        ...(input.country !== undefined ? { country: input.country } : {})
      },
      select: SETTINGS_SELECT
    });
    return toSettings(org);
  }
};

export type OrganizationRepository = typeof organizationRepository;
