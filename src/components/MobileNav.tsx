import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthUser } from '../types';
import { IconAdmin, IconApprovals, IconDashboard, IconInvoices, IconLogout, IconUpload } from './icons';

export function MobileTopBar({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-topbar">
      <span className="mobile-topbar-title">Invoice Capture</span>
      <div className="mobile-user-menu">
        <button
          className="mobile-user-avatar"
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Account menu"
        >
          {user.name.charAt(0).toUpperCase()}
        </button>
        {open && (
          <>
            <div className="mobile-user-dropdown-backdrop" onClick={() => setOpen(false)} />
            <div className="mobile-user-dropdown">
              <div className="mobile-user-dropdown-name">{user.name}</div>
              <span className="header-user-role">{user.role}</span>
              {user.role === 'ADMIN' && (
                <Link to="/admin/users" className="mobile-user-dropdown-link" onClick={() => setOpen(false)}>
                  <IconAdmin className="sidebar-link-icon" />
                  Users
                </Link>
              )}
              <button
                className="mobile-user-dropdown-link"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <IconLogout className="sidebar-link-icon" />
                Log out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MobileBottomNav({ user }: { user: AuthUser }) {
  const location = useLocation();
  const isInvoicesActive =
    location.pathname === '/invoices' || location.pathname.startsWith('/invoices/');

  return (
    <nav className="mobile-bottom-nav">
      <Link to="/" className={`mobile-tab ${location.pathname === '/' ? 'mobile-tab--active' : ''}`}>
        <IconDashboard className="mobile-tab-icon" />
        <span>Home</span>
      </Link>
      <Link to="/invoices" className={`mobile-tab ${isInvoicesActive ? 'mobile-tab--active' : ''}`}>
        <IconInvoices className="mobile-tab-icon" />
        <span>Invoices</span>
      </Link>
      <Link to="/upload" className="mobile-tab mobile-tab--upload">
        <IconUpload className="mobile-tab-icon" />
        <span>Upload</span>
      </Link>
      {user.role !== 'EMPLOYEE' && (
        <Link
          to="/approvals"
          className={`mobile-tab ${location.pathname === '/approvals' ? 'mobile-tab--active' : ''}`}
        >
          <IconApprovals className="mobile-tab-icon" />
          <span>Approvals</span>
        </Link>
      )}
    </nav>
  );
}
