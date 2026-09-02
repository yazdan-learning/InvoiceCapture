import { AuthUser, Category, ExtractResponse, Invoice, InvoiceStatus, Role, UserSummary } from './types';
import { clearSession, getToken } from './auth/token-storage';

export const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4300';

function apiUrl(path: string, base = defaultBaseUrl) {
  return `${base.replace(/\/$/, '')}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    clearSession();
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type LoginResult = {
  token: string;
  user: AuthUser;
};

export async function login(email: string, password: string, apiBaseUrl = defaultBaseUrl): Promise<LoginResult> {
  const response = await fetch(apiUrl('/api/auth/login', apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return parseJsonOrThrow(response);
}

type ExtractParams = {
  file: File;
  apiBaseUrl?: string;
};

// The FE used to call the n8n webhook directly. It now calls our backend, which
// calls n8n itself, persists the result, and returns the saved Invoice record.
export async function extractInvoice({ file, apiBaseUrl = defaultBaseUrl }: ExtractParams): Promise<ExtractResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(apiUrl('/api/invoices', apiBaseUrl), {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed with status ${response.status}`);
  }

  const invoice = (await response.json()) as Invoice;
  return {
    success: invoice.status !== 'FAILED',
    message: invoice.status === 'FAILED' ? invoice.errorMessage ?? 'Extraction failed' : 'Invoice processed',
    timestamp: invoice.createdAt,
    data: invoice
  };
}

export type ListInvoicesParams = {
  status?: InvoiceStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  apiBaseUrl?: string;
};

export type ListInvoicesResponse = {
  invoices: Invoice[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listInvoices(params: ListInvoicesParams = {}): Promise<ListInvoicesResponse> {
  const { apiBaseUrl = defaultBaseUrl, ...query } = params;
  const search = new URLSearchParams();
  if (query.status) search.set('status', query.status);
  if (query.search) search.set('search', query.search);
  if (query.page) search.set('page', String(query.page));
  if (query.pageSize) search.set('pageSize', String(query.pageSize));

  const response = await fetch(apiUrl(`/api/invoices?${search.toString()}`, apiBaseUrl), {
    headers: authHeaders()
  });
  return parseJsonOrThrow(response);
}

export async function getInvoice(id: string, apiBaseUrl = defaultBaseUrl): Promise<Invoice> {
  const response = await fetch(apiUrl(`/api/invoices/${id}`, apiBaseUrl), { headers: authHeaders() });
  return parseJsonOrThrow(response);
}

export type UpdateInvoicePayload = Partial<{
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  subtotal: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  notes: string | null;
  categoryId: string | null;
}>;

export async function updateInvoice(
  id: string,
  payload: UpdateInvoicePayload,
  apiBaseUrl = defaultBaseUrl
): Promise<Invoice> {
  const response = await fetch(apiUrl(`/api/invoices/${id}`, apiBaseUrl), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonOrThrow(response);
}

export async function getCategories(apiBaseUrl = defaultBaseUrl): Promise<Category[]> {
  const response = await fetch(apiUrl('/api/categories', apiBaseUrl), { headers: authHeaders() });
  return parseJsonOrThrow(response);
}

// Plain <img src> / <a href> requests can't carry our Authorization header, and
// these routes require auth — so both fetch as an authenticated blob instead of
// returning a directly-linkable URL.

export async function getInvoiceFileBlobUrl(id: string, apiBaseUrl = defaultBaseUrl): Promise<string> {
  const response = await fetch(apiUrl(`/api/invoices/${id}/file`, apiBaseUrl), { headers: authHeaders() });
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error(`Failed to load document (status ${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function downloadInvoicesExport(status?: InvoiceStatus, apiBaseUrl = defaultBaseUrl): Promise<void> {
  const search = status ? `?status=${status}` : '';
  const response = await fetch(apiUrl(`/api/invoices/export${search}`, apiBaseUrl), { headers: authHeaders() });
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error(`Export failed (status ${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'invoices.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function submitInvoice(id: string, apiBaseUrl = defaultBaseUrl): Promise<Invoice> {
  const response = await fetch(apiUrl(`/api/invoices/${id}/submit`, apiBaseUrl), {
    method: 'POST',
    headers: authHeaders()
  });
  return parseJsonOrThrow(response);
}

export async function decideInvoice(
  id: string,
  decision: 'approve' | 'reject',
  comment: string | null,
  apiBaseUrl = defaultBaseUrl
): Promise<Invoice> {
  const response = await fetch(apiUrl(`/api/invoices/${id}/${decision}`, apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ comment })
  });
  return parseJsonOrThrow(response);
}

export async function getApprovalQueue(apiBaseUrl = defaultBaseUrl): Promise<{ invoices: Invoice[] }> {
  const response = await fetch(apiUrl('/api/invoices/approvals/queue', apiBaseUrl), { headers: authHeaders() });
  return parseJsonOrThrow(response);
}

export async function getUsers(apiBaseUrl = defaultBaseUrl): Promise<UserSummary[]> {
  const response = await fetch(apiUrl('/api/auth/users', apiBaseUrl), { headers: authHeaders() });
  return parseJsonOrThrow(response);
}

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  role: Role;
  managerId: string | null;
};

export async function createUser(payload: CreateUserPayload, apiBaseUrl = defaultBaseUrl): Promise<UserSummary> {
  const response = await fetch(apiUrl('/api/auth/users', apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return parseJsonOrThrow(response);
}
