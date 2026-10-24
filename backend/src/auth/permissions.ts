import { Role } from '@prisma/client';

// Who may do what, in one place: routes (requireRole) and services check these
// lists instead of comparing roles inline.

export const ROLES = ['EMPLOYEE', 'APPROVER', 'ACCOUNTANT', 'ADMIN'] as const satisfies readonly Role[];

/** Decide on the expenses routed to them. */
export const APPROVER_ROLES: Role[] = ['APPROVER', 'ADMIN'];

/** Capture, check and send the organization's purchase invoices (all of them, not only their own). */
export const ACCOUNTANT_ROLES: Role[] = ['ACCOUNTANT', 'ADMIN'];

export const canApprove = (role: Role) => APPROVER_ROLES.includes(role);
export const canHandlePurchaseInvoices = (role: Role) => ACCOUNTANT_ROLES.includes(role);
/** Keep the raw-material list, review matches and approve new prices — the same people as purchase invoices. */
export const canManageMaterialPrices = (role: Role) => ACCOUNTANT_ROLES.includes(role);
