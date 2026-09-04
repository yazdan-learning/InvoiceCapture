import { FormEvent, useEffect, useState } from 'react';
import { getOrganizationSettings, updateOrganizationSettings } from '../api';

export function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mileageRatePerKm, setMileageRatePerKm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrganizationSettings()
      .then((settings) => setMileageRatePerKm(String(settings.mileageRatePerKm)))
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
      const updated = await updateOrganizationSettings({ mileageRatePerKm: rate });
      setMileageRatePerKm(String(updated.mileageRatePerKm));
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
          <h3 style={{ marginBottom: 12 }}>Mileage</h3>
          <form onSubmit={handleSubmit}>
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
