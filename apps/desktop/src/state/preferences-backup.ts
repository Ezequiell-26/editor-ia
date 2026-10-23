/**
 * Respaldo y restauración de las preferencias locales.
 *
 * El editor guarda tres bloques separados en `localStorage`: apariencia,
 * atajos y preferencias de comportamiento. Este módulo los reúne en un único
 * archivo JSON legible, y vuelve a aplicarlos con validación campo por campo.
 *
 * Regla de honestidad: un archivo corrupto no se aplica a medias ni se da por
 * bueno. `parsePreferencesBundle` devuelve un error explicable y el llamador
 * decide qué mostrar.
 */

import {
  DEFAULT_APPEARANCE,
  loadAppearance,
  normalizeAppearance,
  saveAppearance,
  type AppearanceSettings,
} from './appearance';
import {
  DEFAULT_EDITOR_PREFERENCES,
  loadEditorPreferences,
  normalizeEditorPreferences,
  saveEditorPreferences,
  type EditorPreferences,
} from './editor-preferences';
import {
  DEFAULT_SHORTCUTS,
  isBindable,
  loadShortcuts,
  normalizeBinding,
  saveShortcuts,
  type ShortcutId,
  type ShortcutMap,
} from './shortcuts';

export const PREFERENCES_BUNDLE_KIND = 'editor-ia-preferences';
export const PREFERENCES_BUNDLE_VERSION = 1;

export interface PreferencesBundle {
  readonly kind: typeof PREFERENCES_BUNDLE_KIND;
  readonly version: typeof PREFERENCES_BUNDLE_VERSION;
  readonly exportedAt: string;
  readonly appearance: AppearanceSettings;
  readonly editor: EditorPreferences;
  readonly shortcuts: ShortcutMap;
}

export type PreferencesParseResult =
  | { readonly ok: true; readonly bundle: PreferencesBundle }
  | { readonly ok: false; readonly error: string };

export interface PreferencesApplySummary {
  readonly appearance: boolean;
  readonly editor: boolean;
  readonly shortcuts: number;
}

const SHORTCUT_IDS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[];

/** Reúne el estado actual de este equipo en un paquete exportable. */
export function buildPreferencesBundle(now: Date = new Date()): PreferencesBundle {
  return {
    kind: PREFERENCES_BUNDLE_KIND,
    version: PREFERENCES_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    appearance: loadAppearance(),
    editor: loadEditorPreferences(),
    shortcuts: loadShortcuts(),
  };
}

/** JSON estable y legible: dos espacios, claves en orden fijo. */
export function serializePreferencesBundle(bundle: PreferencesBundle): string {
  return `${JSON.stringify(
    {
      kind: bundle.kind,
      version: bundle.version,
      exportedAt: bundle.exportedAt,
      appearance: bundle.appearance,
      editor: bundle.editor,
      shortcuts: bundle.shortcuts,
    },
    null,
    2,
  )}\n`;
}

function readShortcuts(raw: unknown): { map: ShortcutMap; applied: number } {
  const map: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  if (!raw || typeof raw !== 'object') return { map, applied: 0 };
  const source = raw as Record<string, unknown>;
  let applied = 0;
  for (const id of SHORTCUT_IDS) {
    const value = source[id];
    if (typeof value !== 'string' || !value.trim()) continue;
    const binding = normalizeBinding(value);
    // Un binding sin modificador ni tecla especial rompería la escritura:
    // se descarta en lugar de aceptarlo y dejar el teclado inutilizable.
    if (!isBindable(binding)) continue;
    map[id] = binding;
    applied += 1;
  }
  return { map, applied };
}

/**
 * Valida un paquete. Acepta el texto tal cual salió del archivo o el objeto ya
 * parseado. Los campos desconocidos se ignoran; los inválidos se normalizan a
 * los valores por defecto del campo.
 */
export function parsePreferencesBundle(raw: string | unknown): PreferencesParseResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) {
      return { ok: false, error: 'El archivo está vacío.' };
    }
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: 'El archivo no es JSON válido.' };
    }
  }
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'El archivo no contiene un objeto de preferencias.' };
  }
  const source = value as Record<string, unknown>;
  if (source.kind !== PREFERENCES_BUNDLE_KIND) {
    return {
      ok: false,
      error: 'El archivo no es un respaldo de Editor IA (falta la marca del paquete).',
    };
  }
  if (typeof source.version === 'number' && source.version > PREFERENCES_BUNDLE_VERSION) {
    return {
      ok: false,
      error: `El respaldo es de una versión más nueva (v${source.version}); esta app entiende hasta v${PREFERENCES_BUNDLE_VERSION}.`,
    };
  }
  const shortcuts = readShortcuts(source.shortcuts);
  return {
    ok: true,
    bundle: {
      kind: PREFERENCES_BUNDLE_KIND,
      version: PREFERENCES_BUNDLE_VERSION,
      exportedAt:
        typeof source.exportedAt === 'string' && source.exportedAt.trim()
          ? source.exportedAt
          : new Date(0).toISOString(),
      appearance: normalizeAppearance(source.appearance ?? DEFAULT_APPEARANCE),
      editor: normalizeEditorPreferences(source.editor ?? DEFAULT_EDITOR_PREFERENCES),
      shortcuts: shortcuts.map,
    },
  };
}

/** Escribe el paquete en el almacenamiento local y avisa a los suscriptores. */
export function applyPreferencesBundle(bundle: PreferencesBundle): PreferencesApplySummary {
  saveAppearance(bundle.appearance);
  saveEditorPreferences(bundle.editor);
  const shortcuts = readShortcuts(bundle.shortcuts);
  saveShortcuts(shortcuts.map);
  return {
    appearance: true,
    editor: true,
    shortcuts: shortcuts.applied,
  };
}

/** Atajo de una línea: valida y aplica. */
export function importPreferencesFromText(
  text: string,
): { readonly ok: true; readonly summary: PreferencesApplySummary } | { readonly ok: false; readonly error: string } {
  const parsed = parsePreferencesBundle(text);
  if (!parsed.ok) return parsed;
  return { ok: true, summary: applyPreferencesBundle(parsed.bundle) };
}

/** Nombre de archivo estable para el respaldo. */
export function preferencesFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `editor-ia-preferencias-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
