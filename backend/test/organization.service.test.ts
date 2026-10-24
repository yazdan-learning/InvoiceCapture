import { describe, expect, it, vi } from 'vitest';
import { createOrganizationService } from '../src/organization/organization.service';
import { OrganizationRepository, OrganizationSettings } from '../src/organization/organization.repository';
import { BadRequestError } from '../src/shared/errors';

function fakeRepository(settings: Partial<OrganizationSettings> = {}) {
  const current: OrganizationSettings = { mileageRatePerKm: 0.3, defaultCurrency: 'EUR', defaultLanguage: 'en', country: 'INTL', modules: ['EXPENSES'], accountingConnector: 'NONE', currencyConverter: 'FRANKFURTER', materialMatcher: 'LLM', ...settings };
  return {
    get: vi.fn(async () => current),
    updateSettings: vi.fn(async (_id: string, input: Partial<OrganizationSettings>) => ({ ...current, ...input }))
  } satisfies OrganizationRepository;
}

describe('organization settings', () => {
  it("lists the currencies of the organization's country", async () => {
    const intl = await createOrganizationService(fakeRepository()).getSettings('org');
    const iran = await createOrganizationService(fakeRepository({ country: 'IR' })).getSettings('org');
    expect(intl.supportedCurrencies).not.toContain('IRR');
    expect(iran.supportedCurrencies).toContain('IRR');
    expect(iran.supportedCountries.map((c) => c.id)).toEqual(['INTL', 'IR']);
  });

  it('allows IRR together with switching to Iran', async () => {
    const repository = fakeRepository();
    await createOrganizationService(repository).updateSettings('org', { country: 'IR', defaultCurrency: 'IRR' });
    expect(repository.updateSettings).toHaveBeenCalledWith('org', { country: 'IR', defaultCurrency: 'IRR' });
  });

  it('refuses IRR outside Iran', async () => {
    const repository = fakeRepository();
    await expect(createOrganizationService(repository).updateSettings('org', { defaultCurrency: 'IRR' })).rejects.toThrow(BadRequestError);
    expect(repository.updateSettings).not.toHaveBeenCalled();
  });

  it('refuses leaving Iran while IRR is still the default currency', async () => {
    const repository = fakeRepository({ country: 'IR', defaultCurrency: 'IRR' });
    await expect(createOrganizationService(repository).updateSettings('org', { country: 'INTL' })).rejects.toThrow(
      'IRR is not available for International'
    );
  });

  it('gives every user the enabled modules', async () => {
    const service = createOrganizationService(fakeRepository({ modules: ['PURCHASE_INVOICES'] }));
    expect(await service.getModules('org')).toEqual({ modules: ['PURCHASE_INVOICES'] });
    expect((await service.getSettings('org')).supportedModules.map((m) => m.id)).toEqual(['EXPENSES', 'PURCHASE_INVOICES', 'RAW_MATERIAL_PRICING']);
  });

  it('lists the exchange-rate sources and material matchers to choose from', async () => {
    const settings = await createOrganizationService(fakeRepository()).getSettings('org');
    expect(settings.currencyConverter).toBe('FRANKFURTER');
    expect(settings.supportedCurrencyConverters.map((c) => c.id)).toEqual(['FRANKFURTER', 'FREE_MARKET']);
    expect(settings.supportedMaterialMatchers.map((m) => m.id)).toEqual(['LLM', 'JEV', 'COMBINED']);
  });

  it('gives every user the client profile of the country', async () => {
    const profile = await createOrganizationService(fakeRepository({ country: 'IR' })).getCountry('org');
    expect(profile).toMatchObject({ id: 'IR', calendar: 'persian', features: { handwrittenInvoices: true } });
  });
});
