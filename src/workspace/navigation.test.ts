import { describe, expect, it } from 'vitest';
import { addActionFor, navItemsFor } from './navigation';

const ids = (...args: Parameters<typeof navItemsFor>) => navItemsFor(...args).map((item) => item.id);

describe('navigation', () => {
  it('keeps the expense manager as it was', () => {
    expect(ids('EMPLOYEE', ['EXPENSES'])).toEqual(['dashboard', 'expenses']);
    expect(ids('APPROVER', ['EXPENSES'])).toEqual(['dashboard', 'expenses', 'approvals']);
    expect(addActionFor('EMPLOYEE', ['EXPENSES'])).toEqual({ to: '/upload', kind: 'add' });
  });

  it('turns into an invoice reader with only purchase invoices', () => {
    expect(ids('ACCOUNTANT', ['PURCHASE_INVOICES'])).toEqual(['dashboard', 'invoices']);
    expect(addActionFor('ACCOUNTANT', ['PURCHASE_INVOICES'])).toEqual({ to: '/invoices/upload', kind: 'scan' });
  });

  it('shows invoices with both modules only to accountants and admins', () => {
    expect(ids('ADMIN', ['EXPENSES', 'PURCHASE_INVOICES'])).toEqual(['dashboard', 'expenses', 'invoices', 'approvals']);
    expect(ids('EMPLOYEE', ['EXPENSES', 'PURCHASE_INVOICES'])).toEqual(['dashboard', 'expenses']);
    expect(ids('ACCOUNTANT', ['EXPENSES', 'PURCHASE_INVOICES'])).toEqual(['dashboard', 'expenses', 'invoices']);
  });

  it('gives an employee nothing to add in an invoice-only organization', () => {
    expect(ids('EMPLOYEE', ['PURCHASE_INVOICES'])).toEqual(['dashboard']);
    expect(addActionFor('EMPLOYEE', ['PURCHASE_INVOICES'])).toBeNull();
  });
});
