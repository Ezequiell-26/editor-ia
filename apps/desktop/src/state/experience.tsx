/**
 * Modo de uso de la app: **guiado** o **pro**.
 *
 * Es la respuesta del producto a sus dos públicos (editores profesionales y
 * principiantes): el modo guiado deja el rail en el camino de trabajo y las
 * herramientas de todos los días; el modo pro muestra todo. No es un candado —
 * el menú Ver sigue listando todas las vistas—: es decluttering con una sola
 * preferencia, persistida en esta máquina.
 *
 * Por defecto es **pro**: cero regresión para quien ya usa la app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { NavView } from '../app/navigation';

export const EXPERIENCE_STORAGE_KEY = 'editor-ia.experience.v1';

export type ExperienceMode = 'guiada' | 'pro';

export const DEFAULT_EXPERIENCE_MODE: ExperienceMode = 'pro';

/** Vistas que el modo guiado saca del rail: superficies de especialistas. */
const GUIDED_HIDDEN_VIEWS: ReadonlySet<string> = new Set([
  'lab',
  'production',
]);

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return value === 'guiada' || value === 'pro';
}

export function loadExperienceMode(storage: Pick<Storage, 'getItem'> | null = safeStorage()): ExperienceMode {
  if (!storage) return DEFAULT_EXPERIENCE_MODE;
  try {
    const value = storage.getItem(EXPERIENCE_STORAGE_KEY);
    return isExperienceMode(value) ? value : DEFAULT_EXPERIENCE_MODE;
  } catch {
    return DEFAULT_EXPERIENCE_MODE;
  }
}

export function saveExperienceMode(
  mode: ExperienceMode,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(EXPERIENCE_STORAGE_KEY, mode);
  } catch {
    // Sin almacenamiento, el modo vive sólo en la sesión.
  }
}

/** Filtra el rail según el modo. Función pura para poder probarla. */
export function filterViewsForMode(
  views: readonly NavView[],
  mode: ExperienceMode,
): readonly NavView[] {
  if (mode === 'pro') return views;
  return views.filter((view) => !GUIDED_HIDDEN_VIEWS.has(view.id));
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

interface ExperienceContextValue {
  readonly mode: ExperienceMode;
  setMode(mode: ExperienceMode): void;
}

const ExperienceContext = createContext<ExperienceContextValue | null>(null);

export function ExperienceProvider({ children }: { readonly children: ReactNode }) {
  const [mode, setModeState] = useState<ExperienceMode>(loadExperienceMode);

  useEffect(() => {
    saveExperienceMode(mode);
  }, [mode]);

  const setMode = useCallback((next: ExperienceMode) => {
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

export function useExperienceMode(): ExperienceContextValue {
  const value = useContext(ExperienceContext);
  if (!value) {
    throw new Error('useExperienceMode necesita un ExperienceProvider');
  }
  return value;
}
