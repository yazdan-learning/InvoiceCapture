import { Role } from '../types';

// Mirrors backend/src/auth/permissions.ts — the server enforces these, the UI
// only uses them to hide what a role can't use.

/** Decide on the expenses routed to them. */
export const canApprove = (role: Role) => role === 'APPROVER' || role === 'ADMIN';

/** Capture, check and send the organization's purchase invoices. */
export const canHandlePurchaseInvoices = (role: Role) => role === 'ACCOUNTANT' || role === 'ADMIN';

/** Keep the raw-material list, review matches and approve new prices. */
export const canManageMaterialPrices = (role: Role) => role === 'ACCOUNTANT' || role === 'ADMIN';
