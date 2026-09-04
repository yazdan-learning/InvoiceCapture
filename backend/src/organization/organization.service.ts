import { organizationRepository } from './organization.repository';
import { UpdateOrganizationSettingsInput } from './organization.schema';

export function createOrganizationService() {
  return {
    getSettings(organizationId: string) {
      return organizationRepository.get(organizationId);
    },

    updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput) {
      return organizationRepository.updateMileageRate(organizationId, input.mileageRatePerKm);
    }
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
