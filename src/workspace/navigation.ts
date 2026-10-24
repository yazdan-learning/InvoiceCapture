import { AppModule, Role } from '../types';
import { canApprove, canHandlePurchaseInvoices } from './permissions';

// The one list both the desktop sidebar and the mobile tab bar are built from:
// each entry says which module it belongs to and who may see it, so a new
// module or role changes this file, not every menu.

export type NavItemId = 'dashboard' | 'expenses' | 'invoices' | 'approvals';

export type NavItem = {
  id: NavItemId;
  to: string;
  isActive: (path: string) => boolean;
};

type NavRule = NavItem & { visible: (role: Role, modules: AppModule[]) => boolean };

const NAV_ITEMS: NavRule[] = [
  { id: 'dashboard', to: '/', isActive: (path) => path === '/', visible: () => true },
  {
    id: 'expenses',
    to: '/expenses',
    isActive: (path) => path === '/expenses' || path.startsWith('/expenses/') || path.startsWith('/upload'),
    visible: (_role, modules) => modules.includes('EXPENSES')
  },
  {
    id: 'invoices',
    to: '/invoices',
    isActive: (path) => path === '/invoices' || path.startsWith('/invoices/'),
    visible: (role, modules) => modules.includes('PURCHASE_INVOICES') && canHandlePurchaseInvoices(role)
  },
  {
    id: 'approvals',
    to: '/approvals',
    isActive: (path) => path === '/approvals',
    visible: (role, modules) => modules.includes('EXPENSES') && canApprove(role)
  }
];

export function navItemsFor(role: Role, modules: AppModule[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.visible(role, modules)).map(({ visible: _visible, ...item }) => item);
}

/** May this person open purchase invoices at all? */
export function seesPurchaseInvoices(role: Role, modules: AppModule[]): boolean {
  return modules.includes('PURCHASE_INVOICES') && canHandlePurchaseInvoices(role);
}

/**
 * Where the main "+" button goes: straight to the camera when scanning invoices
 * is all this person does, otherwise the chooser (which offers a purchase
 * invoice too when they may scan one). null = nothing for them to add.
 */
export function addActionFor(role: Role, modules: AppModule[]): { to: string; kind: 'scan' | 'add' } | null {
  if (modules.includes('EXPENSES')) return { to: '/upload', kind: 'add' };
  if (seesPurchaseInvoices(role, modules)) return { to: '/invoices/upload', kind: 'scan' };
  return null;
}
