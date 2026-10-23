/**
 * Registro de atajos de teclado personalizables.
 *
 * El usuario puede reasignar cualquier atajo desde Ajustes → Atajos. Los
 * cambios persisten en localStorage y se avisan con un evento global para que
 * los listeners de larga vida (App) relean el mapa sin recargar.
 */

export const SHORTCUTS_STORAGE_KEY = 'editoria.shortcuts.v1';
export const SHORTCUTS_CHANGED_EVENT = 'editoria:shortcuts-changed';

export type ShortcutId =
  | 'palette.toggle'
  | 'nav.home'
  | 'nav.editor'
  | 'nav.script'
  | 'nav.assets'
  | 'nav.production'
  | 'nav.factory'
  | 'nav.director'
  | 'nav.download'
  | 'nav.settings'
  | 'file.save'
  | 'file.saveAs'
  | 'file.open'
  | 'file.export'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.duplicateClip'
  | 'edit.rippleDelete'
  | 'edit.deselect'
  | 'playback.playPause';

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  'palette.toggle': 'Paleta de comandos',
  'nav.home': 'Ir a Inicio',
  'nav.editor': 'Ir al Editor',
  'nav.script': 'Ir al Guion',
  'nav.assets': 'Ir a la Biblioteca',
  'nav.production': 'Ir a Producción',
  'nav.factory': 'Ir a la Fábrica',
  'nav.director': 'Ir al Director',
  'nav.download': 'Ir a Descargar',
  'nav.settings': 'Ir a Ajustes',
  'file.save': 'Guardar proyecto',
  'file.saveAs': 'Guardar como…',
  'file.open': 'Abrir proyecto…',
  'file.export': 'Exportar video',
  'edit.undo': 'Deshacer',
  'edit.redo': 'Rehacer',
  'edit.duplicateClip': 'Duplicar clip',
  'edit.rippleDelete': 'Eliminar clip y cerrar hueco',
  'edit.deselect': 'Deseleccionar todo',
  'playback.playPause': 'Reproducir / Pausar',
};

export const SHORTCUT_CATEGORIES: Record<ShortcutId, string> = {
  'palette.toggle': 'General',
  'nav.home': 'Navegación',
  'nav.editor': 'Navegación',
  'nav.script': 'Navegación',
  'nav.assets': 'Navegación',
  'nav.production': 'Navegación',
  'nav.factory': 'Navegación',
  'nav.director': 'Navegación',
  'nav.download': 'Navegación',
  'nav.settings': 'Navegación',
  'file.save': 'Archivo',
  'file.saveAs': 'Archivo',
  'file.open': 'Archivo',
  'file.export': 'Archivo',
  'edit.undo': 'Editar',
  'edit.redo': 'Editar',
  'edit.duplicateClip': 'Editar',
  'edit.rippleDelete': 'Editar',
  'edit.deselect': 'Editar',
  'playback.playPause': 'Reproducción',
};

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  'palette.toggle': 'Ctrl+K',
  'nav.home': 'Ctrl+1',
  'nav.editor': 'Ctrl+2',
  'nav.script': 'Ctrl+3',
  'nav.assets': 'Ctrl+4',
  'nav.production': 'Ctrl+5',
  'nav.factory': 'Ctrl+6',
  'nav.director': 'Ctrl+7',
  'nav.download': 'Ctrl+8',
  'nav.settings': 'Ctrl+9',
  'file.save': 'Ctrl+S',
  'file.saveAs': 'Ctrl+Shift+S',
  'file.open': 'Ctrl+O',
  'file.export': 'Ctrl+E',
  'edit.undo': 'Ctrl+Z',
  'edit.redo': 'Ctrl+Shift+Z',
  'edit.duplicateClip': 'Ctrl+D',
  'edit.rippleDelete': 'Ctrl+Shift+Delete',
  'edit.deselect': 'Escape',
  'playback.playPause': 'Space',
};

const ALL_IDS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[];

export type ShortcutMap = Record<ShortcutId, string>;

/** Combina los valores guardados con los defaults (tolera ids nuevos/viejos). */
export function loadShortcuts(): ShortcutMap {
  const map: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!raw) return map;
    const saved = JSON.parse(raw) as Partial<Record<string, string>>;
    for (const id of ALL_IDS) {
      const value = saved[id];
      if (typeof value === 'string' && value.trim()) {
        map[id] = normalizeBinding(value);
      }
    }
  } catch {
    // almacenamiento corrupto: quedan los defaults
  }
  return map;
}

export function saveShortcuts(map: ShortcutMap): void {
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // sin almacenamiento: los atajos viven solo en la sesión
  }
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT, { detail: { ...map } }));
}

/** Vuelve a los defaults de fábrica y avisa. */
export function resetShortcuts(): ShortcutMap {
  const map: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  try {
    window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
  } catch {
    // nada que limpiar
  }
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT, { detail: { ...map } }));
  return map;
}

/** Atajo activo por id: revisa el almacenamiento en cada consulta. */
export function getShortcut(id: ShortcutId): string {
  return loadShortcuts()[id] ?? DEFAULT_SHORTCUTS[id];
}

// ---------------------------------------------------------------------------
// Normalización y comparación
// ---------------------------------------------------------------------------

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const;

/** Clave normalizada: letras mayúsculas, espacio → Space, resto tal cual. */
function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Convierte un evento de teclado al formato canónico `Ctrl+Shift+K`. */
export function eventToBinding(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(event.key));
  return parts.join('+');
}

/** Normaliza un binding guardado al formato canónico. */
export function normalizeBinding(binding: string): string {
  const raw = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = raw
    .slice(0, -1)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'control' || lower === 'ctrl' || lower === 'cmd' || lower === 'meta') return 'Ctrl';
      if (lower === 'option' || lower === 'alt') return 'Alt';
      if (lower === 'shift') return 'Shift';
      return part;
    })
    .sort((a, b) => MODIFIER_ORDER.indexOf(a as 'Ctrl') - MODIFIER_ORDER.indexOf(b as 'Ctrl'));
  const key = normalizeKey(raw[raw.length - 1] ?? '');
  return [...modifiers, key].join('+');
}

/** ¿El evento dispara este binding? */
export function bindingMatches(event: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  return eventToBinding(event) === normalizeBinding(binding);
}

/**
 * ¿Es un binding aceptable? Exigimos modificador (Ctrl/Alt) o tecla especial:
 * una letra o número pelado impediría escribir en toda la app.
 */
export function isBindable(binding: string): boolean {
  const parts = normalizeBinding(binding).split('+').filter(Boolean);
  if (parts.length < 2) {
    const key = parts[0] ?? '';
    if (
      key.startsWith('F') && /^F\d{1,2}$/.test(key)
    ) {
      return true;
    }
    if (
      [
        'Space',
        'Escape',
        'Enter',
        'Tab',
        'Backspace',
        'Delete',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(key) ||
      key.startsWith('Arrow')
    ) {
      return true;
    }
    return false;
  }
  return parts.some((part) => part === 'Ctrl' || part === 'Alt');
}
