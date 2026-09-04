import { FormEvent, useEffect, useState } from 'react';
import { getOrganizationSettings, updateOrganizationSettings } from '../api';

export function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mileageRatePerKm, setMileageRatePerKm] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrganizationSettings()
      .then((settings) => {
        setMileageRatePerKm(String(settings.mileageRatePerKm));
        setDefaultCurrency(settings.defaultCurrency);
        setSupportedCurrencies(settings.supportedCurrencies);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const rate = Number(mileageRatePerKm);
    if (!Number.isFinite(rate) || rate <= 0) {
      setError('Enter a mileage rate greater than 0.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateOrganizationSettings({ mileageRatePerKm: rate, defaultCurrency });
      setMileageRatePerKm(String(updated.mileageRatePerKm));
      setDefaultCurrency(updated.defaultCurrency);
      setSuccessMessage('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>Settings</h2>
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
        <div className="list-loading">Loading settings…</div>
      ) : (
        <div className="review-form">
          <form className="settings-form" onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>Currency</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Default currency</span>
                  <select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
                    {supportedCurrencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-hint">
                Extracted receipts in a different currency are automatically converted into this one — the
                original captured amount stays visible and can be restored on the expense. Mileage
                reimbursement is always in this currency.
              </p>
            </div>

            <div className="form-section">
              <h3>Mileage</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Reimbursement rate (per km)</span>
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
              <p className="field-hint">
                Applied to every mileage expense across the organization — distance × (round trip ? 2 : 1) × this
                rate. Existing submitted expenses keep the total they were saved with; this only affects new and
                edited ones.
              </p>
            </div>

            <div className="action-bar">
              <button className="button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
