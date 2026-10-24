import { AppModule } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { Actor, createExpensesService } from '../src/expenses/expenses.service';
import { ExpensesRepository } from '../src/expenses/expenses.repository';
import { CurrencyConverter, ExtractOptions, InvoiceExtractor } from '../src/expenses/ports';
import { AccountingConnector } from '../src/accounting/ports';
import { BadRequestError, ForbiddenError, NotFoundError } from '../src/shared/errors';
import { photo } from './fakes';

const employee: Actor = { userId: 'employee', role: 'EMPLOYEE' };
const accountant: Actor = { userId: 'accountant', role: 'ACCOUNTANT' };

/** A stored purchase invoice as findById returns it (Decimals as strings are enough for Number()). */
function storedInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv1', expenseType: 'PURCHASE_INVOICE', status: 'EXTRACTED', uploadedBy: 'someone-else', approvals: [],
    invoiceNumber: 'F-12', invoiceDate: new Date('2026-10-01'), dueDate: null, vendorName: 'Kaveh Co.',
    vendorAddress: null, vendorTaxId: null, subtotal: '1000', taxAmount: '90', totalAmount: '1090', currency: 'IRR',
    notes: null, items: [{ description: 'Paper', quantity: '2', unitPrice: '500', totalPrice: '1000', taxRate: null }],
    ...overrides
  };
}

function setup({
  country = 'INTL',
  defaultCurrency = 'EUR',
  modules = ['EXPENSES'] as AppModule[],
  stored = null as Record<string, unknown> | null,
  connector = { send: vi.fn(async () => ({ reference: 'ACC-7' })) } as AccountingConnector & { send: ReturnType<typeof vi.fn> }
} = {}) {
  const extractor = {
    extract: vi.fn(async (_file: unknown, _options?: ExtractOptions) => ({
      success: true,
      data: {
        invoiceNumber: null, invoiceDate: '2026-10-01', dueDate: null, vendorName: 'Shop', vendorAddress: null, vendorTaxId: null,
        customerName: null, customerAddress: null, items: [], subtotal: null, taxRate: null, taxAmount: null,
        totalAmount: 10, currency: 'EUR', paymentMethod: null, paymentTerms: null, notes: null
      },
      raw: {}
    }))
  } satisfies InvoiceExtractor;
  const currencyConverter = { getRate: vi.fn(async () => ({ rate: 2_000_000, asOf: new Date('2026-10-01') })) } satisfies CurrencyConverter;
  // Only what these tests touch; the rest of the repository is never called here.
  const repository = {
    getOrganizationCountry: vi.fn(async () => country),
    getOrganizationDefaultCurrency: vi.fn(async () => defaultCurrency),
    getOrganizationModules: vi.fn(async () => modules),
    getOrganizationAccountingConnector: vi.fn(async () => 'NONE'),
    getOrganizationCurrencyConverter: vi.fn(async () => 'FRANKFURTER'),
    findPotentialDuplicate: vi.fn(async () => null),
    findById: vi.fn(async () => stored),
    list: vi.fn(async () => [[], 0]),
    create: vi.fn(async (input: unknown) => input),
    update: vi.fn(async (_id: string, data: object) => ({ ...stored, ...data }))
  };
  const service = createExpensesService({
    extractor,
    expensesRepository: repository as unknown as ExpensesRepository,
    fileStorage: { save: vi.fn(async () => 'path'), read: vi.fn(), delete: vi.fn() },
    approverResolver: { getApprover: vi.fn() },
    distanceCalculator: { getDistance: vi.fn() },
    accountingConnectorFor: () => connector,
    currencyConverterFor: () => currencyConverter
  });
  return { service, extractor, currencyConverter, repository, connector };
}

describe('uploadAndExtract', () => {
  it("reads the invoice with the organization's country profile", async () => {
    const { service, extractor } = setup({ country: 'IR', defaultCurrency: 'IRR' });
    await service.uploadAndExtract('org', employee, photo, { handwritten: true });
    expect(extractor.extract.mock.calls[0][1]).toMatchObject({ handwritten: true, country: { id: 'IR' } });
  });

  it('converts a foreign invoice into Rial for an Iranian organization', async () => {
    const { service, currencyConverter } = setup({ country: 'IR', defaultCurrency: 'IRR' });
    const expense = (await service.uploadAndExtract('org', employee, photo)) as unknown as Record<string, unknown>;
    expect(currencyConverter.getRate).toHaveBeenCalledWith('EUR', 'IRR', new Date('2026-10-01'));
    expect(expense).toMatchObject({ currency: 'IRR', totalAmount: 20_000_000, originalCurrency: 'EUR', originalTotalAmount: 10 });
  });

  it('stores a purchase invoice through the same extraction', async () => {
    const { service, extractor } = setup({ modules: ['PURCHASE_INVOICES'] });
    const invoice = (await service.uploadAndExtract('org', accountant, photo, { expenseType: 'PURCHASE_INVOICE' })) as unknown as Record<string, unknown>;
    expect(invoice).toMatchObject({ expenseType: 'PURCHASE_INVOICE', status: 'EXTRACTED', vendorName: 'Shop' });
    expect(extractor.extract.mock.calls[0][1]).not.toHaveProperty('expenseType');
  });

  it('refuses purchase invoices from employees', async () => {
    const { service } = setup({ modules: ['EXPENSES', 'PURCHASE_INVOICES'] });
    await expect(service.uploadAndExtract('org', employee, photo, { expenseType: 'PURCHASE_INVOICE' })).rejects.toThrow(ForbiddenError);
  });

  it('refuses a document for a module that is switched off', async () => {
    await expect(setup({ modules: ['EXPENSES'] }).service.uploadAndExtract('org', accountant, photo, { expenseType: 'PURCHASE_INVOICE' })).rejects.toThrow(
      'Purchase invoices are not enabled'
    );
    await expect(setup({ modules: ['PURCHASE_INVOICES'] }).service.uploadAndExtract('org', employee, photo)).rejects.toThrow('Expenses are not enabled');
  });
});

