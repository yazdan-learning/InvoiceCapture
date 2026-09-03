import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApprovalQueue } from '../api';
import { Expense } from '../types';
import { StatusPill } from '../components/StatusPill';

function formatAmount(amount: string | null, currency: string | null) {
  if (!amount) return '—';
  const formatted = Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function ApprovalQueuePage() {
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApprovalQueue()
      .then((result) => setExpenses(result.expenses))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load approvals'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>Pending your approval</h2>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="list-loading">Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing waiting on you</h3>
          <p>Expenses submitted by your team will show up here.</p>
        </div>
      ) : (
        <>
          <div className="invoice-table-wrap">
            <table className="invoice-table">
              <colgroup>
                <col className="col-submitted-by" />
                <col className="col-vendor" />
                <col className="col-invoice-num" />
                <col className="col-date" />
                <col className="col-amount" />
                <col className="col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>Submitted by</th>
                  <th>Vendor</th>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th className="align-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} onClick={() => navigate(`/expenses/${expense.id}`)}>
                    <td>{expense.uploader.name}</td>
                    <td>
                      <span className="vendor-name" title={expense.vendorName || 'Unknown vendor'}>
                        {expense.vendorName || 'Unknown vendor'}
                      </span>
                    </td>
                    <td>{expense.invoiceNumber || '—'}</td>
                    <td>{expense.invoiceDate ? new Date(expense.invoiceDate).toLocaleDateString() : '—'}</td>
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
                  <span className="invoice-card-vendor">{expense.vendorName || 'Unknown vendor'}</span>
                  <StatusPill status={expense.status} />
                </div>
                <div className="invoice-card-amount">{formatAmount(expense.totalAmount, expense.currency)}</div>
                <div className="invoice-card-meta">
                  <span>submitted by {expense.uploader.name}</span>
                  <span>{expense.invoiceDate ? new Date(expense.invoiceDate).toLocaleDateString() : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
