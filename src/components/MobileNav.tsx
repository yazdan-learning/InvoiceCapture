import { Link, useLocation } from 'react-router-dom';
import { AuthUser } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { UserMenu } from './UserMenu';
import { IconApprovals, IconDashboard, IconExpenses, IconUpload } from './icons';

export function MobileTopBar({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mobile-topbar">
      <span className="mobile-topbar-title">{t('nav.brand')}</span>
      <div className="mobile-topbar-right">
        <LanguageSwitcher />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </div>
  );
}

export function MobileBottomNav({ user }: { user: AuthUser }) {
  const location = useLocation();
  const { t } = useTranslation();
  const isExpensesActive =
    location.pathname === '/expenses' || location.pathname.startsWith('/expenses/');

  // Tabs keep their natural width and cluster together at the center of the
  // bar (fixed gap, no flex-grow) instead of stretching to fill it — that's
  // what pushed Upload off to one side and left dead/uneven space before.
  // Upload sits right after Home so it lands near the middle of the cluster
  // whether there are 3 tabs or 4.
  return (
    <nav className="mobile-bottom-nav">
      <Link to="/" className={`mobile-tab ${location.pathname === '/' ? 'mobile-tab--active' : ''}`}>
        <IconDashboard className="mobile-tab-icon" />
        <span>{t('nav.home')}</span>
      </Link>
      <Link to="/upload" className="mobile-tab mobile-tab--upload">
        <IconUpload className="mobile-tab-icon" />
        <span>{t('nav.add')}</span>
      </Link>
      <Link to="/expenses" className={`mobile-tab ${isExpensesActive ? 'mobile-tab--active' : ''}`}>
        <IconExpenses className="mobile-tab-icon" />
        <span>{t('nav.expenses')}</span>
      </Link>
      {user.role !== 'EMPLOYEE' && (
        <Link
          to="/approvals"
          className={`mobile-tab ${location.pathname === '/approvals' ? 'mobile-tab--active' : ''}`}
        >
          <IconApprovals className="mobile-tab-icon" />
          <span>{t('nav.approvals')}</span>
        </Link>
      )}
    </nav>
  );
}
