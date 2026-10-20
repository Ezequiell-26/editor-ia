import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  loadAppearance,
  normalizeAppearance,
  saveAppearance,
  type AppearanceSettings,
  type ThemeColors,
} from './appearance';

interface AppearanceContextValue {
  readonly appearance: AppearanceSettings;
  update(patch: Partial<AppearanceSettings>): void;
  applyTheme(colors: ThemeColors, preset: AppearanceSettings['preset']): void;
  reset(): void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { readonly children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(loadAppearance);

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  const commit = useCallback((next: AppearanceSettings) => {
    const safe = normalizeAppearance(next);
    saveAppearance(safe);
    setAppearance(safe);
  }, []);

  const update = useCallback(
    (patch: Partial<AppearanceSettings>) => {
      setAppearance((current) => {
        const next = normalizeAppearance({ ...current, ...patch, version: 1 });
        saveAppearance(next);
        return next;
      });
    },
    [],
  );

  const applyTheme = useCallback(
    (colors: ThemeColors, preset: AppearanceSettings['preset']) => {
      commit({ ...appearance, ...colors, preset });
    },
    [appearance, commit],
  );

  const reset = useCallback(() => {
    commit(DEFAULT_APPEARANCE);
  }, [commit]);

  const value = useMemo<AppearanceContextValue>(
    () => ({ appearance, update, applyTheme, reset }),
    [appearance, applyTheme, reset, update],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error('useAppearance requiere AppearanceProvider');
  }
  return value;
}
