import { AppModule, ExpenseType } from '@prisma/client';

// What an organization uses the app for, switched on by the admin. The country
// profile (../countries) decides how invoices are read; the modules decide
// which flows exist at all.
export const APP_MODULES = ['EXPENSES', 'PURCHASE_INVOICES', 'RAW_MATERIAL_PRICING'] as const satisfies readonly AppModule[];

export const MODULE_NAMES: Record<AppModule, string> = {
  EXPENSES: 'Expenses',
  PURCHASE_INVOICES: 'Purchase invoices',
  RAW_MATERIAL_PRICING: 'Raw-material pricing'
};

/** The module an expense record belongs to: purchase invoices are their own book. */
export function moduleOf(expenseType: ExpenseType): AppModule {
  return expenseType === 'PURCHASE_INVOICE' ? 'PURCHASE_INVOICES' : 'EXPENSES';
}
