import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { downloadInvoicesExport, listInvoices } from '../api';
import { Invoice, InvoiceStatus } from '../types';
import { StatusPill } from '../components/StatusPill';

const STATUS_TABS: { label: string; value: InvoiceStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'To review', value: 'EXTRACTED' },
  { label: 'Reviewed', value: 'REVIEWED' },
  { label: 'Pending approval', value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Failed', value: 'FAILED' }
];

const VALID_STATUSES = new Set(STATUS_TABS.map((t) => t.value));
const PAGE_SIZE = 20;

function formatAmount(amount: string | null, currency: string | null) {
  if (!amount) return '—';
  const formatted = Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatDate(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString();
}

export function InvoiceListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>(
    initialStatus && VALID_STATUSES.has(initialStatus as InvoiceStatus) ? (initialStatus as InvoiceStatus) : 'ALL'
  );
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listInvoices({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE
      });
      setInvoices(result.invoices);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const selectStatus = (value: InvoiceStatus | 'ALL') => {
    setStatusFilter(value);
    setPage(1);
    setSearchParams(value === 'ALL' ? {} : { status: value });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="list-page">
      <div className="list-toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Search vendor or invoice number…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className="status-tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`status-tab ${statusFilter === tab.value ? 'status-tab--active' : ''}`}
              onClick={() => selectStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="list-actions">
          <button
            className="button-outline"
            type="button"
            onClick={() =>
              downloadInvoicesExport(statusFilter === 'ALL' ? undefined : statusFilter).catch((err) =>
                setError(err instanceof Error ? err.message : 'Export failed')
              )
            }
          >
            Export CSV
          </button>
          <Link className="button-primary" to="/upload">
            + Upload Invoice
          </Link>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="list-loading">Loading invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="empty-state">
          <h3>No invoices yet</h3>
          <p>Upload your first invoice to get started.</p>
          <Link className="button-primary" to="/upload">
            + Upload Invoice
          </Link>
        </div>
      ) : (
        <>
          <div className="invoice-table-wrap">
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th className="align-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} onClick={() => navigate(`/invoices/${invoice.id}`)}>
                    <td>
                      <span className="vendor-cell">
                        {invoice.vendorName || 'Unknown vendor'}
                        {invoice.isDuplicate && (
                          <span className="dup-flag" title="Possible duplicate of an existing invoice">
                            ⚠ duplicate
                          </span>
                        )}
                      </span>
                    </td>
                    <td>{invoice.invoiceNumber || '—'}</td>
                    <td>{formatDate(invoice.invoiceDate)}</td>
                    <td>{invoice.category?.name || '—'}</td>
                    <td className="align-right amount-cell">{formatAmount(invoice.totalAmount, invoice.currency)}</td>
                    <td>
                      <StatusPill status={invoice.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="invoice-cards">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="invoice-card" onClick={() => navigate(`/invoices/${invoice.id}`)}>
                <div className="invoice-card-top">
                  <span className="invoice-card-vendor">{invoice.vendorName || 'Unknown vendor'}</span>
                  <StatusPill status={invoice.status} />
                </div>
                <div className="invoice-card-amount">{formatAmount(invoice.totalAmount, invoice.currency)}</div>
                <div className="invoice-card-meta">
                  <span>{formatDate(invoice.invoiceDate)}</span>
                  {invoice.category && <span>{invoice.category.name}</span>}
                  {invoice.isDuplicate && <span className="dup-flag">⚠ duplicate</span>}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                type="button"
                className="button-outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="pagination-label">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="button-outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
