import { Link } from 'react-router-dom';
import { AuthUser } from '../types';
import { IconAdmin, IconApprovals, IconDashboard, IconExpenses, IconLogout } from './icons';

type SidebarProps = {
  user: AuthUser;
  currentPath: string;
  onLogout: () => void;
};

export function Sidebar({ user, currentPath, onLogout }: SidebarProps) {
  const isExpensesActive =
    currentPath === '/expenses' || currentPath.startsWith('/expenses/') || currentPath.startsWith('/upload');

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <svg className="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M9 12h6M9 16h6M12 8V6M8 20h8a2 2 0 002-2V6a2 2 0 00-2-2h-2.172a2 2 0 00-1.414.586l-1.828 1.828A2 2 0 019.172 7H8a2 2 0 00-2 2v9a2 2 0 002 2z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <div className="sidebar-brand-title">Expense Manager</div>
          <div className="sidebar-brand-sub">Receipts &amp; Approvals</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link to="/" className={`sidebar-link ${currentPath === '/' ? 'sidebar-link--active' : ''}`}>
          <IconDashboard className="sidebar-link-icon" />
          Dashboard
        </Link>
        <Link to="/expenses" className={`sidebar-link ${isExpensesActive ? 'sidebar-link--active' : ''}`}>
          <IconExpenses className="sidebar-link-icon" />
          Expenses
        </Link>
        {user.role !== 'EMPLOYEE' && (
          <Link to="/approvals" className={`sidebar-link ${currentPath === '/approvals' ? 'sidebar-link--active' : ''}`}>
            <IconApprovals className="sidebar-link-icon" />
            Approvals
          </Link>
        )}
      </nav>

      {user.role === 'ADMIN' && (
        <div className="sidebar-section">
          <span className="sidebar-section-label">Admin</span>
          <Link
            to="/admin/users"
            className={`sidebar-link ${currentPath === '/admin/users' ? 'sidebar-link--active' : ''}`}
          >
            <IconAdmin className="sidebar-link-icon" />
            Users
          </Link>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-name">{user.name}</span>
          <span className="header-user-role">{user.role}</span>
        </div>
        <button className="sidebar-logout" type="button" onClick={onLogout}>
          <IconLogout className="sidebar-link-icon" />
          Log out
        </button>
      </div>
    </aside>
  );
}
