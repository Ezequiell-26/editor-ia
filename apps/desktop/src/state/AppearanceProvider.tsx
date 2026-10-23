import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** Cambio discreto (un clic, un checkbox): aplica, actualiza el estado y guarda. */
  update(patch: Partial<AppearanceSettings>): void;
  /**
   * Cambio continuo (arrastrar un slider o la barra de color): escribe las
   * variables CSS en el próximo frame y NO re-renderiza el árbol. Se cierra con
   * `commitPreview()`.
   */
  preview(patch: Partial<AppearanceSettings>): void;
  /** Fija el último `preview` en el estado de React y lo persiste. */
  commitPreview(): void;
  applyTheme(colors: ThemeColors, preset: AppearanceSettings['preset']): void;
  reset(): void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Agrupa ráfagas de guardado para no escribir localStorage en cada evento. */
const SAVE_DEBOUNCE_MS = 280;

export function AppearanceProvider({ children }: { readonly children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(loadAppearance);

  // Valor efectivo: puede ir por delante del estado mientras se arrastra.
  const effectiveRef = useRef<AppearanceSettings>(appearance);
  const pendingRef = useRef<AppearanceSettings | null>(null);
  const frameRef = useRef(0);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    effectiveRef.current = appearance;
    applyAppearance(appearance);
  }, [appearance]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const scheduleSave = useCallback((next: AppearanceSettings) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      saveAppearance(next);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const preview = useCallback((patch: Partial<AppearanceSettings>) => {
    const next = normalizeAppearance({ ...effectiveRef.current, ...patch, version: 1 });
    effectiveRef.current = next;
    pendingRef.current = next;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const target = pendingRef.current;
      if (target) applyAppearance(target);
    });
  }, []);

  const commitPreview = useCallback(() => {
    const next = pendingRef.current ?? effectiveRef.current;
    pendingRef.current = null;
    setAppearance(next);
    scheduleSave(next);
  }, [scheduleSave]);

  const update = useCallback(
    (patch: Partial<AppearanceSettings>) => {
      const next = normalizeAppearance({ ...effectiveRef.current, ...patch, version: 1 });
      effectiveRef.current = next;
      pendingRef.current = null;
      setAppearance(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const applyTheme = useCallback(
    (colors: ThemeColors, preset: AppearanceSettings['preset']) => {
      update({ ...colors, preset });
    },
    [update],
  );

  const reset = useCallback(() => {
    update(DEFAULT_APPEARANCE);
  }, [update]);

  const value = useMemo<AppearanceContextValue>(
    () => ({ appearance, update, preview, commitPreview, applyTheme, reset }),
    [appearance, applyTheme, commitPreview, preview, reset, update],
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
