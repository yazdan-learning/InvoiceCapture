import { AppModule } from '@prisma/client';
import { prisma } from '../config/prisma';
import { UpdateOrganizationSettingsInput } from './organization.schema';

const SETTINGS_SELECT = { mileageRatePerKm: true, defaultCurrency: true, defaultLanguage: true, country: true, modules: true, accountingConnector: true };

export type OrganizationSettings = {
  mileageRatePerKm: number;
  defaultCurrency: string;
  defaultLanguage: string;
  country: string;
  modules: AppModule[];
  accountingConnector: string;
};

function toSettings(org: Omit<OrganizationSettings, 'mileageRatePerKm'> & { mileageRatePerKm: unknown }): OrganizationSettings {
  return {
    mileageRatePerKm: Number(org.mileageRatePerKm),
    defaultCurrency: org.defaultCurrency,
    defaultLanguage: org.defaultLanguage,
    country: org.country,
    modules: org.modules,
    accountingConnector: org.accountingConnector
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
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.modules !== undefined ? { modules: input.modules } : {}),
        ...(input.accountingConnector !== undefined ? { accountingConnector: input.accountingConnector } : {})
      },
      select: SETTINGS_SELECT
    });
    return toSettings(org);
  }
};

export type OrganizationRepository = typeof organizationRepository;
