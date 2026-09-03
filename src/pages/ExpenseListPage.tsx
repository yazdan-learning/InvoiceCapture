import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { downloadExpensesExport, listExpenses } from '../api';
import { Expense, ExpenseStatus } from '../types';
import { StatusPill } from '../components/StatusPill';

const STATUS_TABS: { label: string; value: ExpenseStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'To review', value: 'EXTRACTED' },
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

function expenseLabel(expense: Expense): string {
  if (expense.expenseType === 'MILEAGE') {
    return expense.mileageFrom && expense.mileageTo
      ? `${expense.mileageFrom} → ${expense.mileageTo}`
      : 'Mileage';
  }
  return expense.vendorName || 'Unknown vendor';
}

function expenseDate(expense: Expense): string | null {
  return expense.expenseType === 'MILEAGE' ? expense.mileageDate : expense.invoiceDate;
}

export function ExpenseListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | 'ALL'>(
    initialStatus && VALID_STATUSES.has(initialStatus as ExpenseStatus) ? (initialStatus as ExpenseStatus) : 'ALL'
  );
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listExpenses({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE
      });
      setExpenses(result.expenses);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
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

  const selectStatus = (value: ExpenseStatus | 'ALL') => {
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
              downloadExpensesExport(statusFilter === 'ALL' ? undefined : statusFilter).catch((err) =>
                setError(err instanceof Error ? err.message : 'Export failed')
              )
            }
          >
            Export CSV
          </button>
          <Link className="button-primary" to="/upload">
            + Add Expense
          </Link>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="list-loading">Loading expenses…</div>
      ) : expenses.length === 0 ? (
        <div className="empty-state">
          <h3>No expenses yet</h3>
          <p>Upload a receipt or log mileage to get started.</p>
          <Link className="button-primary" to="/upload">
            + Add Expense
          </Link>
        </div>
      ) : (
        <>
          <div className="invoice-table-wrap">
            <table className="invoice-table">
              <colgroup>
                <col className="col-vendor" />
                <col className="col-invoice-num" />
                <col className="col-date" />
                <col className="col-category" />
                <col className="col-amount" />
                <col className="col-status" />
              </colgroup>
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
                {expenses.map((expense) => (
                  <tr key={expense.id} onClick={() => navigate(`/expenses/${expense.id}`)}>
                    <td>
                      <span className="vendor-cell">
                        <span className="vendor-name" title={expenseLabel(expense)}>
                          {expenseLabel(expense)}
                        </span>
                        {expense.isDuplicate && (
                          <span className="dup-flag" title="Possible duplicate of an existing invoice">
                            ⚠ duplicate
                          </span>
                        )}
                      </span>
                    </td>
                    <td>{expense.expenseType === 'MILEAGE' ? '—' : expense.invoiceNumber || '—'}</td>
                    <td>{formatDate(expenseDate(expense))}</td>
                    <td>{expense.category?.name || '—'}</td>
                    <td className="align-right amount-cell">{formatAmount(expense.totalAmount, expense.currency)}</td>
                    <td>
                      <StatusPill status={expense.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="invoice-cards">
            {expenses.map((expense) => (
              <div key={expense.id} className="invoice-card" onClick={() => navigate(`/expenses/${expense.id}`)}>
                <div className="invoice-card-top">
                  <span className="invoice-card-vendor">{expenseLabel(expense)}</span>
                  <StatusPill status={expense.status} />
                </div>
                <div className="invoice-card-amount">{formatAmount(expense.totalAmount, expense.currency)}</div>
                <div className="invoice-card-meta">
                  <span>{formatDate(expenseDate(expense))}</span>
                  {expense.category && <span>{expense.category.name}</span>}
                  {expense.isDuplicate && <span className="dup-flag">⚠ duplicate</span>}
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
