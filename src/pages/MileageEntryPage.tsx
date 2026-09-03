import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMileageExpense, getCategories, getMileageRate, previewMileageDistance } from '../api';
import { Category } from '../types';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { RouteMap } from '../components/RouteMap';
import { isGoogleMapsConfigured } from '../lib/googleMaps';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MileageEntryPage() {
  const navigate = useNavigate();
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
      setDistanceError(err instanceof Error ? err.message : 'Could not calculate distance');
    } finally {
      setCalculating(false);
    }
  };

  const retryCalculate = () => {
    lastCalculatedRef.current = null;
    runCalculate(from, to);
  };

  const canSubmit = date && (distanceKm.trim() !== '' || (from.trim() && to.trim()));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const expense = await createMileageExpense({
        date,
        from: from.trim() || undefined,
        to: to.trim() || undefined,
        distanceKm: distanceKm.trim() !== '' ? Number(distanceKm) : undefined,
        roundTrip,
        categoryId: categoryId || null,
        notes: notes.trim() || null
      });
      navigate(`/expenses/${expense.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save mileage expense');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="review-form review-form--standalone">
      <div className="form-section">
        <h3>Trip</h3>
        <div className="form-grid">
          <label className="form-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="form-field">
            <span>From</span>
            <LocationAutocompleteInput
              defaultValue={from}
              onChange={setFrom}
              onPlaceSelected={(address) => runCalculate(address, to)}
              placeholder={isGoogleMapsConfigured() ? 'Start typing an address…' : 'Berlin HQ'}
            />
          </label>
          <label className="form-field">
            <span>To</span>
            <LocationAutocompleteInput
              defaultValue={to}
              onChange={setTo}
              onPlaceSelected={(address) => runCalculate(from, address)}
              placeholder={isGoogleMapsConfigured() ? 'Start typing an address…' : 'Munich Client Office'}
            />
          </label>
          <label className="form-field">
            <span>Distance (km){calculating ? ' — calculating…' : ''}</span>
            <input
              type="number"
              step="0.1"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="Fills in automatically, or type it yourself"
            />
          </label>
          <label className="form-field form-field--checkbox">
            <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
            <span>Round trip</span>
          </label>
        </div>
        {distanceError && (
          <div className="alert alert-error alert-inline">
            <span>{distanceError}</span>
            {from.trim() && to.trim() && (
              <button className="alert-action" type="button" onClick={retryCalculate}>
                Retry
              </button>
            )}
          </div>
        )}
        <RouteMap origin={routeQuery?.from ?? ''} destination={routeQuery?.to ?? ''} />
      </div>

      <div className="form-section">
        <h3>Details</h3>
        <div className="form-grid">
          <label className="form-field">
            <span>Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
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
          <span>Notes</span>
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
            <span className="estimated-total-label">Estimated amount</span>
            <span className="estimated-total-value">
              {estimatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
        )}
        <button className="button-primary" type="button" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? 'Calculating…' : 'Calculate Mileage Expense'}
        </button>
      </div>
    </div>
  );
}
