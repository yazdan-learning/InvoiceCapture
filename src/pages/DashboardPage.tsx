import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getApprovalQueue, listExpenses } from '../api';
import { Expense } from '../types';
import { StatusPill } from '../components/StatusPill';
import { IconUpload } from '../components/icons';
import { useTranslation } from '../i18n/LanguageContext';

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

function expenseLabel(expense: Expense, t: (key: string) => string): string {
  if (expense.expenseType === 'MILEAGE') {
    return expense.mileageFrom && expense.mileageTo
      ? `${expense.mileageFrom} → ${expense.mileageTo}`
      : t('common.mileageFallbackLabel');
  }
  return expense.vendorName || t('common.unknownVendor');
}

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [toReview, setToReview] = useState<Expense[]>([]);
  const [rejected, setRejected] = useState<Expense[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Expense[]>([]);
  const [queue, setQueue] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      listExpenses({ status: 'EXTRACTED', pageSize: PREVIEW_SIZE }),
      listExpenses({ status: 'REJECTED', pageSize: PREVIEW_SIZE }),
      listExpenses({ status: 'SUBMITTED', pageSize: PREVIEW_SIZE }),
      user.role !== 'EMPLOYEE' ? getApprovalQueue() : Promise.resolve({ expenses: [] })
    ])
      .then(([extracted, rej, submitted, approvalQueue]) => {
        setToReview(extracted.expenses);
        setRejected(rej.expenses);
        setPendingApproval(submitted.expenses);
        setQueue(approvalQueue.expenses);
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
          <h2 className="dashboard-greeting">{t('dashboard.greeting', { name: user.name.split(' ')[0] })}</h2>
          <p className="dashboard-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <Link className="button-primary" to="/upload">
          <IconUpload className="button-icon-inline" />
          {t('dashboard.addExpense')}
        </Link>
      </div>

      <div className="dashboard-stats">
        <Link to="/expenses?status=EXTRACTED" className="stat-card">
          <span className="stat-card-value">{countLabel(toReview.length)}</span>
          <span className="stat-card-label">{t('dashboard.statToReview')}</span>
        </Link>
        <Link to="/expenses?status=REJECTED" className="stat-card stat-card--warning">
          <span className="stat-card-value">{countLabel(rejected.length)}</span>
          <span className="stat-card-label">{t('dashboard.statRejected')}</span>
        </Link>
        <Link to="/expenses?status=SUBMITTED" className="stat-card">
          <span className="stat-card-value">{countLabel(pendingApproval.length)}</span>
          <span className="stat-card-label">{t('dashboard.statAwaitingApproval')}</span>
        </Link>
        {user.role !== 'EMPLOYEE' && (
          <Link to="/approvals" className="stat-card stat-card--accent">
            <span className="stat-card-value">{countLabel(queue.length)}</span>
            <span className="stat-card-label">{t('dashboard.statWaitingOnYou')}</span>
          </Link>
        )}
      </div>

      <div className="dashboard-section">
        <div className="dashboard-section-head">
          <h3>{t('dashboard.needsAttention')}</h3>
          <Link className="dashboard-section-link" to="/expenses">
            {t('dashboard.viewAllExpenses')}
          </Link>
        </div>

        {loading ? (
          <div className="list-loading">{t('common.loading')}</div>
        ) : attention.length === 0 && queue.length === 0 ? (
          <div className="empty-state">
            <h3>{t('dashboard.allCaughtUp')}</h3>
            <p>{t('dashboard.nothingNeedsAttention')}</p>
          </div>
        ) : (
          <div className="attention-list">
            {queue.map((expense) => (
              <Link key={expense.id} to={`/expenses/${expense.id}`} className="attention-row">
                <span className="attention-row-main">
                  <span className="attention-row-vendor">{expenseLabel(expense, t)}</span>
                  <span className="attention-row-sub">{t('dashboard.submittedBy', { name: expense.uploader.name })}</span>
                </span>
                <span className="attention-row-amount">{formatAmount(expense.totalAmount, expense.currency)}</span>
                <StatusPill status={expense.status} />
              </Link>
            ))}
            {attention.map((expense) => (
              <Link key={expense.id} to={`/expenses/${expense.id}`} className="attention-row">
                <span className="attention-row-main">
                  <span className="attention-row-vendor">{expenseLabel(expense, t)}</span>
                  {expense.status === 'REJECTED' && (
                    <span className="attention-row-sub">{t('dashboard.rejectedFixResubmit')}</span>
                  )}
                </span>
                <span className="attention-row-amount">{formatAmount(expense.totalAmount, expense.currency)}</span>
                <StatusPill status={expense.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
