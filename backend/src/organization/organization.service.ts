import { organizationRepository, OrganizationRepository } from './organization.repository';
import { UpdateOrganizationSettingsInput } from './organization.schema';
import { currenciesFor, getCountryProfile, listCountries, toClientProfile } from '../countries/registry';
import { SUPPORTED_LANGUAGES } from '../shared/languages';
import { BadRequestError } from '../shared/errors';
import { APP_MODULES, MODULE_NAMES } from './modules';
import { ACCOUNTING_CONNECTOR_IDS, ACCOUNTING_CONNECTOR_NAMES } from '../accounting/registry';
import { CURRENCY_CONVERTER_IDS, CURRENCY_CONVERTER_NAMES } from '../currency/registry';
import { MATERIAL_MATCHER_IDS, MATERIAL_MATCHER_NAMES } from '../pricing/matchers/registry';

export function createOrganizationService(repository: OrganizationRepository = organizationRepository) {
  return {
    async getSettings(organizationId: string) {
      const settings = await repository.get(organizationId);
      return {
        ...settings,
        supportedCurrencies: currenciesFor(getCountryProfile(settings.country)),
        supportedLanguages: SUPPORTED_LANGUAGES,
        supportedCountries: listCountries(),
        supportedModules: APP_MODULES.map((id) => ({ id, name: MODULE_NAMES[id] })),
        supportedAccountingConnectors: ACCOUNTING_CONNECTOR_IDS.map((id) => ({ id, name: ACCOUNTING_CONNECTOR_NAMES[id] })),
        supportedCurrencyConverters: CURRENCY_CONVERTER_IDS.map((id) => ({ id, name: CURRENCY_CONVERTER_NAMES[id] })),
        supportedMaterialMatchers: MATERIAL_MATCHER_IDS.map((id) => ({ id, name: MATERIAL_MATCHER_NAMES[id] }))
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
    },

    /** Readable by every signed-in user: the menus and pages follow the enabled modules. */
    async getModules(organizationId: string) {
      const { modules } = await repository.get(organizationId);
      return { modules };
    }
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
