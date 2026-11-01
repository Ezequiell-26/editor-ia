/**
 * Puente entre la biblioteca de Diseño y las herramientas que consumen su
 * paleta. La selección es deliberadamente pequeña: sólo colores sólidos que
 * un canvas o una miniatura puedan usar sin resolver variables CSS.
 */
export const DESIGN_SELECTION_KEY = 'editoria.design-system.v1';
export const DESIGN_APPLIED_EVENT = 'olyvia:design-applied';

export interface DesignSelection {
  readonly id: string;
  readonly name: string;
  readonly accent: string;
  readonly accentOn: string | null;
  readonly bg: string | null;
  readonly fg: string | null;
  readonly appliedAt: string;
}

export interface ApplyableDesign {
  readonly id: string;
  readonly name: string;
  readonly canvas: {
    readonly accent: string | null;
    readonly accentOn: string | null;
    readonly bg: string | null;
    readonly fg: string | null;
  };
}

function isSelection(value: unknown): value is DesignSelection {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.accent === 'string' &&
    /^#[0-9a-f]{6}$/i.test(entry.accent)
  );
}

export function loadDesignSelection(): DesignSelection | null {
  try {
    const raw = window.localStorage.getItem(DESIGN_SELECTION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function applyDesignSystem(
  entry: ApplyableDesign,
  now: () => string = () => new Date().toISOString(),
): DesignSelection | null {
  if (!entry.canvas.accent || !/^#[0-9a-f]{6}$/i.test(entry.canvas.accent)) {
    return null;
  }
  const selection: DesignSelection = {
    id: entry.id,
    name: entry.name,
    accent: entry.canvas.accent,
    accentOn: entry.canvas.accentOn,
    bg: entry.canvas.bg,
    fg: entry.canvas.fg,
    appliedAt: now(),
  };
  try {
    window.localStorage.setItem(DESIGN_SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // Sin almacenamiento la paleta sigue aplicándose en la sesión actual.
  }
  window.dispatchEvent(new CustomEvent<DesignSelection>(DESIGN_APPLIED_EVENT, { detail: selection }));
  return selection;
}
