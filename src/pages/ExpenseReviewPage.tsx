import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  decideExpense,
  deleteExpense,
  getCategories,
  getExpense,
  getExpenseFileBlobUrl,
  getFieldBoxes,
  getMileageRate,
  getReadingChecks,
  getSupportedCurrencies,
  listExpenses,
  moveFieldBox,
  previewMileageDistance,
  readBox,
  readRegion,
  removeFieldBox,
  sendInvoiceToAccounting,
  submitExpense,
  updateExpense
} from '../api';
import type { BoxReadReason, FieldBox, FieldBoxes, ReadingChecks, Region } from '../api';
import { Category, Expense } from '../types';
import { BoxTone, DocumentViewer } from '../components/DocumentViewer';
import { IconPickRegion } from '../components/icons';
import { StatusPill } from '../components/StatusPill';
import { useTemplateNoteText } from '../components/TemplateNote';
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
  { match: /far off the invoice total/, key: 'review.amountsFarOff' },
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

// Template-guided reading: the fields that have a box on the document and can
// be picked from it (backend/src/reading/fields.ts), with their labels.
const PICK_FIELDS = [
  'vendorName',
  'vendorTaxId',
  'vendorAddress',
  'invoiceNumber',
  'invoiceDate',
  'dueDate',
  'subtotal',
  'discountAmount',
  'taxAmount',
  'totalAmount'
] as const;
type PickField = (typeof PICK_FIELDS)[number];
const isPickField = (field: string): field is PickField => (PICK_FIELDS as readonly string[]).includes(field);
const AMOUNT_FIELDS: readonly PickField[] = ['subtotal', 'discountAmount', 'taxAmount', 'totalAmount'];
const BOX_LABELS: Record<PickField, string> = {
  vendorName: 'review.vendorName',
  vendorTaxId: 'review.taxId',
  vendorAddress: 'review.vendorAddress',
  invoiceNumber: 'review.invoiceNumber',
  invoiceDate: 'review.invoiceDate',
  dueDate: 'review.dueDate',
  subtotal: 'review.subtotal',
  discountAmount: 'review.discount',
  taxAmount: 'review.taxAmount',
  totalAmount: 'review.totalAmount'
};

/** One box per field: the one the user set wins over the one that was found. */
function boxOf(boxes: FieldBox[], field: string): FieldBox | undefined {
  return boxes.find((b) => b.field === field && b.source === 'USER') ?? boxes.find((b) => b.field === field);
}

/** Something on the reading to compare with the document ("Review now" steps through them). */
type Issue = { field: string; text: string };

/** After reading a box: the value filled in (with the one it replaced, for undo), or why there was none. */
type BoxNote =
  | { field: string; kind: 'filled'; previous: string | null }
  | { field: string; kind: BoxReadReason | 'aiEmpty' }
  /** Read with AI found something else in the box (a customer's name framed as the vendor address): fill only if the user says so. */
  | { field: string; kind: 'doubt'; looksLike: string; value: string | number };

/** What a box can turn out to hold ("Read with AI"), as shown to the user. */
const LOOKS_LIKE_LABELS: Record<string, string> = {
  vendorName: 'review.vendorName',
  vendorAddress: 'review.vendorAddress',
  vendorTaxId: 'review.taxId',
  customerName: 'review.looksLikeCustomerName',
  customerAddress: 'review.looksLikeCustomerAddress',
  invoiceNumber: 'review.invoiceNumber',
  date: 'review.looksLikeDate',
  amount: 'review.looksLikeAmount',
  phone: 'review.looksLikePhone',
  other: 'review.looksLikeOther'
};

/** Text compared loosely: Persian ي/ك and digits, joiners, spacing, case and punctuation don't count; one may hold the other. */
const looseText = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200d]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Whether the value in a template's box and the field's value say the same thing. */
function sameValue(field: string, boxValue: string | number, formValue: string): boolean {
  if (AMOUNT_FIELDS.includes(field as PickField)) return Math.abs(Number(boxValue) - Number(formValue)) < 0.005;
  if (field === 'invoiceDate' || field === 'dueDate') return String(boxValue) === formValue;
  const [a, b] = [looseText(String(boxValue)), looseText(formValue)];
  return a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)));
}

