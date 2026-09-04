import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  decideExpense,
  getCategories,
  getExpense,
  getExpenseFileBlobUrl,
  getMileageRate,
  previewMileageDistance,
  submitExpense,
  updateExpense
} from '../api';
import { Category, Expense } from '../types';
import { StatusPill } from '../components/StatusPill';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { RouteMap } from '../components/RouteMap';
import { isGoogleMapsConfigured } from '../lib/googleMaps';
import { useAuth } from '../auth/AuthContext';

type FormState = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  vendorName: string;
  vendorAddress: string;
  vendorTaxId: string;
  customerName: string;
  customerAddress: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  paymentMethod: string;
  paymentTerms: string;
  notes: string;
  categoryId: string;
  mileageDate: string;
  mileageFrom: string;
  mileageTo: string;
  mileageDistanceKm: string;
  mileageRoundTrip: boolean;
};

type SavingAction = 'draft' | 'submit' | 'approve' | 'reject' | null;

function toDateInputValue(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function toFormState(expense: Expense): FormState {
  return {
    invoiceNumber: expense.invoiceNumber ?? '',
    invoiceDate: toDateInputValue(expense.invoiceDate),
    dueDate: toDateInputValue(expense.dueDate),
    vendorName: expense.vendorName ?? '',
    vendorAddress: expense.vendorAddress ?? '',
    vendorTaxId: expense.vendorTaxId ?? '',
    customerName: expense.customerName ?? '',
    customerAddress: expense.customerAddress ?? '',
    subtotal: expense.subtotal ?? '',
    taxRate: expense.taxRate ?? '',
    taxAmount: expense.taxAmount ?? '',
    totalAmount: expense.totalAmount ?? '',
    currency: expense.currency ?? '',
    paymentMethod: expense.paymentMethod ?? '',
    paymentTerms: expense.paymentTerms ?? '',
    notes: expense.notes ?? '',
    categoryId: expense.category?.id ?? '',
    mileageDate: toDateInputValue(expense.mileageDate),
    mileageFrom: expense.mileageFrom ?? '',
    mileageTo: expense.mileageTo ?? '',
    mileageDistanceKm: expense.mileageDistanceKm ?? '',
    mileageRoundTrip: expense.mileageRoundTrip
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  return Number.isNaN(num) ? null : num;
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

export function ExpenseReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const justUploaded = Boolean((location.state as { justUploaded?: boolean } | null)?.justUploaded);

  const [expense, setExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SavingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [calculatingDistance, setCalculatingDistance] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [routeQuery, setRouteQuery] = useState<{ from: string; to: string } | null>(null);
  const [ratePerKm, setRatePerKm] = useState<number | null>(null);
  const lastCalculatedRef = useRef<{ from: string; to: string } | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([getExpense(id), getCategories()])
      .then(([inv, cats]) => {
        setExpense(inv);
        setForm(toFormState(inv));
        setCategories(cats);
        if (inv.expenseType === 'MILEAGE' && inv.mileageFrom && inv.mileageTo) {
          setRouteQuery({ from: inv.mileageFrom, to: inv.mileageTo });
          lastCalculatedRef.current = { from: inv.mileageFrom, to: inv.mileageTo };
        }
        if (inv.expenseType === 'MILEAGE') {
          getMileageRate().then((r) => setRatePerKm(r.ratePerKm)).catch(() => setRatePerKm(null));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load expense'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  // The file route requires auth, so <img src> can't hit it directly — fetch it
  // as an authenticated blob instead and point the image at that. Mileage
  // expenses have no attached document, so skip the request entirely rather
  // than round-tripping to a guaranteed 404.
  useEffect(() => {
    if (!id || !expense || expense.expenseType === 'MILEAGE') return;
    let objectUrl: string | null = null;
    getExpenseFileBlobUrl(id)
      .then((url) => {
        objectUrl = url;
        setFileUrl(url);
      })
      .catch(() => setFileUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, expense?.expenseType]);

  const updateField = (field: keyof FormState, value: string | boolean) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const isMileage = expense?.expenseType === 'MILEAGE';

  const buildPayload = () => {
    if (!form) return null;
    if (isMileage) {
      return {
        mileageDate: emptyToNull(form.mileageDate),
        mileageFrom: emptyToNull(form.mileageFrom),
        mileageTo: emptyToNull(form.mileageTo),
        mileageDistanceKm: numberOrNull(form.mileageDistanceKm),
        mileageRoundTrip: form.mileageRoundTrip,
        categoryId: emptyToNull(form.categoryId),
        notes: emptyToNull(form.notes)
      };
    }
    return {
      invoiceNumber: emptyToNull(form.invoiceNumber),
      invoiceDate: emptyToNull(form.invoiceDate),
      dueDate: emptyToNull(form.dueDate),
      vendorName: emptyToNull(form.vendorName),
      vendorAddress: emptyToNull(form.vendorAddress),
      vendorTaxId: emptyToNull(form.vendorTaxId),
      customerName: emptyToNull(form.customerName),
      customerAddress: emptyToNull(form.customerAddress),
      subtotal: numberOrNull(form.subtotal),
      taxRate: numberOrNull(form.taxRate),
      taxAmount: numberOrNull(form.taxAmount),
      totalAmount: numberOrNull(form.totalAmount),
      currency: emptyToNull(form.currency),
      paymentMethod: emptyToNull(form.paymentMethod),
      paymentTerms: emptyToNull(form.paymentTerms),
      notes: emptyToNull(form.notes),
      categoryId: emptyToNull(form.categoryId)
    };
  };

  // Runs automatically whenever both locations are known — picking a place
  // from autocomplete, or just leaving the field after typing a custom
  // address. The dedupe guard stops a blur that follows a selection (or a
  // second blur with unchanged text) from re-firing the same lookup.
  const runCalculate = async (fromValue: string, toValue: string) => {
    if (!fromValue.trim() || !toValue.trim()) return;
    if (lastCalculatedRef.current?.from === fromValue && lastCalculatedRef.current?.to === toValue) return;
    lastCalculatedRef.current = { from: fromValue, to: toValue };
    setCalculatingDistance(true);
    setDistanceError(null);
    setRouteQuery({ from: fromValue, to: toValue });
    try {
      const result = await previewMileageDistance(fromValue.trim(), toValue.trim());
      updateField('mileageDistanceKm', result.distanceKm.toFixed(1));
    } catch (err) {
      setDistanceError(err instanceof Error ? err.message : 'Could not calculate distance');
    } finally {
      setCalculatingDistance(false);
    }
  };

  const retryCalculate = () => {
    if (!form) return;
    lastCalculatedRef.current = null;
    runCalculate(form.mileageFrom, form.mileageTo);
  };

  const handleSaveDraft = async () => {
    if (!id) return;
    const payload = buildPayload();
    if (!payload) return;

    setSaving('draft');
    setError(null);
    try {
      await updateExpense(id, payload);
      navigate('/expenses');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
      setSaving(null);
    }
  };

  // Saves the edited fields, then routes the expense to the approver
  // (-> SUBMITTED, or straight to APPROVED if there's no manager to route to).
  // Also how a rejected expense gets re-submitted after edits.
  const handleSubmitForApproval = async () => {
    if (!id) return;
    const payload = buildPayload();
    if (!payload) return;

    setSaving('submit');
    setError(null);
    try {
      await updateExpense(id, payload);
      await submitExpense(id);
      navigate('/expenses');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit for approval');
    } finally {
      setSaving(null);
    }
  };

  const handleApprove = async () => {
    if (!id) return;
    setSaving('approve');
    setError(null);
    try {
      await decideExpense(id, 'approve', null);
      navigate('/approvals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
      setSaving(null);
    }
  };

  const handleReject = async () => {
    if (!id) return;
    if (!rejectComment.trim()) {
      setError('Please explain why you are rejecting this expense.');
      return;
    }
    setSaving('reject');
    setError(null);
    try {
      await decideExpense(id, 'reject', rejectComment.trim());
      navigate('/approvals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="list-loading">Loading expense…</div>;
  }

  if (!expense || !form) {
    return (
      <div className="empty-state">
        <h3>Expense not found</h3>
        <Link className="button-primary" to="/expenses">
          Back to expenses
        </Link>
      </div>
    );
  }

  const pendingApproval = expense.approvals.find((a) => a.decision === 'PENDING');
  const lastDecision = expense.approvals.find((a) => a.decision !== 'PENDING');
  const isMyApproval = Boolean(pendingApproval && user && pendingApproval.approverId === user.id);

  // Editable whenever it's the submitter's turn to act: fresh extraction,
  // saved as a draft, or kicked back with a rejection. Locked everywhere else
  // (waiting on someone else, or already decided).
  const isEditable = ['EXTRACTED', 'FAILED', 'REJECTED'].includes(expense.status) && !isMyApproval;

  // Live preview from the current (possibly unsaved) form values — reflects
  // edits immediately instead of showing the stale last-saved totalAmount.
  const estimatedAmount =
    isMileage && ratePerKm != null && form.mileageDistanceKm.trim() !== ''
      ? Number(form.mileageDistanceKm) * (form.mileageRoundTrip ? 2 : 1) * ratePerKm
      : null;

  // Mirrors the backend's own check in submitForApproval ("cannot submit
  // without a total amount") — disabling it here avoids a round-trip just to
  // find that out for a bare mileage draft with no distance filled in yet.
  const hasAmount = isMileage ? estimatedAmount != null : form.totalAmount.trim() !== '';

  const actionBar = (
    <>
      {isEditable && (
        <div className="action-bar">
          <button className="button-outline" disabled={saving !== null} onClick={handleSaveDraft} type="button">
            {saving === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            className="button-primary"
            disabled={saving !== null || !hasAmount}
            onClick={handleSubmitForApproval}
            type="button"
          >
            {saving === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      )}

      {isMyApproval && !showRejectBox && (
        <div className="action-bar">
          <button
            className="button-outline button-danger"
            disabled={saving !== null}
            onClick={() => setShowRejectBox(true)}
            type="button"
          >
            Reject
          </button>
          <button className="button-primary" disabled={saving !== null} onClick={handleApprove} type="button">
            {saving === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}

      {isMyApproval && showRejectBox && (
        <div className="reject-box">
          <label className="form-field form-field--wide">
            <span>Reason for rejecting</span>
            <textarea
              rows={3}
              autoFocus
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Let the submitter know what needs to change…"
            />
          </label>
          <div className="action-bar">
            <button
              className="button-outline"
              disabled={saving !== null}
              onClick={() => {
                setShowRejectBox(false);
                setRejectComment('');
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button-primary button-danger-solid"
              disabled={saving !== null}
              onClick={handleReject}
              type="button"
            >
              {saving === 'reject' ? 'Rejecting…' : 'Confirm rejection'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="review-page">
      <div className="review-header">
        <Link className="back-link" to="/expenses">
          ← All expenses
        </Link>
        <StatusPill status={expense.status} />
      </div>

      {justUploaded && expense.status === 'EXTRACTED' && (
        <div className="alert alert-info">
          <span>We extracted these fields automatically — check them over before submitting.</span>
        </div>
      )}

      {expense.isDuplicate && (
        <div className="alert alert-warning">
          <span>
            ⚠ This looks like a possible duplicate of an expense already in the system (same vendor, expense
            number, and amount).
          </span>
        </div>
      )}

      {expense.status === 'FAILED' && (
        <div className="alert alert-error">
          <span>
            Extraction failed{expense.errorMessage ? `: ${expense.errorMessage}` : '.'} You can still fill in the
            fields manually below.
          </span>
        </div>
      )}

      {expense.status === 'SUBMITTED' && !isMyApproval && (
        <div className="alert alert-info">
          <span>
            Submitted{pendingApproval ? ` — waiting on ${pendingApproval.approver.name}'s approval` : ''}.
          </span>
        </div>
      )}

      {expense.status === 'SUBMITTED' && isMyApproval && (
        <div className="alert alert-info">
          <span>Submitted by {expense.uploader.name}. Review the details and approve or reject below.</span>
        </div>
      )}

      {expense.status === 'APPROVED' && lastDecision && (
        <div className="alert alert-success">
          <span>
            Approved by {lastDecision.approver.name}
            {lastDecision.decidedAt ? ` on ${formatDateTime(lastDecision.decidedAt)}` : ''}.
            {lastDecision.comment ? ` "${lastDecision.comment}"` : ''}
          </span>
        </div>
      )}

      {expense.status === 'REJECTED' && lastDecision && (
        <div className="alert alert-error">
          <span>
            Rejected by {lastDecision.approver.name}: "{lastDecision.comment}". Fix the details below and submit
            again.
          </span>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {isMileage ? (
        <div className="review-form review-form--standalone">
          <fieldset className="review-fieldset" disabled={!isEditable}>
            <div className="form-section">
              <h3>Trip</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={form.mileageDate}
                    onChange={(e) => updateField('mileageDate', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>From</span>
                  <LocationAutocompleteInput
                    key={expense.id}
                    defaultValue={form.mileageFrom}
                    onChange={(value) => updateField('mileageFrom', value)}
                    onPlaceSelected={(address) => runCalculate(address, form.mileageTo)}
                    placeholder={isGoogleMapsConfigured() ? 'Start typing an address…' : undefined}
                    disabled={!isEditable}
                  />
                </label>
                <label className="form-field">
                  <span>To</span>
                  <LocationAutocompleteInput
                    key={expense.id}
                    defaultValue={form.mileageTo}
                    onChange={(value) => updateField('mileageTo', value)}
                    onPlaceSelected={(address) => runCalculate(form.mileageFrom, address)}
                    placeholder={isGoogleMapsConfigured() ? 'Start typing an address…' : undefined}
                    disabled={!isEditable}
                  />
                </label>
                <label className="form-field">
                  <span>Distance (km){calculatingDistance ? ' — calculating…' : ''}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={form.mileageDistanceKm}
                    onChange={(e) => updateField('mileageDistanceKm', e.target.value)}
                  />
                </label>
                <label className="form-field form-field--checkbox">
                  <input
                    type="checkbox"
                    checked={form.mileageRoundTrip}
                    onChange={(e) => updateField('mileageRoundTrip', e.target.checked)}
                  />
                  <span>Round trip</span>
                </label>
              </div>
              {distanceError && (
                <div className="alert alert-error alert-inline">
                  <span>{distanceError}</span>
                  {form.mileageFrom.trim() && form.mileageTo.trim() && (
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
                  <select value={form.categoryId} onChange={(e) => updateField('categoryId', e.target.value)}>
                    <option value="">Uncategorized</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Total (calculated automatically)</span>
                  <input
                    value={estimatedAmount != null ? estimatedAmount.toFixed(2) : (expense.totalAmount ?? '—')}
                    disabled
                  />
                </label>
              </div>
            </div>

            <div className="form-section">
              <label className="form-field form-field--wide">
                <span>Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
              </label>
            </div>
          </fieldset>

          {actionBar}
        </div>
      ) : (
        <div className="review-grid">
          <div className="review-preview">
            {!fileUrl ? (
              <span className="preview-loading">Loading preview…</span>
            ) : expense.mimeType?.startsWith('image/') ? (
              <img src={fileUrl} alt="Invoice document" className="review-preview-image" />
            ) : (
              <a className="button-outline" href={fileUrl} target="_blank" rel="noreferrer">
                Open document
              </a>
            )}
          </div>

          <div className="review-form">
            <fieldset className="review-fieldset" disabled={!isEditable}>
              <div className="form-section">
                <h3>Vendor</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Vendor name</span>
                  <input value={form.vendorName} onChange={(e) => updateField('vendorName', e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Tax ID</span>
                  <input value={form.vendorTaxId} onChange={(e) => updateField('vendorTaxId', e.target.value)} />
                </label>
                <label className="form-field form-field--wide">
                  <span>Vendor address</span>
                  <input
                    value={form.vendorAddress}
                    onChange={(e) => updateField('vendorAddress', e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="form-section">
              <h3>Invoice</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Invoice number</span>
                  <input
                    value={form.invoiceNumber}
                    onChange={(e) => updateField('invoiceNumber', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Category</span>
                  <select value={form.categoryId} onChange={(e) => updateField('categoryId', e.target.value)}>
                    <option value="">Uncategorized</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Invoice date</span>
                  <input
                    type="date"
                    value={form.invoiceDate}
                    onChange={(e) => updateField('invoiceDate', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Due date</span>
                  <input type="date" value={form.dueDate} onChange={(e) => updateField('dueDate', e.target.value)} />
                </label>
              </div>
            </div>

            <div className="form-section">
              <h3>Amounts</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Subtotal</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.subtotal}
                    onChange={(e) => updateField('subtotal', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Tax rate (%)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.taxRate}
                    onChange={(e) => updateField('taxRate', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Tax amount</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.taxAmount}
                    onChange={(e) => updateField('taxAmount', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Total amount</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.totalAmount}
                    onChange={(e) => updateField('totalAmount', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Currency</span>
                  <input value={form.currency} onChange={(e) => updateField('currency', e.target.value)} placeholder="USD" />
                </label>
                <label className="form-field">
                  <span>Payment method</span>
                  <input
                    value={form.paymentMethod}
                    onChange={(e) => updateField('paymentMethod', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Payment terms</span>
                  <input
                    value={form.paymentTerms}
                    onChange={(e) => updateField('paymentTerms', e.target.value)}
                  />
                </label>
              </div>
            </div>

            {expense.items.length > 0 && (
              <div className="form-section">
                <h3>Line items</h3>
                <div className="invoice-table-wrap">
                  <table className="invoice-table invoice-table--compact">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="align-right">Qty</th>
                        <th className="align-right">Unit price</th>
                        <th className="align-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expense.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.description}</td>
                          <td className="align-right">{item.quantity ?? '—'}</td>
                          <td className="align-right">{item.unitPrice ?? '—'}</td>
                          <td className="align-right">{item.totalPrice ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="form-section">
              <label className="form-field form-field--wide">
                <span>Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
              </label>
            </div>
          </fieldset>

            {actionBar}
          </div>
        </div>
      )}
    </div>
  );
}
