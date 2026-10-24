import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getApprovalQueue, listExpenses } from '../api';
import { AuthUser, Expense } from '../types';
import { StatusPill } from '../components/StatusPill';
import { IconCamera, IconUpload } from '../components/icons';
import { useTranslation } from '../i18n/LanguageContext';
import { useModules } from '../workspace/ModulesContext';
import { addActionFor, seesPurchaseInvoices } from '../workspace/navigation';
import { canApprove } from '../workspace/permissions';
import { formatAmount } from '../lib/money';

const PREVIEW_SIZE = 5;

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

// The dashboard is put together from the modules this person uses: the
// expense overview, the purchase-invoice overview, or both one after the other.
export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { modules } = useModules();

  if (!user) return null;

  const expenses = modules.includes('EXPENSES');
  const invoices = seesPurchaseInvoices(user.role, modules);
  const add = addActionFor(user.role, modules);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-greeting">{t('dashboard.greeting', { name: user.name.split(' ')[0] })}</h2>
          <p className="dashboard-subtitle">{expenses ? t('dashboard.subtitle') : t('invoices.subtitle')}</p>
        </div>
        {add?.kind === 'scan' ? (
          <Link className="button-primary scan-cta" to={add.to}>
            <IconCamera className="button-icon-inline" />
            {t('invoices.scan')}
          </Link>
        ) : add ? (
          <Link className="button-primary" to={add.to}>
            <IconUpload className="button-icon-inline" />
            {t('dashboard.addExpense')}
          </Link>
        ) : null}
      </div>

      {expenses && <ExpensesOverview user={user} />}
      {invoices && <InvoicesOverview showHeading={expenses} />}
    </div>
  );
}

function ExpensesOverview({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const [toReview, setToReview] = useState<Expense[]>([]);
  const [rejected, setRejected] = useState<Expense[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Expense[]>([]);
  const [queue, setQueue] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listExpenses({ status: 'EXTRACTED', pageSize: PREVIEW_SIZE }),
      listExpenses({ status: 'REJECTED', pageSize: PREVIEW_SIZE }),
      listExpenses({ status: 'SUBMITTED', pageSize: PREVIEW_SIZE }),
      canApprove(user.role) ? getApprovalQueue() : Promise.resolve({ expenses: [] })
    ])
      .then(([extracted, rej, submitted, approvalQueue]) => {
        setToReview(extracted.expenses);
        setRejected(rej.expenses);
        setPendingApproval(submitted.expenses);
        setQueue(approvalQueue.expenses);
      })
      .finally(() => setLoading(false));
  }, [user]);

  // Rejected needs fixing most urgently, then fresh extractions still awaiting review.
  const attention = [...rejected, ...toReview].slice(0, 6);

  return (
    <>
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
        {canApprove(user.role) && (
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
    </>
  );
}

// Supplier invoices for the accountant: counters by status (the list's totals)
// and the ones still to check, oldest work first.
function InvoicesOverview({ showHeading }: { showHeading: boolean }) {
  const { t } = useTranslation();
  const [toCheck, setToCheck] = useState<{ items: Expense[]; total: number }>({ items: [], total: 0 });
  const [failed, setFailed] = useState(0);
  const [sent, setSent] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listExpenses({ module: 'PURCHASE_INVOICES', status: 'EXTRACTED', pageSize: PREVIEW_SIZE }),
      listExpenses({ module: 'PURCHASE_INVOICES', status: 'FAILED', pageSize: 1 }),
      listExpenses({ module: 'PURCHASE_INVOICES', status: 'SENT', pageSize: 1 })
    ])
      .then(([extracted, unread, done]) => {
        setToCheck({ items: extracted.expenses, total: extracted.total });
        setFailed(unread.total);
        setSent(done.total);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="dashboard-section">
      {showHeading && <h3 className="dashboard-module-title">{t('invoices.title')}</h3>}
      <div className="dashboard-stats dashboard-stats--three">
        <Link to="/invoices?status=EXTRACTED" className="stat-card stat-card--accent">
          <span className="stat-card-value">{toCheck.total}</span>
          <span className="stat-card-label">{t('invoices.statToCheck')}</span>
        </Link>
        <Link to="/invoices?status=FAILED" className="stat-card stat-card--warning">
          <span className="stat-card-value">{failed}</span>
          <span className="stat-card-label">{t('invoices.statFailed')}</span>
        </Link>
        <Link to="/invoices?status=SENT" className="stat-card">
          <span className="stat-card-value">{sent}</span>
          <span className="stat-card-label">{t('invoices.statSent')}</span>
        </Link>
      </div>

      <div className="dashboard-section-head">
        <h3>{t('invoices.toCheck')}</h3>
        <Link className="dashboard-section-link" to="/invoices">
          {t('invoices.viewAll')}
        </Link>
      </div>

      {loading ? (
        <div className="list-loading">{t('common.loading')}</div>
      ) : toCheck.items.length === 0 ? (
        <div className="empty-state">
          <h3>{t('invoices.allDone')}</h3>
          <p>{t('invoices.allDoneHint')}</p>
        </div>
      ) : (
        <div className="attention-list">
          {toCheck.items.map((invoice) => (
            <Link key={invoice.id} to={`/invoices/${invoice.id}`} className="attention-row">
              <span className="attention-row-main">
                <span className="attention-row-vendor">{invoice.vendorName || t('common.unknownVendor')}</span>
                {invoice.isDuplicate && <span className="dup-flag">{t('expenseList.duplicateBadge')}</span>}
              </span>
              <span className="attention-row-amount">{formatAmount(invoice.totalAmount, invoice.currency)}</span>
              <StatusPill status={invoice.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
