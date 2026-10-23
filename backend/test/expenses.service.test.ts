import { describe, expect, it, vi } from 'vitest';
import { createExpensesService } from '../src/expenses/expenses.service';
import { ExpensesRepository } from '../src/expenses/expenses.repository';
import { CurrencyConverter, ExtractOptions, InvoiceExtractor } from '../src/expenses/ports';
import { photo } from './fakes';

function setup(country: string, defaultCurrency: string) {
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
  // Only what an upload touches; the rest of the repository is never called here.
  const repository = {
    getOrganizationCountry: vi.fn(async () => country),
    getOrganizationDefaultCurrency: vi.fn(async () => defaultCurrency),
    findPotentialDuplicate: vi.fn(async () => null),
    create: vi.fn(async (input: unknown) => input)
  } as unknown as ExpensesRepository;
  const service = createExpensesService({
    extractor,
    currencyConverter,
    expensesRepository: repository,
    fileStorage: { save: vi.fn(async () => 'path'), read: vi.fn(), delete: vi.fn() },
    approverResolver: { getApprover: vi.fn() },
    distanceCalculator: { getDistance: vi.fn() }
  });
  return { service, extractor, currencyConverter };
}

describe('uploadAndExtract', () => {
  it("reads the invoice with the organization's country profile", async () => {
    const { service, extractor } = setup('IR', 'IRR');
    await service.uploadAndExtract('org', 'user', photo, { handwritten: true });
    expect(extractor.extract.mock.calls[0][1]).toMatchObject({ handwritten: true, country: { id: 'IR' } });
  });

  it('converts a foreign invoice into Rial for an Iranian organization', async () => {
    const { service, currencyConverter } = setup('IR', 'IRR');
    const expense = (await service.uploadAndExtract('org', 'user', photo)) as unknown as Record<string, unknown>;
    expect(currencyConverter.getRate).toHaveBeenCalledWith('EUR', 'IRR', new Date('2026-10-01'));
    expect(expense).toMatchObject({ currency: 'IRR', totalAmount: 20_000_000, originalCurrency: 'EUR', originalTotalAmount: 10 });
  });
});
