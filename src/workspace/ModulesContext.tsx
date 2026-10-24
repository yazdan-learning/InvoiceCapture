import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getModules } from '../api';
import { useAuth } from '../auth/AuthContext';
import { AppModule } from '../types';

// If the modules can't be loaded: the expense manager, as before modules existed.
const FALLBACK: AppModule[] = ['EXPENSES'];

type ModulesContextValue = {
  modules: AppModule[];
  /** False until the organization's modules have loaded — pages wait, so they don't flash the wrong menus. */
  ready: boolean;
  has: (module: AppModule) => boolean;
  /** Call after the admin changes the modules, so the UI follows without a reload. */
  reload: () => void;
};

const ModulesContext = createContext<ModulesContextValue | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [modules, setModules] = useState<AppModule[] | null>(null);

  const reload = useCallback(() => {
    getModules()
      .then((result) => setModules(result.modules))
      .catch(() => setModules(FALLBACK));
  }, []);

  useEffect(() => {
    setModules(null);
    if (isAuthenticated) reload();
  }, [isAuthenticated, reload]);

  const value = useMemo(() => {
    const loaded = modules ?? [];
    return { modules: loaded, ready: modules !== null, has: (module: AppModule) => loaded.includes(module), reload };
  }, [modules, reload]);

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export function useModules(): ModulesContextValue {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error('useModules must be used within ModulesProvider');
  return ctx;
}