describe('list', () => {
  it("shares the purchase invoices between accountants instead of scoping to the uploader's own", async () => {
    const { service, repository } = setup({ modules: ['PURCHASE_INVOICES'] });
    await service.list('org', { module: 'PURCHASE_INVOICES', page: 1, pageSize: 20 }, accountant);
    expect(repository.list).toHaveBeenCalledWith('org', { module: 'PURCHASE_INVOICES', page: 1, pageSize: 20 });
  });

  it("keeps an employee's expense list to their own", async () => {
    const { service, repository } = setup();
    await service.list('org', { module: 'EXPENSES', page: 1, pageSize: 20 }, employee);
    expect(repository.list).toHaveBeenCalledWith('org', expect.objectContaining({ uploadedBy: 'employee' }));
  });

  it('hides purchase invoices from employees', async () => {
    const { service } = setup({ modules: ['EXPENSES', 'PURCHASE_INVOICES'], stored: storedInvoice({ uploadedBy: 'employee' }) });
    await expect(service.list('org', { module: 'PURCHASE_INVOICES', page: 1, pageSize: 20 }, employee)).rejects.toThrow(ForbiddenError);
    await expect(service.getById('org', 'inv1', employee)).rejects.toThrow(NotFoundError);
  });
});

describe('sendToAccounting', () => {
  it('hands the checked invoice to the connector and marks it sent', async () => {
    const { service, connector, repository } = setup({ modules: ['PURCHASE_INVOICES'], stored: storedInvoice() });
    await service.sendToAccounting('org', 'inv1', accountant);
    expect(connector.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'inv1',
        vendorName: 'Kaveh Co.',
        totalAmount: 1090,
        items: [{ description: 'Paper', quantity: 2, unitPrice: 500, totalPrice: 1000, taxRate: null }]
      })
    );
    expect(repository.update).toHaveBeenCalledWith('inv1', expect.objectContaining({ status: 'SENT', accountingRef: 'ACC-7', accountingError: null }));
  });

  it('keeps the error on the invoice when the accounting system fails, so it can be retried', async () => {
    const connector = { send: vi.fn(async () => Promise.reject(new Error('API down'))) };
    const { service, repository } = setup({ modules: ['PURCHASE_INVOICES'], stored: storedInvoice(), connector });
    await expect(service.sendToAccounting('org', 'inv1', accountant)).rejects.toThrow('API down');
    expect(repository.update).toHaveBeenCalledWith('inv1', { accountingError: 'API down' });
    expect(repository.update).not.toHaveBeenCalledWith('inv1', expect.objectContaining({ status: 'SENT' }));
  });

  it('sends an invoice only once', async () => {
    const { service, connector } = setup({ modules: ['PURCHASE_INVOICES'], stored: storedInvoice({ status: 'SENT' }) });
    await expect(service.sendToAccounting('org', 'inv1', accountant)).rejects.toThrow(BadRequestError);
    expect(connector.send).not.toHaveBeenCalled();
  });

  it('is not the way to submit an expense, and an invoice is not submitted for approval', async () => {
    const receipt = setup({ modules: ['EXPENSES', 'PURCHASE_INVOICES'], stored: storedInvoice({ expenseType: 'RECEIPT' }) });
    await expect(receipt.service.sendToAccounting('org', 'inv1', accountant)).rejects.toThrow(NotFoundError);
    const invoice = setup({ modules: ['PURCHASE_INVOICES'], stored: storedInvoice() });
    await expect(invoice.service.submitForApproval('org', 'inv1', accountant)).rejects.toThrow('sent to accounting, not approved');
  });

  it('locks a sent invoice against edits', async () => {
    const { service } = setup({ modules: ['PURCHASE_INVOICES'], stored: storedInvoice({ status: 'SENT' }) });
    await expect(service.update('org', 'inv1', { vendorName: 'Other' }, accountant)).rejects.toThrow('already been sent');
  });
});
