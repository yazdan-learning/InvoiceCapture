import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApprovalQueue } from '../api';
import { Invoice } from '../types';
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApprovalQueue()
      .then((result) => setInvoices(result.invoices))
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
      ) : invoices.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing waiting on you</h3>
          <p>Invoices submitted by your team will show up here.</p>
        </div>
      ) : (
        <div className="invoice-table-wrap">
          <table className="invoice-table">
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
              {invoices.map((invoice) => (
                <tr key={invoice.id} onClick={() => navigate(`/invoices/${invoice.id}`)}>
                  <td>{invoice.uploader.name}</td>
                  <td>{invoice.vendorName || 'Unknown vendor'}</td>
                  <td>{invoice.invoiceNumber || '—'}</td>
                  <td>{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '—'}</td>
                  <td className="align-right amount-cell">{formatAmount(invoice.totalAmount, invoice.currency)}</td>
                  <td>
                    <StatusPill status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
