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
  type ThemePresetId,
} from './appearance';
import {
  THEME_PALETTES,
  paletteBaseColors,
  paletteFromBase,
  type ThemePalette,
} from './theme-palette';

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
  /** Cambia un tema entero: actualiza el estado y persiste. */
  setPalette(palette: ThemePalette, preset?: ThemePresetId): void;
  /** Arrastrar un color: pinta la paleta en vivo y NO re-renderiza el árbol. */
  previewPalette(palette: ThemePalette): void;
  /** Aplica uno de los 7 presets completos (Olyvia, Resolve, …). */
  applyThemePreset(preset: Exclude<ThemePresetId, 'custom'>): void;
  /** Compatibilidad: aplica los 5 colores base y el preset elegido. */
  applyTheme(colors: ThemeColors, preset: ThemePresetId): void;
  reset(): void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Agrupa ráfagas de guardado para no escribir localStorage en cada evento. */
const SAVE_DEBOUNCE_MS = 280;

/** Patch que reemplaza la paleta y mantiene sincronizados los 5 espejos base. */
function palettePatch(
  palette: ThemePalette,
): Pick<AppearanceSettings, 'palette' | 'accent' | 'info' | 'background' | 'surface' | 'text'> {
  return { palette, ...paletteBaseColors(palette) };
}

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

  const setPalette = useCallback(
    (palette: ThemePalette, preset: ThemePresetId = 'custom') => {
      update({ ...palettePatch(palette), preset });
    },
    [update],
  );

  const previewPalette = useCallback(
    (palette: ThemePalette) => {
      preview({ ...palettePatch(palette), preset: 'custom' });
    },
    [preview],
  );

  const applyThemePreset = useCallback(
    (preset: Exclude<ThemePresetId, 'custom'>) => {
      update({ ...palettePatch(THEME_PALETTES[preset]), preset });
    },
    [update],
  );

  const applyTheme = useCallback(
    (colors: ThemeColors, preset: ThemePresetId) => {
      const palette = preset === 'custom' ? paletteFromBase(colors) : THEME_PALETTES[preset];
      update({ ...palettePatch(palette), ...colors, preset });
    },
    [update],
  );

  const reset = useCallback(() => {
    update(DEFAULT_APPEARANCE);
  }, [update]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearance,
      update,
      preview,
      commitPreview,
      setPalette,
      previewPalette,
      applyThemePreset,
      applyTheme,
      reset,
    }),
    [
      appearance,
      applyTheme,
      applyThemePreset,
      commitPreview,
      preview,
      previewPalette,
      reset,
      setPalette,
      update,
    ],
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
