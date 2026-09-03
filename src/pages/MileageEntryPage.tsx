import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMileageExpense, getCategories, previewMileageDistance } from '../api';
import { Category } from '../types';

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const handleCalculateDistance = async () => {
    if (!from.trim() || !to.trim()) return;
    setCalculating(true);
    setDistanceError(null);
    try {
      const result = await previewMileageDistance(from.trim(), to.trim());
      setDistanceKm(result.distanceKm.toFixed(1));
    } catch (err) {
      setDistanceError(err instanceof Error ? err.message : 'Could not calculate distance');
    } finally {
      setCalculating(false);
    }
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
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Berlin HQ" />
          </label>
          <label className="form-field">
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Munich Client Office" />
          </label>
          <label className="form-field">
            <span>Distance (km)</span>
            <div className="distance-input-row">
              <input
                type="number"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                placeholder="e.g. 42.5"
              />
              <button
                className="button-outline"
                type="button"
                disabled={calculating || !from.trim() || !to.trim()}
                onClick={handleCalculateDistance}
              >
                {calculating ? 'Calculating…' : 'Calculate'}
              </button>
            </div>
          </label>
          <label className="form-field form-field--checkbox">
            <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
            <span>Round trip</span>
          </label>
        </div>
        {distanceError && (
          <div className="alert alert-error alert-inline">
            <span>{distanceError}</span>
          </div>
        )}
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

      <div className="action-bar">
        <button className="button-primary" type="button" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? 'Saving…' : 'Save mileage expense'}
        </button>
      </div>
    </div>
  );
}
