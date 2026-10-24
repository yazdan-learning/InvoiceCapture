import { FormEvent, useEffect, useState } from 'react';
import { CountryOption, getOrganizationSettings, updateOrganizationSettings } from '../api';
import { useCountry } from '../country/CountryContext';
import { useModules } from '../workspace/ModulesContext';
import { AppModule } from '../types';
import { useTranslation, SUPPORTED_LANGUAGES, LANGUAGE_LABELS, Language } from '../i18n/LanguageContext';
import { Select } from '../components/Select';

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const { reload: reloadCountry } = useCountry();
  const { reload: reloadModules } = useModules();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mileageRatePerKm, setMileageRatePerKm] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>([]);
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('en');
  const [country, setCountry] = useState('INTL');
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [modules, setModules] = useState<AppModule[]>([]);
  const [supportedModules, setSupportedModules] = useState<AppModule[]>([]);
  const [accountingConnector, setAccountingConnector] = useState('NONE');
  const [accountingConnectors, setAccountingConnectors] = useState<{ id: string; name: string }[]>([]);
  const [currencyConverter, setCurrencyConverter] = useState('FRANKFURTER');
  const [currencyConverters, setCurrencyConverters] = useState<{ id: string; name: string }[]>([]);
  const [materialMatcher, setMaterialMatcher] = useState('LLM');
  const [materialMatchers, setMaterialMatchers] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrganizationSettings()
      .then((settings) => {
        setMileageRatePerKm(String(settings.mileageRatePerKm));
        setDefaultCurrency(settings.defaultCurrency);
        setSupportedCurrencies(settings.supportedCurrencies);
        setDefaultLanguage(settings.defaultLanguage as Language);
        setCountry(settings.country);
        setCountries(settings.supportedCountries);
        setModules(settings.modules);
        setSupportedModules(settings.supportedModules.map((m) => m.id));
        setAccountingConnector(settings.accountingConnector);
        setAccountingConnectors(settings.supportedAccountingConnectors);
        setCurrencyConverter(settings.currencyConverter);
        setCurrencyConverters(settings.supportedCurrencyConverters);
        setMaterialMatcher(settings.materialMatcher);
        setMaterialMatchers(settings.supportedMaterialMatchers);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('adminSettings.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The currency list follows the selected country (IRR only for Iran).
  const currencyOptions = countries.find((c) => c.id === country)?.currencies ?? supportedCurrencies;

  const handleCountryChange = (id: string) => {
    setCountry(id);
    const selected = countries.find((c) => c.id === id);
    if (selected) setDefaultCurrency(selected.defaultCurrency);
  };

  const toggleModule = (module: AppModule, enabled: boolean) => {
    setModules((current) => (enabled ? [...current, module] : current.filter((m) => m !== module)));
  };

  const expensesEnabled = modules.includes('EXPENSES');
  const invoicesEnabled = modules.includes('PURCHASE_INVOICES');
  const pricingEnabled = modules.includes('RAW_MATERIAL_PRICING');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (modules.length === 0) {
      setError(t('adminSettings.modulesRequired'));
      return;
    }
    // The mileage rate only matters (and is only shown) with the expenses module.
    const rate = Number(mileageRatePerKm);
    if (expensesEnabled && (!Number.isFinite(rate) || rate <= 0)) {
      setError(t('adminSettings.mileageRateInvalid'));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateOrganizationSettings({
        ...(expensesEnabled ? { mileageRatePerKm: rate } : {}),
        defaultCurrency,
        defaultLanguage,
        country,
        modules,
        currencyConverter,
        // Only purchase invoices are sent to accounting; only pricing matches materials.
        ...(invoicesEnabled ? { accountingConnector } : {}),
        ...(pricingEnabled ? { materialMatcher } : {})
      });
      setMileageRatePerKm(String(updated.mileageRatePerKm));
      setDefaultCurrency(updated.defaultCurrency);
      setDefaultLanguage(updated.defaultLanguage as Language);
      setCountry(updated.country);
      setModules(updated.modules);
      setAccountingConnector(updated.accountingConnector);
      setCurrencyConverter(updated.currencyConverter);
      setMaterialMatcher(updated.materialMatcher);
      reloadCountry();
      reloadModules();
      setSuccessMessage(t('adminSettings.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>{t('adminSettings.title')}</h2>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="alert alert-success">
          <span>{successMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="list-loading">{t('adminSettings.loading')}</div>
      ) : (
        <div className="review-form">
          <form className="settings-form" onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>{t('adminSettings.modulesSection')}</h3>
              {supportedModules.map((module) => (
                <label key={module} className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={modules.includes(module)}
                    onChange={(e) => toggleModule(module, e.target.checked)}
                  />
                  <span>
                    {t(`adminSettings.module${module}`)}
                    <small>{t(`adminSettings.module${module}Hint`)}</small>
                  </span>
                </label>
              ))}
            </div>

            {invoicesEnabled && (
              <div className="form-section">
                <h3>{t('adminSettings.accountingSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('adminSettings.accountingSystem')}</span>
                    <Select
                      value={accountingConnector}
                      onChange={setAccountingConnector}
                      options={accountingConnectors.map((c) => ({
                        value: c.id,
                        label: c.id === 'NONE' ? t('adminSettings.accountingNone') : c.name
                      }))}
                    />
                  </label>
                </div>
                <p className="field-hint">{t('adminSettings.accountingHint')}</p>
              </div>
            )}

            {pricingEnabled && (
              <div className="form-section">
                <h3>{t('adminSettings.pricingSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('adminSettings.materialMatcher')}</span>
                    <Select
                      value={materialMatcher}
                      onChange={setMaterialMatcher}
                      options={materialMatchers.map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </label>
                </div>
                <p className="field-hint">{t('adminSettings.materialMatcherHint')}</p>
              </div>
            )}

            <div className="form-section">
              <h3>{t('adminSettings.countrySection')}</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('adminSettings.country')}</span>
                  <Select
                    value={country}
                    onChange={handleCountryChange}
                    options={countries.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </label>
              </div>
              <p className="field-hint">{t('adminSettings.countryHint')}</p>
            </div>

            <div className="form-section">
              <h3>{t('adminSettings.currencySection')}</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('adminSettings.defaultCurrency')}</span>
                  <Select
                    value={defaultCurrency}
                    onChange={setDefaultCurrency}
                    options={currencyOptions.map((code) => ({ value: code, label: code }))}
                  />
                </label>
              </div>
              <p className="field-hint">{t('adminSettings.currencyHint')}</p>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('adminSettings.currencyConverter')}</span>
                  <Select
                    value={currencyConverter}
                    onChange={setCurrencyConverter}
                    options={currencyConverters.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </label>
              </div>
              <p className="field-hint">{t('adminSettings.currencyConverterHint')}</p>
            </div>

            <div className="form-section">
              <h3>{t('adminSettings.languageSection')}</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>{t('adminSettings.defaultLanguage')}</span>
                  <Select
                    value={defaultLanguage}
                    onChange={(value) => setDefaultLanguage(value as Language)}
                    options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }))}
                  />
                </label>
              </div>
              <p className="field-hint">{t('adminSettings.languageHint')}</p>
            </div>

            {expensesEnabled && (
              <div className="form-section">
                <h3>{t('adminSettings.mileageSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('adminSettings.mileageRate')}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={mileageRatePerKm}
                      onChange={(e) => setMileageRatePerKm(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <p className="field-hint">{t('adminSettings.mileageHint')}</p>
              </div>
            )}

            <div className="action-bar">
              <button className="button-primary" type="submit" disabled={saving}>
                {saving ? t('common.saving') : t('adminSettings.saveSettings')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
