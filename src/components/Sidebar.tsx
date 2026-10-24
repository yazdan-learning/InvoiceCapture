import { Link } from 'react-router-dom';
import { AuthUser } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { useModules } from '../workspace/ModulesContext';
import { navItemsFor } from '../workspace/navigation';
import { NAV_ICONS, NAV_LABELS } from './nav-icons';
import { IconAdmin, IconLogout, IconSettings } from './icons';

type SidebarProps = {
  user: AuthUser;
  currentPath: string;
  onLogout: () => void;
};

export function Sidebar({ user, currentPath, onLogout }: SidebarProps) {
  const { t } = useTranslation();
  const { modules } = useModules();

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
          <div className="sidebar-brand-title">{t('nav.brand')}</div>
          <div className="sidebar-brand-sub">{modules.includes('EXPENSES') ? t('nav.brandSub') : t('invoices.title')}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItemsFor(user.role, modules).map((item) => {
          const Icon = NAV_ICONS[item.id];
          return (
            <Link
              key={item.id}
              to={item.to}
              className={`sidebar-link ${item.isActive(currentPath) ? 'sidebar-link--active' : ''}`}
            >
              <Icon className="sidebar-link-icon" />
              {t(NAV_LABELS[item.id])}
            </Link>
          );
        })}
      </nav>

      {user.role === 'ADMIN' && (
        <div className="sidebar-section">
          <span className="sidebar-section-label">{t('nav.admin')}</span>
          <Link
            to="/admin/users"
            className={`sidebar-link ${currentPath === '/admin/users' ? 'sidebar-link--active' : ''}`}
          >
            <IconAdmin className="sidebar-link-icon" />
            {t('nav.users')}
          </Link>
          <Link
            to="/admin/settings"
            className={`sidebar-link ${currentPath === '/admin/settings' ? 'sidebar-link--active' : ''}`}
          >
            <IconSettings className="sidebar-link-icon" />
            {t('nav.settings')}
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
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}
