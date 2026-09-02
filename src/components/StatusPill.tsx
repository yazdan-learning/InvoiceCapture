import { InvoiceStatus } from '../types';

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'status-pill--pending' },
  PROCESSING: { label: 'Processing', className: 'status-pill--processing' },
  EXTRACTED: { label: 'To review', className: 'status-pill--extracted' },
  FAILED: { label: 'Failed', className: 'status-pill--failed' },
  SUBMITTED: { label: 'Pending approval', className: 'status-pill--submitted' },
  APPROVED: { label: 'Approved', className: 'status-pill--approved' },
  REJECTED: { label: 'Rejected', className: 'status-pill--rejected' }
};

export function StatusPill({ status }: { status: InvoiceStatus }) {
  const config = STATUS_CONFIG[status];
  return <span className={`status-pill ${config.className}`}>{config.label}</span>;
}
