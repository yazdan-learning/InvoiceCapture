import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMileageExpense, getCategories, getMileageRate, previewMileageDistance, submitExpense } from '../api';
import { Category } from '../types';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { RouteMap } from '../components/RouteMap';
import { isGoogleMapsConfigured } from '../lib/googleMaps';
import { useTranslation } from '../i18n/LanguageContext';
import { useIsDesktop } from '../hooks/useIsDesktop';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MileageEntryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const [categories, setCategories] = useState<Category[]>([]);
  const [date, setDate] = useState(todayInputValue());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [routeQuery, setRouteQuery] = useState<{ from: string; to: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ratePerKm, setRatePerKm] = useState<number | null>(null);
  const lastCalculatedRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
    getMileageRate().then((r) => setRatePerKm(r.ratePerKm)).catch(() => setRatePerKm(null));
  }, []);

  // Client-side preview only, computed from the same rate the server uses —
  // the real totalAmount is still always derived server-side on save, this
  // is purely so the user sees the number before committing.
  const estimatedAmount =
    ratePerKm != null && distanceKm.trim() !== ''
      ? Number(distanceKm) * (roundTrip ? 2 : 1) * ratePerKm
      : null;

  // Runs automatically whenever both locations are known — picking a place
  // from autocomplete, or just leaving the field after typing a custom
  // address. The dedupe guard stops a blur that follows a selection (or a
  // second blur with unchanged text) from re-firing the same lookup.
  const runCalculate = async (fromValue: string, toValue: string) => {
    if (!fromValue.trim() || !toValue.trim()) return;
    if (lastCalculatedRef.current?.from === fromValue && lastCalculatedRef.current?.to === toValue) return;
    lastCalculatedRef.current = { from: fromValue, to: toValue };
    setCalculating(true);
    setDistanceError(null);
    setRouteQuery({ from: fromValue, to: toValue });
    try {
      const result = await previewMileageDistance(fromValue.trim(), toValue.trim());
      setDistanceKm(result.distanceKm.toFixed(1));
    } catch (err) {
      setDistanceError(err instanceof Error ? err.message : t('common.couldNotCalculateDistance'));
    } finally {
      setCalculating(false);
    }
  };

  const retryCalculate = () => {
    lastCalculatedRef.current = null;
    runCalculate(from, to);
  };

  // A draft can be saved with nothing but a date — you finish it later on the
  // review page. Submitting for approval needs a real amount, same rule the
  // backend enforces (submitForApproval rejects a null totalAmount) — this
  // just surfaces it as a disabled button instead of a failed request.
  const canSubmitForApproval = distanceKm.trim() !== '' || (from.trim() && to.trim());

  const buildCreatePayload = () => ({
    date,
    from: from.trim() || undefined,
    to: to.trim() || undefined,
    distanceKm: distanceKm.trim() !== '' ? Number(distanceKm) : undefined,
    roundTrip,
    categoryId: categoryId || null,
    notes: notes.trim() || null
  });

  const handleSaveDraft = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const expense = await createMileageExpense(buildCreatePayload());
      navigate(`/expenses/${expense.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('mileage.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!canSubmitForApproval) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const expense = await createMileageExpense(buildCreatePayload());
      try {
        await submitExpense(expense.id);
        navigate('/expenses');
      } catch {
        // Created fine, but the submit step failed (e.g. no approver set up) —
        // go to the review page to retry from there rather than risk creating
        // a second expense by trying again from this form.
        navigate(`/expenses/${expense.id}`);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('mileage.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="detail-layout">
      {isDesktop && (
        <div className="detail-layout-aside">
          <RouteMap origin={routeQuery?.from ?? ''} destination={routeQuery?.to ?? ''} />
        </div>
      )}

      <div className="review-form">
        <div className="form-section">
          <h3>{t('common.trip')}</h3>
          <div className="form-grid">
            <label className="form-field">
              <span>{t('common.date')}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t('common.from')}</span>
              <LocationAutocompleteInput
                defaultValue={from}
                onChange={setFrom}
                onPlaceSelected={(address) => runCalculate(address, to)}
                placeholder={isGoogleMapsConfigured() ? t('common.startTypingAddress') : t('mileage.fromPlaceholderNoMaps')}
              />
            </label>
            <label className="form-field">
              <span>{t('common.to')}</span>
              <LocationAutocompleteInput
                defaultValue={to}
                onChange={setTo}
                onPlaceSelected={(address) => runCalculate(from, address)}
                placeholder={isGoogleMapsConfigured() ? t('common.startTypingAddress') : t('mileage.toPlaceholderNoMaps')}
              />
            </label>
            <label className="form-field">
              <span>
                {t('common.distanceKm')}
                {calculating ? t('common.calculatingSuffix') : ''}
              </span>
              <input
                type="number"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                placeholder={t('mileage.distancePlaceholder')}
              />
            </label>
            <label className="form-field form-field--checkbox">
              <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
              <span>{t('common.roundTrip')}</span>
            </label>
          </div>
          {distanceError && (
            <div className="alert alert-error alert-inline">
              <span>{distanceError}</span>
              {from.trim() && to.trim() && (
                <button className="alert-action" type="button" onClick={retryCalculate}>
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}
          {!isDesktop && <RouteMap origin={routeQuery?.from ?? ''} destination={routeQuery?.to ?? ''} />}
        </div>

        <div className="form-section">
          <h3>{t('common.details')}</h3>
          <div className="form-grid">
            <label className="form-field">
              <span>{t('common.category')}</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('common.uncategorized')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="form-section">
          <label className="form-field form-field--wide">
            <span>{t('common.notes')}</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        {submitError && (
          <div className="alert alert-error">
            <span>{submitError}</span>
          </div>
        )}

        <div className="action-bar action-bar--with-total">
          {estimatedAmount != null && (
            <span className="estimated-total">
              <span className="estimated-total-label">{t('common.amount')}</span>
              <span className="estimated-total-value">
                {estimatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </span>
          )}
          <span className="action-bar-buttons">
            <button className="button-outline" type="button" disabled={submitting} onClick={handleSaveDraft}>
              {submitting ? t('common.saving') : t('common.saveDraft')}
            </button>
            <button
              className="button-primary"
              type="button"
              disabled={!canSubmitForApproval || submitting}
              onClick={handleSubmitForApproval}
            >
              {submitting ? t('common.submitting') : t('common.submitForApproval')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
