import { organizationRepository } from './organization.repository';
import { UpdateOrganizationSettingsInput } from './organization.schema';
import { SUPPORTED_CURRENCIES } from '../shared/currencies';
import { SUPPORTED_LANGUAGES } from '../shared/languages';

export function createOrganizationService() {
  return {
    async getSettings(organizationId: string) {
      const settings = await organizationRepository.get(organizationId);
      return { ...settings, supportedCurrencies: SUPPORTED_CURRENCIES, supportedLanguages: SUPPORTED_LANGUAGES };
    },

    updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput) {
      return organizationRepository.updateSettings(organizationId, input);
    }
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
