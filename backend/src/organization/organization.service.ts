import { organizationRepository, OrganizationRepository } from './organization.repository';
import { UpdateOrganizationSettingsInput } from './organization.schema';
import { currenciesFor, getCountryProfile, listCountries, toClientProfile } from '../countries/registry';
import { SUPPORTED_LANGUAGES } from '../shared/languages';
import { BadRequestError } from '../shared/errors';

export function createOrganizationService(repository: OrganizationRepository = organizationRepository) {
  return {
    async getSettings(organizationId: string) {
      const settings = await repository.get(organizationId);
      return {
        ...settings,
        supportedCurrencies: currenciesFor(getCountryProfile(settings.country)),
        supportedLanguages: SUPPORTED_LANGUAGES,
        supportedCountries: listCountries()
      };
    },

    // The default currency must be one the (possibly just changed) country
    // offers: switching Iran → International with IRR as the default is refused
    // rather than leaving a currency no other screen lists.
    async updateSettings(organizationId: string, input: UpdateOrganizationSettingsInput) {
      if (input.defaultCurrency !== undefined || input.country !== undefined) {
        const current = await repository.get(organizationId);
        const country = getCountryProfile(input.country ?? current.country);
        const currency = input.defaultCurrency ?? current.defaultCurrency;
        if (!currenciesFor(country).includes(currency)) {
          throw new BadRequestError(`${currency} is not available for ${country.name}. Choose another default currency.`);
        }
      }
      return repository.updateSettings(organizationId, input);
    },

    /** Readable by every signed-in user: the UI adapts to it (calendar, handwritten option). */
    async getCountry(organizationId: string) {
      const { country } = await repository.get(organizationId);
      return toClientProfile(getCountryProfile(country));
    }
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
