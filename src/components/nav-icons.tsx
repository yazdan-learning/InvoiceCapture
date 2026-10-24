import { NavItemId } from '../workspace/navigation';
import { IconApprovals, IconDashboard, IconExpenses, IconInvoice } from './icons';

// How each navigation entry looks; which entries exist is decided in workspace/navigation.ts.
export const NAV_ICONS: Record<NavItemId, (props: { className?: string }) => JSX.Element> = {
  dashboard: IconDashboard,
  expenses: IconExpenses,
  invoices: IconInvoice,
  approvals: IconApprovals
};

export const NAV_LABELS: Record<NavItemId, string> = {
  dashboard: 'nav.dashboard',
  expenses: 'nav.expenses',
  invoices: 'nav.invoices',
  approvals: 'nav.approvals'
};
