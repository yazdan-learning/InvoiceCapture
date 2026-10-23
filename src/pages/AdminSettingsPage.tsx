import { FormEvent, useEffect, useState } from 'react';
import { CountryOption, getOrganizationSettings, updateOrganizationSettings } from '../api';
import { useCountry } from '../country/CountryContext';
import { useTranslation, SUPPORTED_LANGUAGES, LANGUAGE_LABELS, Language } from '../i18n/LanguageContext';
import { Select } from '../components/Select';

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const { reload: reloadCountry } = useCountry();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mileageRatePerKm, setMileageRatePerKm] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>([]);
  const [defaultLanguage, setDefaultLanguage] = useState<Language>('en');
  const [country, setCountry] = useState('INTL');
  const [countries, setCountries] = useState<CountryOption[]>([]);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const rate = Number(mileageRatePerKm);
    if (!Number.isFinite(rate) || rate <= 0) {
      setError(t('adminSettings.mileageRateInvalid'));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateOrganizationSettings({ mileageRatePerKm: rate, defaultCurrency, defaultLanguage, country });
      setMileageRatePerKm(String(updated.mileageRatePerKm));
      setDefaultCurrency(updated.defaultCurrency);
      setDefaultLanguage(updated.defaultLanguage as Language);
      setCountry(updated.country);
      reloadCountry();
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
