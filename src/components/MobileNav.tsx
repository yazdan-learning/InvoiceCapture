import { Link, useLocation } from 'react-router-dom';
import { AuthUser } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { UserMenu } from './UserMenu';
import { useModules } from '../workspace/ModulesContext';
import { addActionFor, navItemsFor } from '../workspace/navigation';
import { NAV_ICONS, NAV_LABELS } from './nav-icons';
import { IconCamera, IconUpload } from './icons';

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
  const { modules } = useModules();
  const [home, ...tabs] = navItemsFor(user.role, modules);
  const add = addActionFor(user.role, modules);

  const tab = (item: typeof home) => {
    const Icon = NAV_ICONS[item.id];
    return (
      <Link key={item.id} to={item.to} className={`mobile-tab ${item.isActive(location.pathname) ? 'mobile-tab--active' : ''}`}>
        <Icon className="mobile-tab-icon" />
        {/* "Home" reads better than "Dashboard" in a tab bar. */}
        <span>{item.id === 'dashboard' ? t('nav.home') : t(NAV_LABELS[item.id])}</span>
      </Link>
    );
  };

  // Tabs keep their natural width and cluster together at the center of the
  // bar (fixed gap, no flex-grow) instead of stretching to fill it — that's
  // what pushed Upload off to one side and left dead/uneven space before.
  // The add button sits right after Home so it lands near the middle of the
  // cluster whatever the modules and role leave in the bar; it opens the
  // camera directly when scanning invoices is all this person does.
  return (
    <nav className="mobile-bottom-nav">
      {tab(home)}
      {add && (
        <Link to={add.to} className="mobile-tab mobile-tab--upload">
          {add.kind === 'scan' ? <IconCamera className="mobile-tab-icon" /> : <IconUpload className="mobile-tab-icon" />}
          <span>{add.kind === 'scan' ? t('nav.scan') : t('nav.add')}</span>
        </Link>
      )}
      {tabs.map(tab)}
    </nav>
  );
}