/** A field's state on the document, for its chip in the form. */
type FieldStatus = 'user' | 'model' | 'missing' | null;

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
  const templateNoteText = useTemplateNoteText();
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
  // Template-guided reading (Settings → Invoice reading): the document with a
  // box on each field where it was read, and "pick from photo". Off for the
  // classic reader, which keeps the plain preview.
  const [fieldBoxes, setFieldBoxes] = useState<FieldBoxes | null>(null);
  // Template-guided reading: per line item, quantity × price and the likely misread digit.
  const [readingChecks, setReadingChecks] = useState<ReadingChecks | null>(null);
  const [fixingLine, setFixingLine] = useState<number | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  /** Zooms the document into a field's box: set when a field is chosen in the form, not on the photo. */
  const [zoomRequest, setZoomRequest] = useState<{ field: string; n: number } | null>(null);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  /** Phone: the document panel shrunk to its toolbar. */
  const [viewerMinimized, setViewerMinimized] = useState(false);
  /** The field under the mouse (form or document): both light up. */
  const [hoverField, setHoverField] = useState<string | null>(null);
  /** Drawing a box for a field; a field's box is then read from the words inside it. */
  const [drawing, setDrawing] = useState<{ field: string } | null>(null);
  const [pickStatus, setPickStatus] = useState<'reading' | 'failed' | null>(null);
  const [boxNote, setBoxNote] = useState<BoxNote | null>(null);
  /** Template disagreements the user set aside for this invoice ("Ignore"). */
  const [ignoredTemplateFields, setIgnoredTemplateFields] = useState<Set<string>>(new Set());
  const [boxError, setBoxError] = useState(false);
  /** "Review now": the issue shown, or null before starting. */
  const [issueIndex, setIssueIndex] = useState<number | null>(null);
  /** Every field that had a value to place (with or without a box): one without a box is "not found". */
  const targetsRef = useRef<Set<string>>(new Set());
  const asideRef = useRef<HTMLDivElement | null>(null);

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

  // What reading a box said belongs to that field: gone when another one is chosen.
  useEffect(() => {
    setBoxNote((note) => (note && note.field === activeField ? note : null));
    setPickStatus((status) => (status === 'reading' ? status : null));
  }, [activeField]);

  // Esc leaves the enlarged document (a pick in progress is cancelled first).
  useEffect(() => {
    if (!viewerExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawing) {
        setDrawing(null);
        setPickStatus(null);
      } else setViewerExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerExpanded, drawing]);

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

  // The boxes are located on the first visit (a few seconds); the plain preview shows meanwhile.
  useEffect(() => {
    if (!id || !expense || expense.expenseType === 'MILEAGE') return;
    let cancelled = false;
    targetsRef.current = new Set();
    getFieldBoxes(id)
      .then((result) => {
        if (!cancelled) setBoxes(result);
      })
      .catch(() => {
        if (!cancelled) setFieldBoxes(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, expense?.expenseType]);

  // Asked again whenever the line items change (a suggestion used).
  useEffect(() => {
    if (!id || !expense || expense.expenseType === 'MILEAGE') return;
    let cancelled = false;
    getReadingChecks(id)
      .then((result) => {
        if (!cancelled) setReadingChecks(result.enabled ? result : null);
      })
      .catch(() => {
        if (!cancelled) setReadingChecks(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, expense?.expenseType, expense?.items]);

  /** Puts a suggested price on one line item; the rest of the form (maybe edited, not saved yet) is left alone. */
  const applyLinePrice = async (index: number, price: number) => {
    if (!expense) return;
    const number = (v: string | null) => (v === null ? null : Number(v));
    const items = expense.items.map((item, i) => {
      const line = { description: item.description, quantity: number(item.quantity), unitPrice: number(item.unitPrice), totalPrice: number(item.totalPrice), taxRate: number(item.taxRate) };
      if (i !== index) return line;
      // One piece: its unit price is the line's price too.
      return { ...line, totalPrice: price, unitPrice: line.quantity === null || line.quantity === 1 ? price : line.unitPrice };
    });
    setFixingLine(index);
    try {
      const updated = await updateExpense(expense.id, { items });
      setExpense((prev) => (prev ? { ...prev, items: updated.items } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('review.saveDraftFailed'));
    } finally {
      setFixingLine(null);
    }
  };

  /** Under a line item: what the checks say about its price, with one click to use a suggested one. */
  const lineCheck = (index: number) => {
    const check = readingChecks?.lines.find((l) => l.index === index);
    if (!check || !expense) return null;
    const money = (value: number) => formatAmount(value, expense.currency, { withCode: false });
    const use = (price: number) =>
      isEditable ? (
        <button className="alert-action" type="button" disabled={fixingLine !== null} onClick={() => void applyLinePrice(index, price)}>
          {t('review.usePrice', { amount: money(price) })}
        </button>
      ) : null;
    if (check.suggested !== undefined) {
      return (
        <span className="line-item-check">
          {t(check.level === 'confirmed' ? 'review.priceConfirmed' : 'review.priceMaybe', { amount: money(check.suggested) })}
          {use(check.suggested)}
        </span>
      );
    }
    if (check.quantityTimesPrice) {
      const q = check.quantityTimesPrice;
      return (
        <span className="line-item-check">
          {t('review.quantityTimesPrice', { quantity: String(q.quantity), unit: money(q.unitPrice), expected: money(q.expected) })}
          {use(q.expected)}
        </span>
      );
    }
    return check.compare ? <span className="line-item-check line-item-check--soft">{t('review.comparePrice')}</span> : null;
  };

  /** The boxes as they are now; fields that had a value to place are remembered, so one whose box is removed shows as not found. */
  const setBoxes = (result: FieldBoxes) => {
    for (const f of [...result.missing, ...result.boxes.map((b) => b.field)]) targetsRef.current.add(f);
    setFieldBoxes(result);
  };

  const updateBoxes = (boxes: FieldBox[]) => {
    for (const b of boxes) targetsRef.current.add(b.field);
    setFieldBoxes((prev) => (prev ? { ...prev, boxes } : prev));
  };

  const boxLabel = (field: string) => {
    const item = /^items\.(\d+)$/.exec(field);
    if (item) return t('review.lineN', { n: String(Number(item[1]) + 1) });
    return isPickField(field) ? t(BOX_LABELS[field]) : field;
  };

  const focusField = (field: string) => {
    document.getElementById(`field-${field}`)?.querySelector('input')?.focus();
  };

  /** A field chosen in the form: highlight its box and zoom the document into it. */
  const showField = (field: string) => {
    setActiveField(field);
    setZoomRequest((prev) => ({ field, n: (prev?.n ?? 0) + 1 }));
    // Phone: the document is pinned above the form, so keep the field just below it, not hidden under it.
    if (!isDesktop) {
      window.setTimeout(() => {
        const row = document.getElementById(field.startsWith('items.') ? `line-${field.slice(6)}` : `field-${field}`);
        const panel = asideRef.current;
        if (!row || !panel || viewerExpanded) return;
        const below = panel.getBoundingClientRect().bottom + 12;
        const top = row.getBoundingClientRect().top;
        if (top < below || top > window.innerHeight - 80) window.scrollBy({ top: top - below, behavior: 'smooth' });
      }, 80);
    }
  };

  /** The form row of a field (a form field or a line item), scrolled into view in the form. */
  const formRowOf = (field: string) => document.getElementById(field.startsWith('items.') ? `line-${field.slice(6)}` : `field-${field}`);

  const selectBox = (field: string) => {
    setActiveField(field);
    if (isPickField(field)) focusField(field);
    else formRowOf(field)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  /** Draw a box for a field (its value is then read from the words inside it). */
  const startDraw = (field: string) => {
    setDrawing({ field });
    setPickStatus(null);
    setBoxNote(null);
    showField(field);
    // A phone's document panel is small: drawing gets the whole screen.
    if (!isDesktop) {
      setViewerMinimized(false);
      setViewerExpanded(true);
    }
  };

  const cancelDraw = () => {
    setDrawing(null);
    setPickStatus(null);
  };

  /** Puts a value read from the document in the form, remembering the one it replaced (undo). */
  const fillField = (field: PickField, value: string | number) => {
    const next = AMOUNT_FIELDS.includes(field) ? toAmountInput(String(value)) : String(value);
    const previous = form?.[field] ?? '';
    updateField(field, next);
    setBoxNote({ field, kind: 'filled', previous: previous !== next ? previous : null });
  };

  /**
   * Reads a field's value from a box and puts it in the form; the box is kept as
   * the field's. From the words inside it (free), or with the vision model (`ai`).
   */
  const readBoxInto = async (field: PickField, page: number, region: Region, ai: boolean): Promise<boolean> => {
    if (!id) return false;
    setPickStatus('reading');
    setBoxNote(null);
    setFieldBoxes((prev) =>
      prev ? { ...prev, boxes: [...prev.boxes.filter((b) => !(b.source === 'USER' && b.field === field)), { field, source: 'USER', page, ...region, value: null }] } : prev
    );
    try {
      const result = ai ? await readRegion(id, { field, page, region }) : await readBox(id, { field, page, region });
      setFieldBoxes((prev) =>
        prev ? { ...prev, boxes: [...prev.boxes.filter((b) => !(b.source === 'USER' && b.field === field)), result.box] } : prev
      );
      setPickStatus(null);
      if (result.value === null || result.value === '') {
        setBoxNote({ field, kind: ai ? 'aiEmpty' : ((result as { reason?: BoxReadReason }).reason ?? 'empty') });
        return false;
      }
      const looksLike = (result as { looksLike?: string }).looksLike;
      if (looksLike) {
        setBoxNote({ field, kind: 'doubt', looksLike, value: result.value });
        return false;
      }
      fillField(field, result.value);
      return true;
    } catch {
      setPickStatus('failed');
      return false;
    }
  };

  /** The user moved, resized or drew a box: shown at once, then saved (no AI; the value stays). */
  const moveBox = useCallback(
    async (field: string, page: number, region: Region) => {
      if (!id) return;
      setBoxError(false);
      setFieldBoxes((prev) => {
        if (!prev) return prev;
        const value = prev.boxes.find((b) => b.field === field && b.source === 'USER')?.value ?? null;
        return { ...prev, boxes: [...prev.boxes.filter((b) => !(b.field === field && b.source === 'USER')), { field, source: 'USER', page, ...region, value }] };
      });
      try {
        updateBoxes((await moveFieldBox(id, field, page, region)).boxes);
      } catch {
        setBoxError(true);
        getFieldBoxes(id).then(setBoxes).catch(() => undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const handleDraw = async (page: number, region: Region) => {
    if (!drawing) return;
    const { field } = drawing;
    setDrawing(null);
    setActiveField(field);
    // Line items only get their box; a form field is read from it too.
    if (!isPickField(field)) {
      await moveBox(field, page, region);
      return;
    }
    // On a phone, back to the form where the value just landed (with nothing read, the document stays for "Read with AI").
    if ((await readBoxInto(field, page, region, false)) && !isDesktop) {
      setViewerExpanded(false);
      focusField(field);
    }
  };

  const removeBox = async (field: string) => {
    if (!id) return;
    setBoxError(false);
    try {
      updateBoxes((await removeFieldBox(id, field)).boxes);
    } catch {
      setBoxError(true);
    }
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
      const submitted = await submitExpense(id);
      navigate('/expenses', { state: { templateLearned: submitted.templateLearned } });
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
      const sent = await sendInvoiceToAccounting(id);
      // The next invoice (or the list) says what this one taught its vendor's template.
      navigate(nextInvoiceId ? `/invoices/${nextInvoiceId}` : '/invoices', { state: { templateLearned: sent.templateLearned } });
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

  const showViewer = Boolean(fieldBoxes?.enabled && fieldBoxes.pages.length);
  const boxes = fieldBoxes?.boxes ?? [];

  /** Where a field stands on the document: set by the user, found, not found (it has a value but no box), or nothing to place. */
  const fieldStatus = (field: string): FieldStatus => {
    const box = boxOf(boxes, field);
    if (box) return box.source === 'USER' ? 'user' : 'model';
    return targetsRef.current.has(field) ? 'missing' : null;
  };

  // "Review now": what the checks found, in the order of the form.
  const handwrittenIssueFields = (handwrittenFields(expense.errorMessage) ?? []).flatMap((f) =>
    f === 'items' ? expense.items.map((_, i) => `items.${i}`).slice(0, 1) : isPickField(f) ? [f] : []
  );
  // The vendor's template and the reading disagree: its box holds a value the field doesn't have (or the field is empty).
  const templateIssues = (fieldBoxes?.templateValues ?? []).flatMap(({ field, value, text }): (Issue & { use?: string | number })[] => {
    if (!isPickField(field) || ignoredTemplateFields.has(field) || !boxOf(boxes, field) || boxOf(boxes, field)?.source !== 'TEMPLATE') return [];
    const current = form[field].trim();
    const shown =
      value === null ? '' : AMOUNT_FIELDS.includes(field) ? formatAmount(Number(value), form.currency || null, { withCode: false }) : field === 'invoiceDate' || field === 'dueDate' ? (text ?? String(value)) : String(value);
    if (value === null || value === '') return current ? [] : [{ field, text: t('review.issueTemplateEmpty') }];
    if (!current) return [{ field, text: t('review.issueTemplateFill', { value: shown }), use: value }];
    return sameValue(field, value, current) ? [] : [{ field, text: t('review.issueTemplateDiffers', { value: shown }), use: value }];
  });
  const issues: Issue[] = [
    ...templateIssues,
    ...handwrittenIssueFields.map((field) => ({ field, text: t('review.issueHandwritten') })),
    ...(readingChecks?.lines ?? []).flatMap((line): Issue[] => {
      const field = `items.${line.index}`;
      if (line.suggested !== undefined) return [{ field, text: t('review.issuePrice') }];
      if (line.quantityTimesPrice) return [{ field, text: t('review.issueQuantity') }];
      return line.compare ? [{ field, text: t('review.issueCompare') }] : [];
    })
  ];
  const issueFields = new Set(issues.map((i) => i.field));
  const toneFor = (field: string): BoxTone => (issueFields.has(field) ? 'check' : fieldStatus(field) === 'user' ? 'user' : 'model');

  const goToIssue = (index: number) => {
    const issue = issues[index];
    if (!issue) return;
    setIssueIndex(index);
    showField(issue.field);
    formRowOf(issue.field)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  /** A small chip after a field's label: where the field stands on the document; "not found" offers to find it (AI). */
  const statusChip = (field: string) => {
    if (!showViewer) return null;
    if (issueFields.has(field)) {
      return (
        <button type="button" className="field-chip field-chip--check" onClick={(e) => (e.preventDefault(), showField(field))}>
          {t('review.chipCheck')}
        </button>
      );
    }
    const status = fieldStatus(field);
    if (status === 'missing') {
      return (
        <button
          type="button"
          className="field-chip field-chip--missing"
          title={isEditable ? t('review.drawBox') : undefined}
          onClick={(e) => {
            e.preventDefault();
            if (isEditable) startDraw(field);
            else showField(field);
          }}
        >
          {t('review.chipNotFound')}
        </button>
      );
    }
    // A box that is simply there (found, or set by the user) needs nothing: the document shows it when the field is chosen.
    return null;
  };

  // A field's label, with its chip and the "pick from photo" button when the document is shown with its boxes.
  const fieldLabel = (field: PickField, text: string) =>
    showViewer ? (
      <span className="field-label-row">
        <span>{text}</span>
        <span className="field-label-tools">
          {statusChip(field)}
          {isEditable && (
            <button
              type="button"
              className={`pick-button${drawing?.field === field ? ' pick-button--active' : ''}`}
              title={t('review.pickFromPhoto')}
              aria-label={`${t('review.pickFromPhoto')}: ${text}`}
              disabled={pickStatus === 'reading'}
              onClick={(e) => {
                e.preventDefault();
                if (drawing?.field === field) cancelDraw();
                else startDraw(field);
              }}
            >
              <IconPickRegion />
            </button>
          )}
        </span>
      </span>
    ) : (
      <span>{text}</span>
    );
  const linked = (field: string) => (hoverField === field || activeField === field ? ' form-field--linked' : '');
  const pickProps = (field: PickField) => ({
    id: `field-${field}`,
    onFocus: () => showField(field),
    onMouseEnter: () => setHoverField(field),
    onMouseLeave: () => setHoverField(null)
  });

  const activeBox = activeField ? boxOf(boxes, activeField) : undefined;
  const note = boxNote && boxNote.field === activeField ? boxNote : null;
  /** The line under the chosen field's name: what reading its box gave, or how to work with the box. */
  const activeTemplateIssue = activeField ? templateIssues.find((i) => i.field === activeField) : undefined;
  const doubtText = (note: Extract<BoxNote, { kind: 'doubt' }>) =>
    t('review.looksLikeNote', { what: t(LOOKS_LIKE_LABELS[note.looksLike] ?? 'review.looksLikeOther'), field: boxLabel(note.field) });
  /** Under a field: Read with AI found something else in its box; "Read anyway" fills it. */
  const doubtFor = (field: PickField) => {
    if (boxNote?.kind !== 'doubt' || boxNote.field !== field) return null;
    const note = boxNote;
    return (
      <span className="field-doubt" role="status">
        <span>{doubtText(note)}</span>
        <button
          type="button"
          className="field-doubt-action"
          onClick={(e) => {
            e.preventDefault();
            fillField(field, note.value);
          }}
        >
          {t('review.readAnyway')}
        </button>
        <button
          type="button"
          className="field-doubt-action field-doubt-action--quiet"
          onClick={(e) => {
            e.preventDefault();
            setBoxNote(null);
          }}
        >
          {t('common.cancel')}
        </button>
      </span>
    );
  };
  const selectionHint = (): ReactNode => {
    if (pickStatus === 'reading') return t('review.pickReading');
    if (pickStatus === 'failed') return t('review.pickFailed');
    if (note?.kind === 'filled') {
      return (
        <>
          {t('review.filledFromBox')}
          {note.previous !== null && isPickField(note.field) && (
            <button
              type="button"
              className="doc-selection-undo"
              onClick={() => {
                updateField(note.field as PickField, note.previous!);
                setBoxNote(null);
              }}
            >
              {t('review.undo')}
            </button>
          )}
        </>
      );
    }
    if (note?.kind === 'doubt') return doubtText(note);
    if (note) {
      return {
        empty: t('review.boxEmpty'),
        handwritten: t('review.boxHandwritten'),
        unavailable: t('review.boxUnavailable'),
        aiEmpty: t('review.pickNothing')
      }[note.kind];
    }
    if (activeTemplateIssue) return activeTemplateIssue.text;
    if (!activeBox) return t('review.notMarked');
    return isEditable ? t('review.boxEditHint') : '';
  };
  // Under the document's toolbar: the chosen field and what can be done with its box.
  const selectionBar =
    activeField && !drawing ? (
      <div className="doc-selection" role="group" aria-label={boxLabel(activeField)}>
        <span className={`doc-selection-dot doc-selection-dot--${activeBox ? toneFor(activeField) : 'missing'}`} aria-hidden="true" />
        <span className="doc-selection-label">
          <strong>{boxLabel(activeField)}</strong>
          <span
            className={
              (note && note.kind !== 'filled') || (!note && !pickStatus && activeTemplateIssue) ? 'doc-selection-warning' : note || pickStatus ? undefined : 'doc-selection-hint'
            }
            aria-live="polite"
          >
            {selectionHint()}
          </span>
        </span>
        <span className="doc-selection-actions">
          {isEditable && activeTemplateIssue && isPickField(activeField) && (
            <>
              {activeTemplateIssue.use !== undefined && (
                <button type="button" className="doc-action doc-action--primary" onClick={() => fillField(activeField, activeTemplateIssue.use!)}>
                  {t('review.useTemplateValue')}
                </button>
              )}
              <button type="button" className="doc-action" onClick={() => setIgnoredTemplateFields((prev) => new Set(prev).add(activeField))}>
                {t('review.ignoreTemplate')}
              </button>
            </>
          )}
          {isEditable && (
            <button type="button" className="doc-action" onClick={() => startDraw(activeField)}>
              {activeBox ? t('review.redrawBox') : t('review.drawBox')}
            </button>
          )}
          {isEditable && activeBox && isPickField(activeField) && (
            <>
              <button
                type="button"
                className="doc-action"
                disabled={pickStatus === 'reading'}
                title={t('review.readFromBoxHint')}
                onClick={() => void readBoxInto(activeField, activeBox.page, activeBox, false)}
              >
                {t('review.readFromBox')}
              </button>
              <button
                type="button"
                className="doc-action doc-action--ai"
                disabled={pickStatus === 'reading'}
                title={t('review.readValueHint')}
                onClick={() => void readBoxInto(activeField, activeBox.page, activeBox, true)}
              >
                {t('review.readValue')}
              </button>
            </>
          )}
          {isEditable && activeBox && (
            <button type="button" className="doc-action doc-action--danger" onClick={() => void removeBox(activeField)}>
              {t('review.removeBox')}
            </button>
          )}
          <button type="button" className="doc-action doc-action--icon" aria-label={t('review.collapseViewer')} title={t('review.collapseViewer')} onClick={() => setActiveField(null)}>
            ×
          </button>
        </span>
      </div>
    ) : null;

  /**
   * Enter moves to the next field or line item; ⌘+Enter on a Mac, Ctrl+Enter elsewhere (and Shift+Enter) to the previous one,
   * which zooms the document to it: checking an invoice field by field from the keyboard.
   */
  const moveOnEnter = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.altKey || e.nativeEvent.isComposing) return;
    const back = e.metaKey || e.ctrlKey || e.shiftKey;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
    const stops = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        '.review-fieldset input:not([type=checkbox]):not([type=hidden]):not(:disabled), .review-fieldset [data-review-stop]'
      )
    ).filter((el) => el.offsetParent !== null);
    const at = stops.indexOf(target);
    if (at < 0) return;
    // Caught on the way down, before a field's own Enter handling (the Shamsi date picker's).
    e.preventDefault();
    e.stopPropagation();
    const next = stops[at + (back ? -1 : 1)];
    if (!next) return;
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  };

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
  /** The reading's warnings as one line of text (shown small in the header next to the document). */
  const readingWarningText =
    expense.status === 'EXTRACTED' && expense.errorMessage
      ? [
          ...readingWarnings(expense.errorMessage).map(({ key, count }) => t(key, count ? { count } : undefined)),
          ...(handwrittenCheck
            ? [
                `${t('review.handwrittenCheck')}${
                  handwrittenCheck.length ? ` ${t('review.checkEspecially')} ${handwrittenCheck.map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f)).join(', ')}` : ''
                }`
              ]
            : [])
        ].join(' ')
      : '';

  /**
   * Every notice about this document, in order of importance: errors, then warnings,
   * then what happened (sent, approved…), then information. With the document beside
   * the form they are small pills on the header line, else full-width banners.
   */
  const notices: { key: string; tone: 'error' | 'warning' | 'success' | 'info'; text: string; content?: ReactNode }[] = [];
  if (error) notices.push({ key: 'error', tone: 'error', text: error });
  if (expense.status === 'FAILED') {
    notices.push({
      key: 'failed',
      tone: 'error',
      text: `${t('review.extractionFailed')}${expense.errorMessage ? `: ${expense.errorMessage}` : '.'} ${t('review.extractionFailedManualHint')}`
    });
  }
  if (expense.status === 'REJECTED' && lastDecision) {
    notices.push({ key: 'rejected', tone: 'error', text: t('review.rejectedBy', { name: lastDecision.approver.name, comment: lastDecision.comment ?? '' }) });
  }
  if (expense.status !== 'SENT' && expense.accountingError && !error) {
    notices.push({ key: 'sendFailed', tone: 'warning', text: t('invoices.lastSendFailed', { error: expense.accountingError }) });
  }
  if (expense.isDuplicate) notices.push({ key: 'duplicate', tone: 'warning', text: t('review.duplicateNotice') });
  if (readingWarningText) notices.push({ key: 'reading', tone: 'warning', text: `⚠ ${readingWarningText}` });
  if (expense.status === 'SENT') {
    notices.push({
      key: 'sent',
      tone: 'success',
      text: `${t('invoices.sentOn', { date: formatDateTime(expense.sentToAccountingAt) })}${
        expense.accountingRef ? t('invoices.sentReference', { reference: expense.accountingRef }) : ''
      }.`
    });
  }
  if (expense.status === 'APPROVED' && lastDecision) {
    notices.push({
      key: 'approved',
      tone: 'success',
      text: `${t('review.approvedBy', { name: lastDecision.approver.name })}${
        lastDecision.decidedAt ? t('review.approvedOnDate', { date: formatDateTime(lastDecision.decidedAt) }) : ''
      }${lastDecision.comment ? t('review.approvedCommentQuote', { comment: lastDecision.comment }) : ''}.`
    });
  }
  if (templateNoteText) notices.push({ key: 'template', tone: 'success', text: templateNoteText });
  if (expense.status === 'SUBMITTED') {
    notices.push({
      key: 'submitted',
      tone: 'info',
      text: isMyApproval
        ? t('review.submittedForYou', { name: expense.uploader.name })
        : `${t('review.submitted')}${pendingApproval ? t('review.waitingOnApproval', { name: pendingApproval.approver.name }) : ''}.`
    });
  }
  if (fileParts.length > 1 && fileParts.includes(expense.id)) {
    notices.push({
      key: 'split',
      tone: 'info',
      text: t('review.splitNotice', { count: String(fileParts.length) }),
      content: (
        <>
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
        </>
      )
    });
  }
  // Just uploaded and nothing to warn about: the fields were read automatically.
  if (justUploaded && expense.status === 'EXTRACTED' && !readingWarningText) {
    notices.push({ key: 'auto', tone: 'info', text: `ⓘ ${t('review.autoExtractedNotice')}` });
  }

  return (
    <div className="review-page">
      {/* With the document: one compact line (back, vendor and facts, status), so the form starts higher. */}
      <div className={`review-header${showViewer ? ' review-header--compact' : ''}`}>
        <Link className="back-link" to={listPath}>
          {isInvoice ? t('invoices.allInvoices') : t('review.allExpenses')}
        </Link>
        {showViewer && (
          <div className="review-title">
            <h1 dir="auto">{form.vendorName.trim() || t('review.untitled')}</h1>
            <span className="review-title-facts">
              {form.totalAmount.trim() && <strong>{formatAmount(form.totalAmount.replace(/,/g, ''), form.currency || null)}</strong>}
              {form.invoiceNumber.trim() && <span dir="auto">#{form.invoiceNumber.trim()}</span>}
              {expense.items.length > 0 && <span>{t('review.lineCount', { count: String(expense.items.length) })}</span>}
            </span>
            {/* Every notice, small, on the same line; the whole text on hover (wraps on a phone). */}
            {notices.map((n) => (
              <span key={n.key} className={`review-title-warning review-title-warning--${n.tone}`} title={n.text} role="note">
                {n.content ?? n.text}
              </span>
            ))}
          </div>
        )}
        <StatusPill status={expense.status} />
      </div>

      {/* Without the document beside the form: the same notices as full-width banners. */}
      {!showViewer &&
        notices.map((n) => (
          <div key={n.key} className={`alert alert-${n.tone}`} role="status">
            <span>{n.content ?? n.text}</span>
          </div>
        ))}

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
        <div className={showViewer ? 'review-workspace' : 'detail-layout'}>
          {showViewer && fieldBoxes ? (
            <div
              className={`review-workspace-doc${viewerExpanded ? ' review-workspace-doc--expanded' : ''}${viewerMinimized && !viewerExpanded ? ' review-workspace-doc--minimized' : ''}`}
              ref={asideRef}
            >
              {drawing && (
                <div className="pick-banner" role="status">
                  <span>{t('review.pickHint', { field: boxLabel(drawing.field) })}</span>
                  <button type="button" onClick={cancelDraw}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
              <DocumentViewer
                expenseId={expense.id}
                pages={fieldBoxes.pages}
                boxes={fieldBoxes.boxes}
                activeField={activeField}
                hoverField={hoverField}
                zoomRequest={zoomRequest}
                expanded={viewerExpanded}
                onToggleExpanded={() => setViewerExpanded((v) => !v)}
                minimized={viewerMinimized}
                onToggleMinimized={isDesktop ? undefined : () => setViewerMinimized((v) => !v)}
                drawing={Boolean(drawing)}
                onDraw={handleDraw}
                editable={isEditable}
                onMoveBox={moveBox}
                onSelectField={selectBox}
                onHoverField={setHoverField}
                labelFor={boxLabel}
                toneFor={toneFor}
                selectionBar={selectionBar}
              />
              {!viewerMinimized && (
                <>
                  {fieldBoxes.template && (
                    <p className="viewer-note viewer-note--template">
                      {t(
                        fieldBoxes.template.matchedBy !== 'vendor'
                          ? 'review.boxesFromSameForm'
                          : fieldBoxes.template.shared
                            ? 'review.boxesFromSharedTemplate'
                            : 'review.boxesFromTemplate',
                        {
                          vendor: fieldBoxes.template.vendorName?.trim() || t('review.untitled')
                        }
                      )}
                    </p>
                  )}
                  {boxError && <p className="viewer-note viewer-note--warning">{t('review.boxSaveFailed')}</p>}
                  {fieldBoxes.error && <p className="viewer-note">{t('review.boxesFailed')}</p>}
                  {fieldBoxes.lowResolutionDpi && (
                    <p className="viewer-note viewer-note--warning">{t('review.lowResolution', { dpi: String(fieldBoxes.lowResolutionDpi) })}</p>
                  )}
                </>
              )}
            </div>
          ) : (
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
          )}

          <div className={`review-form${showViewer ? ' review-workspace-form' : ''}`} onKeyDownCapture={showViewer ? moveOnEnter : undefined}>
            {showViewer && issues.length > 0 && (
              <div className="review-guide" role="region" aria-label={t('review.issuesCount', { count: String(issues.length) })}>
                <span className="review-guide-icon" aria-hidden="true">
                  !
                </span>
                <span className="review-guide-text">
                  <strong>{t('review.issuesCount', { count: String(issues.length) })}</strong>
                  {issueIndex !== null && issues[issueIndex] && (
                    <span>
                      {boxLabel(issues[issueIndex].field)}: {issues[issueIndex].text}
                    </span>
                  )}
                </span>
                {issueIndex === null ? (
                  <button type="button" className="review-guide-start" onClick={() => goToIssue(0)}>
                    {t('review.reviewNow')}
                  </button>
                ) : (
                  <span className="review-guide-steps">
                    <button type="button" aria-label={t('review.previousIssue')} disabled={issueIndex === 0} onClick={() => goToIssue(issueIndex - 1)}>
                      ‹
                    </button>
                    <span>{t('review.issueOf', { n: String(issueIndex + 1), count: String(issues.length) })}</span>
                    <button
                      type="button"
                      aria-label={t('review.nextIssue')}
                      disabled={issueIndex >= issues.length - 1}
                      onClick={() => goToIssue(issueIndex + 1)}
                    >
                      ›
                    </button>
                  </span>
                )}
              </div>
            )}
            <fieldset className="review-fieldset" disabled={!isEditable}>
              <div className="form-section">
                <h3>{t('review.vendorSection')}</h3>
                <div className="form-grid">
                  <label className={`form-field${linked('vendorName')}`} {...pickProps('vendorName')}>
                    {fieldLabel('vendorName', t('review.vendorName'))}
                    <input dir="auto" value={form.vendorName} onChange={(e) => updateField('vendorName', e.target.value)} />
                    {doubtFor('vendorName')}
                  </label>
                  <label className={`form-field${linked('vendorTaxId')}`} {...pickProps('vendorTaxId')}>
                    {fieldLabel('vendorTaxId', t('review.taxId'))}
                    <input value={form.vendorTaxId} onChange={(e) => updateField('vendorTaxId', e.target.value)} />
                    {doubtFor('vendorTaxId')}
                  </label>
                  <label className={`form-field form-field--wide${linked('vendorAddress')}`} {...pickProps('vendorAddress')}>
                    {fieldLabel('vendorAddress', t('review.vendorAddress'))}
                    <input
                      dir="auto"
                      value={form.vendorAddress}
                      onChange={(e) => updateField('vendorAddress', e.target.value)}
                    />
                    {doubtFor('vendorAddress')}
                  </label>
                </div>
              </div>

              <div className="form-section">
                <h3>{t('review.invoiceSection')}</h3>
                <div className="form-grid">
                  <label className={`form-field${linked('invoiceNumber')}`} {...pickProps('invoiceNumber')}>
                    {fieldLabel('invoiceNumber', t('review.invoiceNumber'))}
                    <input
                      dir="auto"
                      value={form.invoiceNumber}
                      onChange={(e) => updateField('invoiceNumber', e.target.value)}
                    />
                    {doubtFor('invoiceNumber')}
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
                  <label className={`form-field${linked('invoiceDate')}`} {...pickProps('invoiceDate')}>
                    {fieldLabel('invoiceDate', t('review.invoiceDate'))}
                    <DateInput value={form.invoiceDate} onChange={(value) => updateField('invoiceDate', value)} />
                    {doubtFor('invoiceDate')}
                  </label>
                  <label className={`form-field${linked('dueDate')}`} {...pickProps('dueDate')}>
                    {fieldLabel('dueDate', t('review.dueDate'))}
                    <DateInput value={form.dueDate} onChange={(value) => updateField('dueDate', value)} />
                    {doubtFor('dueDate')}
                  </label>
                </div>
              </div>

              <div className="form-section">
                <h3>{t('review.amountsSection')}</h3>
                <div className="form-grid">
                  <label className={`form-field${linked('subtotal')}`} {...pickProps('subtotal')}>
                    {fieldLabel('subtotal', t('review.subtotal'))}
                    <AmountInput value={form.subtotal} onChange={(value) => updateField('subtotal', value)} />
                    {doubtFor('subtotal')}
                  </label>
                  <label className={`form-field${linked('discountAmount')}`} {...pickProps('discountAmount')}>
                    {fieldLabel('discountAmount', t('review.discount'))}
                    <AmountInput value={form.discountAmount} onChange={(value) => updateField('discountAmount', value)} />
                    {doubtFor('discountAmount')}
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
                  <label className={`form-field${linked('taxAmount')}`} {...pickProps('taxAmount')}>
                    {fieldLabel('taxAmount', t('review.taxAmount'))}
                    <AmountInput value={form.taxAmount} onChange={(value) => updateField('taxAmount', value)} />
                    {doubtFor('taxAmount')}
                  </label>
                  <label className={`form-field${linked('totalAmount')}`} {...pickProps('totalAmount')}>
                    {fieldLabel('totalAmount', t('review.totalAmount'))}
                    <AmountInput value={form.totalAmount} onChange={(value) => updateField('totalAmount', value)} />
                    {doubtFor('totalAmount')}
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
                  {readingChecks?.smallImage && readingChecks.lines.length > 0 && <p className="viewer-note">{t('review.smallPhoto')}</p>}
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
                          {expense.items.map((item, index) => (
                            <tr
                              key={item.id}
                              id={`line-${index}`}
                              tabIndex={showViewer ? 0 : undefined}
                              data-review-stop={showViewer ? '' : undefined}
                              onFocus={showViewer ? () => showField(`items.${index}`) : undefined}
                              className={linked(`items.${index}`).trim()}
                              onMouseEnter={() => setHoverField(`items.${index}`)}
                              onMouseLeave={() => setHoverField(null)}
                              onClick={() => showField(`items.${index}`)}
                            >
                              <td dir="auto">
                                {item.description}
                                {showViewer && <span className="line-item-chip">{statusChip(`items.${index}`)}</span>}
                                {lineCheck(index)}
                              </td>
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
                      {expense.items.map((item, index) => (
                        <li
                          key={item.id}
                          id={`line-${index}`}
                          tabIndex={showViewer ? 0 : undefined}
                          data-review-stop={showViewer ? '' : undefined}
                          className={`line-item${linked(`items.${index}`)}`}
                          onClick={() => showField(`items.${index}`)}
                        >
                          <span className="line-item-main">
                            <span className="line-item-description" dir="auto">
                              {item.description}
                            </span>
                            {showViewer && <span className="line-item-chip">{statusChip(`items.${index}`)}</span>}
                            <span className="line-item-sub">
                              {formatQuantity(item.quantity)} × {formatAmount(item.unitPrice, expense.currency, { withCode: false })}
                            </span>
                            {lineCheck(index)}
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
