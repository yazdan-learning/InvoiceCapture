import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  decideExpense,
  deleteExpense,
  getCategories,
  getExpense,
  getExpenseFileBlobUrl,
  getMileageRate,
  getSupportedCurrencies,
  listExpenses,
  previewMileageDistance,
  sendInvoiceToAccounting,
  submitExpense,
  updateExpense
} from '../api';
import { Category, Expense } from '../types';
import { StatusPill } from '../components/StatusPill';
import { LocationAutocompleteInput } from '../components/LocationAutocompleteInput';
import { RouteMap } from '../components/RouteMap';
import { Select } from '../components/Select';
import { isGoogleMapsConfigured } from '../lib/googleMaps';
import { useAuth } from '../auth/AuthContext';
import { useTranslation } from '../i18n/LanguageContext';
import { useCountry } from '../country/CountryContext';
import { DateInput } from '../components/DateInput';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { AmountInput } from '../components/AmountInput';
import { formatAmount, formatQuantity, toAmountInput } from '../lib/money';

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
  discountAmount: string;
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

type SavingAction = 'draft' | 'submit' | 'send' | 'approve' | 'reject' | 'delete' | null;

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
    subtotal: toAmountInput(expense.subtotal),
    discountAmount: toAmountInput(expense.discountAmount),
    taxRate: expense.taxRate ?? '',
    taxAmount: toAmountInput(expense.taxAmount),
    totalAmount: toAmountInput(expense.totalAmount),
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

// The backend's handwritten-invoice warning: "Handwritten invoice - ... Check
// especially: invoiceDate, totalAmount" (see direct-extractor.ts).
const HANDWRITTEN_PREFIX = 'Handwritten invoice';
const FIELD_LABELS: Record<string, string> = {
  vendorName: 'review.vendorName',
  vendorAddress: 'review.vendorAddress',
  vendorTaxId: 'review.taxId',
  invoiceNumber: 'review.invoiceNumber',
  invoiceDate: 'review.invoiceDate',
  subtotal: 'review.subtotal',
  taxAmount: 'review.taxAmount',
  totalAmount: 'review.totalAmount',
  currency: 'common.currency',
  items: 'review.lineItems'
};

/** The fields to check first on a handwritten reading (its warning comes last), or null for any other warning. */
function handwrittenFields(errorMessage: string | null): string[] | null {
  if (!errorMessage?.includes(HANDWRITTEN_PREFIX)) return null;
  const listed = errorMessage.split('Check especially:')[1];
  return listed ? listed.split(',').map((f) => f.trim()).filter(Boolean) : [];
}

// The backend's other reading warnings (direct-extractor.ts), joined with ". " when there are several.
const READING_WARNINGS: { match: RegExp; key: string }[] = [
  { match: /seems to hold (\d+) invoices/, key: 'review.severalInvoices' },
  { match: /Only the bank transfer in the file could be read/, key: 'review.transferOnly' },
  { match: /paid the other invoices of this file/, key: 'review.notInTransfer' },
  { match: /corrected to match the bank transfer/, key: 'review.paidAmountFitted' },
  { match: /do not match the bank transfer/, key: 'review.paidAmountDiffers' },
  { match: /items do not add up/, key: 'review.amountsUnchecked' }
];

/** Translation keys (with their {count}) of the warnings in the message; "amounts unchecked" when none is known. */
function readingWarnings(errorMessage: string): { key: string; count?: string }[] {
  const found = READING_WARNINGS.flatMap(({ match, key }) => {
    const hit = errorMessage.match(match);
    return hit ? [{ key, count: hit[1] }] : [];
  });
  return found.length || handwrittenFields(errorMessage) ? found : [{ key: 'review.amountsUnchecked' }];
}

