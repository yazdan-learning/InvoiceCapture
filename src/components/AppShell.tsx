import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';
import { MobileBottomNav, MobileTopBar } from './MobileNav';
import { DesktopHeader } from './DesktopHeader';

// Desktop gets a persistent sidebar; mobile gets a top bar + bottom tab bar —
// deliberately different chrome per viewport, not the same layout squeezed down.
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (!user) return null;

  return (
    <div className="app-shell">
      <Sidebar user={user} currentPath={location.pathname} onLogout={logout} />
      <div className="app-main">
        <MobileTopBar user={user} onLogout={logout} />
        <DesktopHeader user={user} onLogout={logout} />
        <div className="app-content">{children}</div>
        <MobileBottomNav user={user} />
      </div>
    </div>
  );
}
