import { randomUUID } from 'crypto';
import { AppModule, ExpenseStatus, ExpenseType, Prisma, Role } from '@prisma/client';
import { NotFoundError, BadRequestError, ForbiddenError } from '../shared/errors';
import { toCsv } from '../shared/csv';
import { SUPPORTED_LANGUAGES } from '../shared/languages';
import { currenciesFor, getCountryProfile } from '../countries/registry';
import { canApprove, canHandlePurchaseInvoices } from '../auth/permissions';
import { MODULE_NAMES, moduleOf } from '../organization/modules';
import { AccountingConnector, AccountingInvoice } from '../accounting/ports';
import { getAccountingConnector } from '../accounting/registry';
import { getCurrencyConverter } from '../currency/registry';
import { expensesRepository as prismaExpensesRepository, ExpensesRepository, LineItemInput } from './expenses.repository';
import {
  ApproverResolver,
  CurrencyConverter,
  DistanceCalculator,
  ExtractedInvoiceData,
  ExtractOptions,
  FileStorage,
  InvoiceExtractor,
  UploadedFile
} from './ports';
import { CreateMileageInput, ListExpensesQuery, UpdateExpenseInput } from './expenses.schema';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type Actor = { userId: string; role: Role };

type AccessCheck = { expenseType: ExpenseType; uploadedBy: string; approvals: { approverId: string }[] };

// Purchase invoices are the organization's, not one person's: every
// accountant (and admin) sees and edits all of them. For expenses, admins see
// everything in the org; everyone else only sees expenses they submitted, or
// ones routed to them as an approver (current or past step).
function canView(expense: AccessCheck, actor: Actor): boolean {
  if (expense.expenseType === 'PURCHASE_INVOICE') return canHandlePurchaseInvoices(actor.role);
  if (actor.role === 'ADMIN') return true;
  if (expense.uploadedBy === actor.userId) return true;
  return expense.approvals.some((a) => a.approverId === actor.userId);
}

// Only the submitter (or an admin) may edit or submit — an approver reviews,
// they don't get to change the numbers they're approving.
function canEdit(expense: Omit<AccessCheck, 'approvals'>, actor: Actor): boolean {
  if (expense.expenseType === 'PURCHASE_INVOICE') return canHandlePurchaseInvoices(actor.role);
  return actor.role === 'ADMIN' || expense.uploadedBy === actor.userId;
}

const num = (value: Prisma.Decimal | null): number | null => (value == null ? null : Number(value));

/** What there is to upload: an employee's receipt, or a purchase invoice for the accountant. */
export type UploadOptions = Omit<ExtractOptions, 'country'> & { expenseType?: 'RECEIPT' | 'PURCHASE_INVOICE' };

type Deps = {
  extractor: InvoiceExtractor;
  fileStorage: FileStorage;
  approverResolver: ApproverResolver;
  distanceCalculator: DistanceCalculator;
  /** Prisma by default; tests pass a fake. */
  expensesRepository?: ExpensesRepository;
  /** The organization's accounting system, by its connector id (see accounting/registry.ts). */
  accountingConnectorFor?: (id: string) => AccountingConnector;
  /** The organization's exchange-rate source, by its id (see currency/registry.ts). */
  currencyConverterFor?: (id: string) => CurrencyConverter;
};

// mileageDistanceKm always stores the one-way distance; the round-trip factor
// is applied here, at the single point where totalAmount is derived, so an
// edit can never accidentally double- (or halve-) count it.
function computeMileageTotal(distanceKm: number, roundTrip: boolean, ratePerKm: number): number {
  return (roundTrip ? distanceKm * 2 : distanceKm) * ratePerKm;
}

