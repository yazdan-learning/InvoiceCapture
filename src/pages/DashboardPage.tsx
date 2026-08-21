import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getApprovalQueue, listInvoices } from '../api';
import { Invoice } from '../types';
import { StatusPill } from '../components/StatusPill';
import { IconUpload } from '../components/icons';

const PREVIEW_SIZE = 5;

function formatAmount(amount: string | null, currency: string | null) {
  if (!amount) return '—';
  const formatted = Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

function countLabel(count: number) {
  return count >= PREVIEW_SIZE ? `${count}+` : String(count);
}

export function DashboardPage() {
  const { user } = useAuth();
  const [toReview, setToReview] = useState<Invoice[]>([]);
  const [rejected, setRejected] = useState<Invoice[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Invoice[]>([]);
  const [queue, setQueue] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      listInvoices({ status: 'EXTRACTED', pageSize: PREVIEW_SIZE }),
      listInvoices({ status: 'REJECTED', pageSize: PREVIEW_SIZE }),
      listInvoices({ status: 'SUBMITTED', pageSize: PREVIEW_SIZE }),
      user.role !== 'EMPLOYEE' ? getApprovalQueue() : Promise.resolve({ invoices: [] })
    ])
      .then(([extracted, rej, submitted, approvalQueue]) => {
        setToReview(extracted.invoices);
        setRejected(rej.invoices);
        setPendingApproval(submitted.invoices);
        setQueue(approvalQueue.invoices);
      })
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  // Rejected needs fixing most urgently, then fresh extractions still awaiting review.
  const attention = [...rejected, ...toReview].slice(0, 6);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-greeting">Hi, {user.name.split(' ')[0]}</h2>
          <p className="dashboard-subtitle">Here's what needs your attention today.</p>
        </div>
        <Link className="button-primary" to="/upload">
          <IconUpload className="button-icon-inline" />
          Upload Invoice
        </Link>
      </div>

      <div className="dashboard-stats">
        <Link to="/invoices?status=EXTRACTED" className="stat-card">
          <span className="stat-card-value">{countLabel(toReview.length)}</span>
          <span className="stat-card-label">To review</span>
        </Link>
        <Link to="/invoices?status=REJECTED" className="stat-card stat-card--warning">
          <span className="stat-card-value">{countLabel(rejected.length)}</span>
          <span className="stat-card-label">Rejected — needs fixing</span>
        </Link>
        <Link to="/invoices?status=SUBMITTED" className="stat-card">
          <span className="stat-card-value">{countLabel(pendingApproval.length)}</span>
          <span className="stat-card-label">Awaiting approval</span>
        </Link>
        {user.role !== 'EMPLOYEE' && (
          <Link to="/approvals" className="stat-card stat-card--accent">
            <span className="stat-card-value">{countLabel(queue.length)}</span>
            <span className="stat-card-label">Waiting on your decision</span>
          </Link>
        )}
      </div>

      <div className="dashboard-section">
        <div className="dashboard-section-head">
          <h3>Needs your attention</h3>
          <Link className="dashboard-section-link" to="/invoices">
            View all invoices →
          </Link>
        </div>

        {loading ? (
          <div className="list-loading">Loading…</div>
        ) : attention.length === 0 && queue.length === 0 ? (
          <div className="empty-state">
            <h3>You're all caught up</h3>
            <p>Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="attention-list">
            {queue.map((invoice) => (
              <Link key={invoice.id} to={`/invoices/${invoice.id}`} className="attention-row">
                <span className="attention-row-main">
                  <span className="attention-row-vendor">{invoice.vendorName || 'Unknown vendor'}</span>
                  <span className="attention-row-sub">submitted by {invoice.uploader.name}</span>
                </span>
                <span className="attention-row-amount">{formatAmount(invoice.totalAmount, invoice.currency)}</span>
                <StatusPill status={invoice.status} />
              </Link>
            ))}
            {attention.map((invoice) => (
              <Link key={invoice.id} to={`/invoices/${invoice.id}`} className="attention-row">
                <span className="attention-row-main">
                  <span className="attention-row-vendor">{invoice.vendorName || 'Unknown vendor'}</span>
                  {invoice.status === 'REJECTED' && (
                    <span className="attention-row-sub">rejected — fix and resubmit</span>
                  )}
                </span>
                <span className="attention-row-amount">{formatAmount(invoice.totalAmount, invoice.currency)}</span>
                <StatusPill status={invoice.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
