import { AuthUser } from '../types';
import { LanguageSwitcher } from './LanguageSwitcher';
import { UserMenu } from './UserMenu';

// Desktop-only (hidden below 900px via CSS, same breakpoint the sidebar
// already uses) — mobile keeps its own top bar. Left side is intentionally
// empty for now; right side holds the language switcher and the same
// UserMenu the mobile top bar uses, which is where "user configuration" gets
// added later.
export function DesktopHeader({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <div className="desktop-header">
      <div className="desktop-header-left" />
      <div className="desktop-header-right">
        <LanguageSwitcher />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </div>
  );
}