export function createExpensesService({
  extractor,
  fileStorage,
  approverResolver,
  distanceCalculator,
  expensesRepository = prismaExpensesRepository,
  accountingConnectorFor = getAccountingConnector,
  currencyConverterFor = getCurrencyConverter
}: Deps) {
  // The calculator throws plain Errors (not set up, no route found, etc.) —
  // rethrow as BadRequestError so the real message reaches the client instead
  // of being masked as a 500 by the global error handler.
  async function resolveDistance(from: string, to: string) {
    try {
      return await distanceCalculator.getDistance(from, to);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Could not calculate distance');
    }
  }

  // Switched off in Settings = refused here too, not only hidden in the UI.
  async function requireModule(organizationId: string, module: AppModule) {
    const modules = await expensesRepository.getOrganizationModules(organizationId);
    if (!modules.includes(module)) throw new ForbiddenError(`${MODULE_NAMES[module]} are not enabled for your organization`);
  }

  async function requireInvoiceAccess(organizationId: string, actor: Actor) {
    await requireModule(organizationId, 'PURCHASE_INVOICES');
    if (!canHandlePurchaseInvoices(actor.role)) throw new ForbiddenError('Only accountants can handle purchase invoices');
  }

  return {
    async uploadAndExtract(organizationId: string, actor: Actor, file: UploadedFile, options: UploadOptions = {}) {
      const { expenseType = 'RECEIPT', ...extractOptions } = options;
      if (expenseType === 'PURCHASE_INVOICE') await requireInvoiceAccess(organizationId, actor);
      else await requireModule(organizationId, 'EXPENSES');

      const expenseId = randomUUID();
      const relativePath = await fileStorage.save({ organizationId, expenseId, file });

      // The country decides the prompt rules, the calendar dates are read in,
      // and whether "handwritten" applies at all.
      const country = getCountryProfile(await expensesRepository.getOrganizationCountry(organizationId));

      let extraction: Awaited<ReturnType<InvoiceExtractor['extract']>> | null = null;
      let errorMessage: string | null = null;
      try {
        extraction = await extractor.extract(file, { ...extractOptions, country });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Extraction failed';
      }

      // One file can hold several invoices (a scanner app's PDF of a few
      // receipts): each becomes an expense of its own, sharing the file.
      const saveReading = async (id: string, data: ExtractedInvoiceData | undefined, errorMessage: string | null, raw: unknown) => {
        const status: ExpenseStatus = data ? 'EXTRACTED' : 'FAILED';

        // Always checked against the raw extracted amount, before any currency
        // conversion below — otherwise day-to-day FX rate drift would make two
        // uploads of the identical invoice silently stop matching as duplicates.
        const duplicate = data
          ? await expensesRepository.findPotentialDuplicate(organizationId, {
              vendorName: data.vendorName,
              invoiceNumber: data.invoiceNumber,
              totalAmount: data.totalAmount ?? null
            })
          : null;

        // Convert into the org's default currency if the extracted currency
        // differs. originalCurrency/original*/exchangeRate* are written once
        // here and never touched again — see the comment on update() for why
        // later edits don't retrigger this. A conversion failure (FX API down,
        // unsupported currency) never blocks the upload; the expense is simply
        // saved with its original currency untouched.
        let currency = data?.currency ?? null;
        let subtotal = data?.subtotal ?? null;
        let discountAmount = data?.discount ?? null;
        let taxAmount = data?.taxAmount ?? null;
        let totalAmount = data?.totalAmount ?? null;
        let originalCurrency: string | null = null;
        let originalSubtotal: number | null = null;
        let originalDiscountAmount: number | null = null;
        let originalTaxAmount: number | null = null;
        let originalTotalAmount: number | null = null;
        let exchangeRate: number | null = null;
        let exchangeRateDate: Date | null = null;

        if (data?.currency) {
          const defaultCurrency = await expensesRepository.getOrganizationDefaultCurrency(organizationId);
          if (data.currency !== defaultCurrency) {
            try {
              // Rate as of the invoice's own date, not today's — uploading a
              // few days late shouldn't apply today's rate to an older purchase.
              // Falls back to today's rate if the date couldn't be extracted.
              const invoiceDate = toDate(data.invoiceDate) ?? undefined;
              const converter = currencyConverterFor(await expensesRepository.getOrganizationCurrencyConverter(organizationId));
              const { rate, asOf } = await converter.getRate(data.currency, defaultCurrency, invoiceDate);
              originalCurrency = data.currency;
              originalSubtotal = data.subtotal;
              originalDiscountAmount = data.discount ?? null;
              originalTaxAmount = data.taxAmount;
              originalTotalAmount = data.totalAmount;
              currency = defaultCurrency;
              subtotal = data.subtotal != null ? data.subtotal * rate : null;
              discountAmount = data.discount != null ? data.discount * rate : null;
              taxAmount = data.taxAmount != null ? data.taxAmount * rate : null;
              totalAmount = data.totalAmount != null ? data.totalAmount * rate : null;
              exchangeRate = rate;
              exchangeRateDate = asOf;
            } catch {
              // Keep the original currency/amounts as extracted.
            }
          }
        }

        const items: LineItemInput[] = (data?.items ?? []).map((item) => ({
          description: item.description,
          quantity: item.quantity ?? null,
          unitPrice: item.unitPrice ?? null,
          totalPrice: item.totalPrice ?? null,
          taxRate: item.taxRate ?? null
        }));

        return expensesRepository.create({
          id,
          organizationId,
          uploadedBy: actor.userId,
          expenseType,
          filePath: relativePath,
          mimeType: file.mimetype,
          fileSizeB: file.size,
          status,
          invoiceNumber: data?.invoiceNumber ?? null,
          invoiceDate: toDate(data?.invoiceDate),
          dueDate: toDate(data?.dueDate),
          vendorName: data?.vendorName ?? null,
          vendorAddress: data?.vendorAddress ?? null,
          vendorTaxId: data?.vendorTaxId ?? null,
          customerName: data?.customerName ?? null,
          customerAddress: data?.customerAddress ?? null,
          subtotal,
          discountAmount,
          taxRate: data?.taxRate ?? null,
          taxAmount,
          totalAmount,
          currency,
          paymentMethod: data?.paymentMethod ?? null,
          paymentTerms: data?.paymentTerms ?? null,
          notes: data?.notes ?? null,
          originalCurrency,
          originalSubtotal,
          originalDiscountAmount,
          originalTaxAmount,
          originalTotalAmount,
          exchangeRate,
          exchangeRateDate,
          isDuplicate: Boolean(duplicate),
          duplicateOfId: duplicate?.id ?? null,
          rawExtraction: raw != null ? (raw as Prisma.InputJsonValue) : undefined,
          errorMessage,
          items
        });
      };

      const first = await saveReading(
        expenseId,
        extraction?.success ? extraction.data : undefined,
        errorMessage ?? extraction?.error ?? null,
        extraction?.raw
      );
      const alsoCreated: string[] = [];
      for (const part of extraction?.success ? extraction.more ?? [] : []) {
        alsoCreated.push((await saveReading(randomUUID(), part.data, part.error ?? null, part.raw)).id);
      }
      return { ...first, alsoCreated };
    },

    async createMileageExpense(organizationId: string, userId: string, input: CreateMileageInput) {
      await requireModule(organizationId, 'EXPENSES');
      // Mileage never has a foreign-currency source to convert from — the
      // rate-per-km is already denominated in whatever the org's default
      // currency is, so the expense is simply tagged with it directly.
      const currency = await expensesRepository.getOrganizationDefaultCurrency(organizationId);

      let distanceKm: number | null = input.distanceKm ?? null;
      if (distanceKm == null && input.from && input.to) {
        distanceKm = (await resolveDistance(input.from, input.to)).distanceKm;
      }

      let totalAmount: number | null = null;
      if (distanceKm != null) {
        const ratePerKm = await expensesRepository.getOrganizationMileageRate(organizationId);
        totalAmount = computeMileageTotal(distanceKm, input.roundTrip, ratePerKm);
      }

      return expensesRepository.create({
        id: randomUUID(),
        organizationId,
        uploadedBy: userId,
        expenseType: 'MILEAGE',
        status: 'EXTRACTED',
        mileageDate: input.date,
        mileageFrom: input.from ?? null,
        mileageTo: input.to ?? null,
        mileageDistanceKm: distanceKm,
        mileageRoundTrip: input.roundTrip,
        totalAmount,
        currency,
        categoryId: input.categoryId ?? null,
        notes: input.notes ?? null,
        isDuplicate: false,
        items: []
      });
    },

    getDistancePreview(from: string, to: string) {
      return resolveDistance(from, to);
    },

    // Lets the frontend show a live "this trip will reimburse ~X" estimate
    // before saving — the actual totalAmount is still always recomputed
    // server-side from this same rate, never trusted from the client.
    async getMileageRate(organizationId: string) {
      return { ratePerKm: await expensesRepository.getOrganizationMileageRate(organizationId) };
    },

    // Any authenticated user can read this (not admin-gated) — same reasoning
    // as getMileageRate: it's org policy someone needs to know to fill out a
    // form, not a setting they can change from here.
    async getSupportedCurrencies(organizationId: string) {
      const [defaultCurrency, country] = await Promise.all([
        expensesRepository.getOrganizationDefaultCurrency(organizationId),
        expensesRepository.getOrganizationCountry(organizationId)
      ]);
      return { defaultCurrency, supportedCurrencies: currenciesFor(getCountryProfile(country)) };
    },

    // Same reasoning again — the UI language is org policy anyone logged in
    // needs to read, not something they change from this endpoint.
    async getSupportedLanguages(organizationId: string) {
      return {
        defaultLanguage: await expensesRepository.getOrganizationDefaultLanguage(organizationId),
        supportedLanguages: SUPPORTED_LANGUAGES
      };
    },

    // Purchase invoices are shared by the accountants; expenses are each person's own (all of them for admins).
    async list(organizationId: string, filters: ListExpensesQuery, actor: Actor) {
      if (filters.module === 'PURCHASE_INVOICES') await requireInvoiceAccess(organizationId, actor);
      const shared = filters.module === 'PURCHASE_INVOICES' || actor.role === 'ADMIN';
      const scoped = shared ? filters : { ...filters, uploadedBy: actor.userId };
      const [expenses, total] = await expensesRepository.list(organizationId, scoped);
      return { expenses, total, page: filters.page, pageSize: filters.pageSize };
    },

    async getById(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      return expense;
    },

    async getFile(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      if (!expense.filePath || !expense.mimeType) throw new NotFoundError('This expense has no document attached');
      const buffer = await fileStorage.read(expense.filePath);
      return { buffer, mimeType: expense.mimeType };
    },

    // Pure field edits — no status transitions here. Every status change has
    // its own dedicated action (submit/approve/reject) so there's exactly one
    // way to move an expense forward, not an ambiguous status field on PATCH.
    async update(organizationId: string, id: string, patch: UpdateExpenseInput, actor: Actor) {
      const existing = await expensesRepository.findById(organizationId, id);
      if (!existing || !canView(existing, actor)) throw new NotFoundError('Expense not found');
      if (!canEdit(existing, actor)) {
        throw new BadRequestError('Only the person who submitted this expense can edit it');
      }
      if (existing.status === 'SENT') {
        throw new BadRequestError('This invoice has already been sent to accounting');
      }

      const { items, ...fields } = patch;

      // Deliberate asymmetry with the mileage block below: currency
      // conversion only ever happens once, automatically, at receipt
      // extraction time (see uploadAndExtract). Editing currency/totalAmount/
      // subtotal/taxAmount here afterward is a plain manual field edit like
      // any other receipt field — it does NOT retrigger a conversion, even if
      // the user changes currency to something that still differs from the
      // org default. This keeps the mental model simple (convert once, then
      // it's just data) and matches how receipts already work today.

      // totalAmount is never trusted from the client for mileage — always
      // re-derived from the (possibly just-edited) distance/round-trip fields.
      if (existing.expenseType === 'MILEAGE') {
        const distanceKm = fields.mileageDistanceKm ?? Number(existing.mileageDistanceKm ?? 0);
        const roundTrip = fields.mileageRoundTrip ?? existing.mileageRoundTrip;
        const ratePerKm = await expensesRepository.getOrganizationMileageRate(organizationId);
        (fields as Record<string, unknown>).totalAmount = computeMileageTotal(distanceKm, roundTrip, ratePerKm);
      }

      return expensesRepository.update(id, fields as Prisma.ExpenseUpdateInput, items);
    },

    // "Cancel" a fresh extraction and "delete a draft" are the same action:
    // only pre-submission states are deletable (matches the isEditable gate
    // the review page already applies), so a SUBMITTED expense can't vanish
    // out from under whoever it's routed to for approval, and an APPROVED
    // one — the actual financial record — can never be deleted, only voided
    // through a real accounting adjustment later.
    async delete(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      if (!canEdit(expense, actor)) {
        throw new BadRequestError('Only the person who submitted this expense can delete it');
      }
      if (!['EXTRACTED', 'FAILED', 'REJECTED'].includes(expense.status)) {
        throw new BadRequestError('Only a draft, failed, or rejected expense can be deleted');
      }

      // The file stays while another invoice read from it still uses it.
      if (expense.filePath && (await expensesRepository.countByFilePath(expense.filePath)) <= 1) {
        await fileStorage.delete(expense.filePath);
      }
      await expensesRepository.delete(id);
    },

    async submitForApproval(organizationId: string, id: string, actor: Actor) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense || !canView(expense, actor)) throw new NotFoundError('Expense not found');
      if (!canEdit(expense, actor)) {
        throw new BadRequestError('Only the person who submitted this expense can submit it for approval');
      }
      if (moduleOf(expense.expenseType) === 'PURCHASE_INVOICES') {
        throw new BadRequestError('Purchase invoices are sent to accounting, not approved');
      }
      if (!['EXTRACTED', 'FAILED', 'REJECTED'].includes(expense.status)) {
        throw new BadRequestError('This expense has already been submitted');
      }
      if (expense.totalAmount == null) {
        throw new BadRequestError('Cannot submit without a total amount');
      }

      // Route to the actual submitter's manager, even if an admin is doing this on their behalf.
      const approver = await approverResolver.getApprover(expense.uploadedBy);

      if (!approver) {
        // Nobody above them in the hierarchy — nothing to route to, so they're
        // self-certifying. Matches the solo/small-operator case directly.
        return expensesRepository.update(id, { status: 'APPROVED' });
      }

      if (!canApprove(approver.role)) {
        throw new BadRequestError(
          "Your manager isn't set up as an approver yet. Ask an admin to update their role."
        );
      }

      await expensesRepository.createApproval({ expenseId: id, approverId: approver.id, stepOrder: 1 });
      return expensesRepository.update(id, { status: 'SUBMITTED' });
    },

    async decide(
      organizationId: string,
      id: string,
      approverId: string,
      decision: 'APPROVED' | 'REJECTED',
      comment: string | null
    ) {
      const expense = await expensesRepository.findById(organizationId, id);
      if (!expense) throw new NotFoundError('Expense not found');

      const pending = await expensesRepository.findPendingApproval(id);
      if (!pending || pending.approverId !== approverId) {
        throw new BadRequestError('You do not have a pending approval for this expense');
      }

      await expensesRepository.decideApproval(pending.id, decision, comment);
      return expensesRepository.update(id, { status: decision });
    },

    // The purchase-invoice counterpart of submitting: no approval step, the
    // accountant who checked it hands it straight to the accounting system.
    // A failed send is kept on the invoice (accountingError) so it can be retried.
    async sendToAccounting(organizationId: string, id: string, actor: Actor) {
      await requireInvoiceAccess(organizationId, actor);
      const invoice = await expensesRepository.findById(organizationId, id);
      if (!invoice || invoice.expenseType !== 'PURCHASE_INVOICE') throw new NotFoundError('Invoice not found');
      if (!['EXTRACTED', 'FAILED'].includes(invoice.status)) {
        throw new BadRequestError('This invoice has already been sent to accounting');
      }
      const totalAmount = num(invoice.totalAmount);
      if (totalAmount == null) throw new BadRequestError('Cannot send without a total amount');

      const connector = accountingConnectorFor(await expensesRepository.getOrganizationAccountingConnector(organizationId));
      const payload: AccountingInvoice = {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        vendorName: invoice.vendorName,
        vendorAddress: invoice.vendorAddress,
        vendorTaxId: invoice.vendorTaxId,
        subtotal: num(invoice.subtotal),
        discountAmount: num(invoice.discountAmount),
        taxAmount: num(invoice.taxAmount),
        totalAmount,
        currency: invoice.currency,
        notes: invoice.notes,
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: num(item.quantity),
          unitPrice: num(item.unitPrice),
          totalPrice: num(item.totalPrice),
          taxRate: num(item.taxRate)
        }))
      };

      try {
        const { reference } = await connector.send(payload);
        return expensesRepository.update(id, {
          status: 'SENT',
          sentToAccountingAt: new Date(),
          accountingRef: reference,
          accountingError: null
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await expensesRepository.update(id, { accountingError: message });
        throw new BadRequestError(`Could not send the invoice to accounting: ${message}`);
      }
    },

    getApprovalQueue(organizationId: string, approverId: string) {
      return expensesRepository.listApprovalQueue(organizationId, approverId);
    },

    async exportCsv(organizationId: string, status: ExpenseStatus | undefined, actor: Actor) {
      const uploadedBy = actor.role === 'ADMIN' ? undefined : actor.userId;
      const expenses = await expensesRepository.listForExport(organizationId, status, uploadedBy);

      return toCsv(
        ['Invoice Number', 'Invoice Date', 'Vendor', 'Category', 'Subtotal', 'Discount', 'Tax', 'Total', 'Currency', 'Status'],
        expenses.map((expense) => [
          expense.invoiceNumber,
          expense.invoiceDate ? expense.invoiceDate.toISOString().slice(0, 10) : null,
          expense.vendorName,
          expense.category?.name,
          expense.subtotal?.toString(),
          expense.discountAmount?.toString(),
          expense.taxAmount?.toString(),
          expense.totalAmount?.toString(),
          expense.currency,
          expense.status
        ])
      );
    }
  };
}

export type ExpensesService = ReturnType<typeof createExpensesService>;