export function ExpenseReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { formatDateTime } = useCountry();
  const isDesktop = useIsDesktop();
  const uploadState = location.state as { justUploaded?: boolean; fileParts?: string[] } | null;
  const justUploaded = Boolean(uploadState?.justUploaded);
  const fileParts = uploadState?.fileParts ?? [];

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
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>([]);
  // Purchase invoices: the next one waiting to be checked, so sending moves straight on to it.
  const [nextInvoiceId, setNextInvoiceId] = useState<string | null>(null);
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
        if (inv.expenseType !== 'MILEAGE') {
          getSupportedCurrencies()
            .then((r) => setSupportedCurrencies(r.supportedCurrencies))
            .catch(() => setSupportedCurrencies([]));
        }
        if (inv.expenseType === 'PURCHASE_INVOICE') {
          listExpenses({ module: 'PURCHASE_INVOICES', status: 'EXTRACTED', pageSize: 2 })
            .then((r) => setNextInvoiceId(r.expenses.find((other) => other.id !== inv.id)?.id ?? null))
            .catch(() => setNextInvoiceId(null));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('review.loadFailed')))
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

  // Restores the invoice as it was actually captured, before conversion —
  // a one-click alternative to manually retyping all four fields back.
  const useOriginalAmounts = () => {
    if (!expense) return;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            currency: expense.originalCurrency ?? prev.currency,
            subtotal: expense.originalSubtotal != null ? toAmountInput(expense.originalSubtotal) : prev.subtotal,
            discountAmount: expense.originalDiscountAmount != null ? toAmountInput(expense.originalDiscountAmount) : prev.discountAmount,
            taxAmount: expense.originalTaxAmount != null ? toAmountInput(expense.originalTaxAmount) : prev.taxAmount,
            totalAmount: expense.originalTotalAmount != null ? toAmountInput(expense.originalTotalAmount) : prev.totalAmount
          }
        : prev
    );
  };

  const isMileage = expense?.expenseType === 'MILEAGE';
  // Purchase invoices go through the same page, but are sent to accounting instead of approved.
  const isInvoice = expense?.expenseType === 'PURCHASE_INVOICE';
  const listPath = isInvoice ? '/invoices' : '/expenses';

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
      discountAmount: numberOrNull(form.discountAmount),
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
      setDistanceError(err instanceof Error ? err.message : t('common.couldNotCalculateDistance'));
    } finally {
      setCalculatingDistance(false);
    }
  };

  const retryCalculate = () => {
    if (!form) return;
    lastCalculatedRef.current = null;
    runCalculate(form.mileageFrom, form.mileageTo);
  };

  // Covers both "cancel" (a fresh upload you decide not to keep) and
  // "delete a draft" — same action, only reachable while isEditable, so a
  // SUBMITTED or APPROVED expense can never hit this.
  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm(t('review.confirmDelete'))) return;

    setSaving('delete');
    setError(null);
    try {
      await deleteExpense(id);
      navigate(listPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('review.deleteFailed'));
      setSaving(null);
    }
  };

  const handleSaveDraft = async () => {
    if (!id) return;
    const payload = buildPayload();
    if (!payload) return;

    setSaving('draft');
    setError(null);
    try {
      await updateExpense(id, payload);
      navigate(listPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('review.saveDraftFailed'));
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
      setError(err instanceof Error ? err.message : t('review.submitFailed'));
    } finally {
      setSaving(null);
    }
  };

  // Saves the edited fields, then hands the invoice to the accounting system
  // and moves on to the next one waiting to be checked.
  const handleSendToAccounting = async () => {
    if (!id) return;
    const payload = buildPayload();
    if (!payload) return;

    setSaving('send');
    setError(null);
    try {
      await updateExpense(id, payload);
      await sendInvoiceToAccounting(id);
      navigate(nextInvoiceId ? `/invoices/${nextInvoiceId}` : '/invoices');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invoices.sendFailed'));
      // The failure is stored on the invoice: reload to show it.
      load();
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
      setError(err instanceof Error ? err.message : t('review.approveFailed'));
      setSaving(null);
    }
  };

  const handleReject = async () => {
    if (!id) return;
    if (!rejectComment.trim()) {
      setError(t('review.rejectReasonRequired'));
      return;
    }
    setSaving('reject');
    setError(null);
    try {
      await decideExpense(id, 'reject', rejectComment.trim());
      navigate('/approvals');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('review.rejectFailed'));
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="list-loading">{t('review.loading')}</div>;
  }

  if (!expense || !form) {
    return (
      <div className="empty-state">
        <h3>{t('review.notFound')}</h3>
        <Link className="button-primary" to={listPath}>
          {t('review.backToExpenses')}
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
          <button
            className="button-outline button-danger action-bar-delete"
            disabled={saving !== null}
            onClick={handleDelete}
            type="button"
          >
            {saving === 'delete' ? t('common.deleting') : t('review.delete')}
          </button>
          <button className="button-outline" disabled={saving !== null} onClick={handleSaveDraft} type="button">
            {saving === 'draft' ? t('common.saving') : isInvoice ? t('common.save') : t('common.saveDraft')}
          </button>
          {isInvoice ? (
            <button
              className="button-primary"
              disabled={saving !== null || !hasAmount}
              onClick={handleSendToAccounting}
              type="button"
            >
              {saving === 'send'
                ? t('invoices.sending')
                : nextInvoiceId
                  ? t('invoices.sendAndNext')
                  : t('invoices.sendToAccounting')}
            </button>
          ) : (
            <button
              className="button-primary"
              disabled={saving !== null || !hasAmount}
              onClick={handleSubmitForApproval}
              type="button"
            >
              {saving === 'submit' ? t('common.submitting') : t('common.submitForApproval')}
            </button>
          )}
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
            {t('review.reject')}
          </button>
          <button className="button-primary" disabled={saving !== null} onClick={handleApprove} type="button">
            {saving === 'approve' ? t('review.approving') : t('review.approve')}
          </button>
        </div>
      )}

      {isMyApproval && showRejectBox && (
        <div className="reject-box">
          <label className="form-field form-field--wide">
            <span>{t('review.reasonForRejecting')}</span>
            <textarea
              rows={3}
              autoFocus
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder={t('review.rejectPlaceholder')}
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
              {t('common.cancel')}
            </button>
            <button
              className="button-primary button-danger-solid"
              disabled={saving !== null}
              onClick={handleReject}
              type="button"
            >
              {saving === 'reject' ? t('review.rejecting') : t('review.confirmRejection')}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const handwrittenCheck = handwrittenFields(expense.errorMessage);

  return (
    <div className="review-page">
      <div className="review-header">
        <Link className="back-link" to={listPath}>
          {isInvoice ? t('invoices.allInvoices') : t('review.allExpenses')}
        </Link>
        <StatusPill status={expense.status} />
      </div>

      {justUploaded && expense.status === 'EXTRACTED' && (
        <div className="alert alert-info">
          <span>{t('review.autoExtractedNotice')}</span>
        </div>
      )}

      {fileParts.length > 1 && fileParts.includes(expense.id) && (
        <div className="alert alert-info">
          <span>
            {t('review.splitNotice', { count: String(fileParts.length) })}{' '}
            {fileParts.map((partId, index) =>
              partId === expense.id ? (
                <strong key={partId}>{index + 1} </strong>
              ) : (
                <Link key={partId} to={`${listPath}/${partId}`} state={uploadState}>
                  {index + 1}{' '}
                </Link>
              )
            )}
          </span>
        </div>
      )}

      {expense.isDuplicate && (
        <div className="alert alert-warning">
          <span>{t('review.duplicateNotice')}</span>
        </div>
      )}

      {expense.status === 'EXTRACTED' && expense.errorMessage && (
        <div className="alert alert-warning">
          {readingWarnings(expense.errorMessage).map(({ key, count }) => (
            <span key={key}>{t(key, count ? { count } : undefined)} </span>
          ))}
          {handwrittenCheck && (
            <span>
              {t('review.handwrittenCheck')}
              {handwrittenCheck.length > 0 && (
                <>
                  {' '}
                  <strong>
                    {t('review.checkEspecially')} {handwrittenCheck.map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f)).join(', ')}
                  </strong>
                </>
              )}
            </span>
          )}
        </div>
      )}

      {expense.status === 'FAILED' && (
        <div className="alert alert-error">
          <span>
            {t('review.extractionFailed')}
            {expense.errorMessage ? `: ${expense.errorMessage}` : '.'} {t('review.extractionFailedManualHint')}
          </span>
        </div>
      )}

      {expense.status === 'SUBMITTED' && !isMyApproval && (
        <div className="alert alert-info">
          <span>
            {t('review.submitted')}
            {pendingApproval ? t('review.waitingOnApproval', { name: pendingApproval.approver.name }) : ''}.
          </span>
        </div>
      )}

      {expense.status === 'SUBMITTED' && isMyApproval && (
        <div className="alert alert-info">
          <span>{t('review.submittedForYou', { name: expense.uploader.name })}</span>
        </div>
      )}

      {expense.status === 'APPROVED' && lastDecision && (
        <div className="alert alert-success">
          <span>
            {t('review.approvedBy', { name: lastDecision.approver.name })}
            {lastDecision.decidedAt ? t('review.approvedOnDate', { date: formatDateTime(lastDecision.decidedAt) }) : ''}
            {lastDecision.comment ? t('review.approvedCommentQuote', { comment: lastDecision.comment }) : ''}.
          </span>
        </div>
      )}

      {expense.status === 'REJECTED' && lastDecision && (
        <div className="alert alert-error">
          <span>{t('review.rejectedBy', { name: lastDecision.approver.name, comment: lastDecision.comment ?? '' })}</span>
        </div>
      )}

      {expense.status === 'SENT' && (
        <div className="alert alert-success">
          <span>
            {t('invoices.sentOn', { date: formatDateTime(expense.sentToAccountingAt) })}
            {expense.accountingRef ? t('invoices.sentReference', { reference: expense.accountingRef }) : ''}.
          </span>
        </div>
      )}

      {expense.status !== 'SENT' && expense.accountingError && !error && (
        <div className="alert alert-warning">
          <span>{t('invoices.lastSendFailed', { error: expense.accountingError })}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {isMileage ? (
        <div className="detail-layout">
          {isDesktop && (
            <div className="detail-layout-aside">
              <RouteMap origin={routeQuery?.from ?? ''} destination={routeQuery?.to ?? ''} />
            </div>
          )}

          <div className="review-form">
            <fieldset className="review-fieldset" disabled={!isEditable}>
              <div className="form-section">
                <h3>{t('common.trip')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('common.date')}</span>
                    <DateInput value={form.mileageDate} onChange={(value) => updateField('mileageDate', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('common.from')}</span>
                    <LocationAutocompleteInput
                      key={expense.id}
                      defaultValue={form.mileageFrom}
                      onChange={(value) => updateField('mileageFrom', value)}
                      onPlaceSelected={(address) => runCalculate(address, form.mileageTo)}
                      placeholder={isGoogleMapsConfigured() ? t('common.startTypingAddress') : undefined}
                      disabled={!isEditable}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('common.to')}</span>
                    <LocationAutocompleteInput
                      key={expense.id}
                      defaultValue={form.mileageTo}
                      onChange={(value) => updateField('mileageTo', value)}
                      onPlaceSelected={(address) => runCalculate(form.mileageFrom, address)}
                      placeholder={isGoogleMapsConfigured() ? t('common.startTypingAddress') : undefined}
                      disabled={!isEditable}
                    />
                  </label>
                  <label className="form-field">
                    <span>
                      {t('common.distanceKm')}
                      {calculatingDistance ? t('common.calculatingSuffix') : ''}
                    </span>
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
                    <span>{t('common.roundTrip')}</span>
                  </label>
                </div>
                {distanceError && (
                  <div className="alert alert-error alert-inline">
                    <span>{distanceError}</span>
                    {form.mileageFrom.trim() && form.mileageTo.trim() && (
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
                    <Select
                      value={form.categoryId}
                      onChange={(value) => updateField('categoryId', value)}
                      options={[
                        { value: '', label: t('common.uncategorized') },
                        ...categories.map((cat) => ({ value: cat.id, label: cat.name }))
                      ]}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('review.totalCalculated')}</span>
                    <input
                      value={formatAmount(estimatedAmount ?? expense.totalAmount, expense.currency)}
                      disabled
                    />
                  </label>
                </div>
              </div>

              <div className="form-section">
                <label className="form-field form-field--wide">
                  <span>{t('common.notes')}</span>
                  <textarea dir="auto" rows={3} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
                </label>
              </div>
            </fieldset>

            {actionBar}
          </div>
        </div>
      ) : (
        <div className="detail-layout">
          <div className="detail-layout-aside">
            {!fileUrl ? (
              <span className="preview-loading">{t('review.loadingPreview')}</span>
            ) : expense.mimeType?.startsWith('image/') ? (
              <img src={fileUrl} alt="Invoice document" className="review-preview-image" />
            ) : (
              <a className="button-outline" href={fileUrl} target="_blank" rel="noreferrer">
                {t('review.openDocument')}
              </a>
            )}
          </div>

          <div className="review-form">
            <fieldset className="review-fieldset" disabled={!isEditable}>
              <div className="form-section">
                <h3>{t('review.vendorSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('review.vendorName')}</span>
                    <input dir="auto" value={form.vendorName} onChange={(e) => updateField('vendorName', e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('review.taxId')}</span>
                    <input value={form.vendorTaxId} onChange={(e) => updateField('vendorTaxId', e.target.value)} />
                  </label>
                  <label className="form-field form-field--wide">
                    <span>{t('review.vendorAddress')}</span>
                    <input
                      dir="auto"
                      value={form.vendorAddress}
                      onChange={(e) => updateField('vendorAddress', e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="form-section">
                <h3>{t('review.invoiceSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('review.invoiceNumber')}</span>
                    <input
                      dir="auto"
                      value={form.invoiceNumber}
                      onChange={(e) => updateField('invoiceNumber', e.target.value)}
                    />
                  </label>
                  {/* Expense categories are for reimbursement reports; the accounting system books purchase invoices itself. */}
                  {!isInvoice && (
                    <label className="form-field">
                      <span>{t('common.category')}</span>
                      <Select
                        value={form.categoryId}
                        onChange={(value) => updateField('categoryId', value)}
                        options={[
                          { value: '', label: t('common.uncategorized') },
                          ...categories.map((cat) => ({ value: cat.id, label: cat.name }))
                        ]}
                      />
                    </label>
                  )}
                  <label className="form-field">
                    <span>{t('review.invoiceDate')}</span>
                    <DateInput value={form.invoiceDate} onChange={(value) => updateField('invoiceDate', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('review.dueDate')}</span>
                    <DateInput value={form.dueDate} onChange={(value) => updateField('dueDate', value)} />
                  </label>
                </div>
              </div>

              <div className="form-section">
                <h3>{t('review.amountsSection')}</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>{t('review.subtotal')}</span>
                    <AmountInput value={form.subtotal} onChange={(value) => updateField('subtotal', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('review.discount')}</span>
                    <AmountInput value={form.discountAmount} onChange={(value) => updateField('discountAmount', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('review.taxRate')}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.taxRate}
                      onChange={(e) => updateField('taxRate', e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('review.taxAmount')}</span>
                    <AmountInput value={form.taxAmount} onChange={(value) => updateField('taxAmount', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('review.totalAmount')}</span>
                    <AmountInput value={form.totalAmount} onChange={(value) => updateField('totalAmount', value)} />
                  </label>
                  <label className="form-field">
                    <span>{t('common.currency')}</span>
                    <Select
                      value={form.currency}
                      onChange={(value) => updateField('currency', value)}
                      placeholder="—"
                      options={(form.currency && !supportedCurrencies.includes(form.currency)
                        ? [form.currency, ...supportedCurrencies]
                        : supportedCurrencies
                      ).map((code) => ({ value: code, label: code }))}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('review.paymentMethod')}</span>
                    <input
                      value={form.paymentMethod}
                      onChange={(e) => updateField('paymentMethod', e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('review.paymentTerms')}</span>
                    <input
                      value={form.paymentTerms}
                      onChange={(e) => updateField('paymentTerms', e.target.value)}
                    />
                  </label>
                </div>
                {expense.originalCurrency && expense.originalCurrency !== form.currency && (
                  <div className="alert alert-info alert-inline">
                    <span>
                      {t('review.originallyCaptured', {
                        amount: formatAmount(expense.originalTotalAmount, expense.originalCurrency, { withCode: false }),
                        currency: expense.originalCurrency
                      })}
                      {expense.exchangeRate
                        ? `${t('review.convertedAt', { rate: Number(expense.exchangeRate).toFixed(4) })}${
                            expense.exchangeRateDate
                              ? t('review.convertedOn', { date: expense.exchangeRateDate.slice(0, 10) })
                              : ''
                          })`
                        : ''}
                      .
                    </span>
                    {isEditable && (
                      <button className="alert-action" type="button" onClick={useOriginalAmounts}>
                        {t('review.useOriginal')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {expense.items.length > 0 && (
                <div className="form-section">
                  <h3>{t('review.lineItems')}</h3>
                  {/* A table doesn't fit a phone: there each item is a row of its own (description, qty × price, total). */}
                  {isDesktop ? (
                    <div className="invoice-table-wrap">
                      <table className="invoice-table invoice-table--compact">
                        <thead>
                          <tr>
                            <th>{t('table.description')}</th>
                            <th className="align-right">{t('table.qty')}</th>
                            <th className="align-right">{t('table.unitPrice')}</th>
                            <th className="align-right">{t('table.total')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expense.items.map((item) => (
                            <tr key={item.id}>
                              <td dir="auto">{item.description}</td>
                              <td className="align-right">{formatQuantity(item.quantity)}</td>
                              <td className="align-right">{formatAmount(item.unitPrice, expense.currency, { withCode: false })}</td>
                              <td className="align-right">{formatAmount(item.totalPrice, expense.currency, { withCode: false })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <ul className="line-item-list">
                      {expense.items.map((item) => (
                        <li key={item.id} className="line-item">
                          <span className="line-item-main">
                            <span className="line-item-description" dir="auto">
                              {item.description}
                            </span>
                            <span className="line-item-sub">
                              {formatQuantity(item.quantity)} × {formatAmount(item.unitPrice, expense.currency, { withCode: false })}
                            </span>
                          </span>
                          <span className="line-item-total">{formatAmount(item.totalPrice, expense.currency, { withCode: false })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="form-section">
                <label className="form-field form-field--wide">
                  <span>{t('common.notes')}</span>
                  <textarea dir="auto" rows={3} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
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
