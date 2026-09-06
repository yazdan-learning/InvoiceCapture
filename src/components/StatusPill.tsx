import { ExpenseStatus } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

const STATUS_CONFIG: Record<ExpenseStatus, { key: string; className: string }> = {
  PENDING: { key: 'status.pending', className: 'status-pill--pending' },
  PROCESSING: { key: 'status.processing', className: 'status-pill--processing' },
  EXTRACTED: { key: 'status.toReview', className: 'status-pill--extracted' },
  FAILED: { key: 'status.failed', className: 'status-pill--failed' },
  SUBMITTED: { key: 'status.pendingApproval', className: 'status-pill--submitted' },
  APPROVED: { key: 'status.approved', className: 'status-pill--approved' },
  REJECTED: { key: 'status.rejected', className: 'status-pill--rejected' }
};

export function StatusPill({ status }: { status: ExpenseStatus }) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  return <span className={`status-pill ${config.className}`}>{t(config.key)}</span>;
}
