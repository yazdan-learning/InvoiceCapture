import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthUser } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { IconAdmin, IconLogout, IconSettings } from './icons';

// Shared by MobileTopBar and DesktopHeader — one dropdown implementation, one
// set of translation keys, instead of maintaining the same avatar+dropdown
// pattern twice. This is also the shell "user configuration" gets added to
// later — nothing beyond name/role/admin-links/logout exists yet on purpose.
export function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="user-menu">
      <button className="user-menu-avatar" type="button" onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        {user.name.charAt(0).toUpperCase()}
      </button>
      {open && (
        <>
          <div className="user-menu-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="user-menu-dropdown">
            <div className="user-menu-dropdown-name">{user.name}</div>
            <span className="header-user-role">{user.role}</span>
            {user.role === 'ADMIN' && (
              <>
                <Link to="/admin/users" className="user-menu-dropdown-link" onClick={() => setOpen(false)}>
                  <IconAdmin className="sidebar-link-icon" />
                  {t('nav.users')}
                </Link>
                <Link to="/admin/settings" className="user-menu-dropdown-link" onClick={() => setOpen(false)}>
                  <IconSettings className="sidebar-link-icon" />
                  {t('nav.settings')}
                </Link>
              </>
            )}
            <button
              className="user-menu-dropdown-link"
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <IconLogout className="sidebar-link-icon" />
              {t('common.logOut')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
