import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DesktopService, LicenseStatus } from '../services/project-service';
import { FREE_LICENSE_STATUS } from '../services/project-service';

interface LicenseContextValue {
  readonly status: LicenseStatus;
  readonly loading: boolean;
  refresh(): Promise<LicenseStatus>;
  chooseAndActivate(): Promise<LicenseStatus | null>;
  activate(path: string): Promise<LicenseStatus>;
  startTrial(): Promise<LicenseStatus>;
  deactivate(): Promise<LicenseStatus>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({
  service,
  children,
}: {
  readonly service: DesktopService;
  readonly children: ReactNode;
}) {
  const [status, setStatus] = useState<LicenseStatus>(FREE_LICENSE_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<LicenseStatus> => {
    try {
      const next = await service.licenseStatus();
      setStatus(next);
      return next;
    } catch {
      const free = {
        ...FREE_LICENSE_STATUS,
        error: 'No se pudo leer el estado de la licencia en este equipo.',
      };
      setStatus(free);
      return free;
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chooseAndActivate = useCallback(async (): Promise<LicenseStatus | null> => {
    const path = await service.chooseLicenseFile();
    if (!path) return null;
    return service.activateLicense(path).then((next) => {
      setStatus(next);
      return next;
    });
  }, [service]);

  const activate = useCallback(
    async (path: string): Promise<LicenseStatus> => {
      const next = await service.activateLicense(path);
      setStatus(next);
      return next;
    },
    [service],
  );

  const startTrial = useCallback(async (): Promise<LicenseStatus> => {
    const next = await service.startTrial();
    setStatus(next);
    return next;
  }, [service]);

  const deactivate = useCallback(async (): Promise<LicenseStatus> => {
    const next = await service.deactivateLicense();
    setStatus(next);
    return next;
  }, [service]);

  const value = useMemo(
    () => ({ status, loading, refresh, chooseAndActivate, activate, startTrial, deactivate }),
    [status, loading, refresh, chooseAndActivate, activate, startTrial, deactivate],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextValue {
  const value = useContext(LicenseContext);
  if (!value) throw new Error('useLicense necesita un LicenseProvider');
  return value;
}
