/**
 * Registro de atajos de teclado personalizables.
 *
 * El usuario puede reasignar cualquier atajo desde Ajustes → Atajos. Los
 * cambios persisten en localStorage y se avisan con un evento global para que
 * los listeners de larga vida (App) relean el mapa sin recargar.
 *
 * Los atajos "pro" (shuttle, paso a frame, timeline) sólo registran acciones
 * que ya existen en la app; la tabla por área, qué teclas ya operan hoy y los
 * pendientes están documentados en docs/ATAJOS-PRO.md.
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
  | 'playback.playPause'
  // Atajos "pro" (paridad CapCut / DaVinci / Premiere): sólo acciones que ya
  // existen en la app. Detalle por área, estado de cableado y pendientes en
  // docs/ATAJOS-PRO.md.
  | 'playback.shuttleForward'
  | 'playback.shuttlePause'
  | 'playback.framePrev'
  | 'playback.frameNext'
  | 'playback.goToStart'
  | 'playback.goToEnd'
  | 'timeline.splitAtPlayhead'
  | 'timeline.toggleMarker'
  | 'timeline.trimIn'
  | 'timeline.trimOut'
  | 'timeline.zoomIn'
  | 'timeline.zoomOut'
  | 'timeline.zoomFit'
  // Fase 2 de accesibilidad: mover y recortar el clip seleccionado con el
  // teclado (operan vía el handler propio del editor, como S y M).
  | 'timeline.clipMoveLeft'
  | 'timeline.clipMoveRight'
  | 'timeline.clipMoveTrackUp'
  | 'timeline.clipMoveTrackDown'
  | 'timeline.clipTrimIn'
  | 'timeline.clipTrimOut';

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
  'playback.shuttleForward': 'Shuttle: reproducir hacia adelante',
  'playback.shuttlePause': 'Shuttle: pausar',
  'playback.framePrev': 'Frame anterior',
  'playback.frameNext': 'Frame siguiente',
  'playback.goToStart': 'Ir al inicio de la timeline',
  'playback.goToEnd': 'Ir al final de la timeline',
  'timeline.splitAtPlayhead': 'Dividir clip en el playhead',
  'timeline.toggleMarker': 'Marcador en el playhead',
  'timeline.trimIn': 'Recortar entrada del clip al playhead',
  'timeline.trimOut': 'Recortar salida del clip al playhead',
  'timeline.zoomIn': 'Acercar timeline',
  'timeline.zoomOut': 'Alejar timeline',
  'timeline.zoomFit': 'Ajustar zoom a la duración',
  'timeline.clipMoveLeft': 'Mover el clip seleccionado 1 frame a la izquierda (con Shift: 1 s)',
  'timeline.clipMoveRight': 'Mover el clip seleccionado 1 frame a la derecha (con Shift: 1 s)',
  'timeline.clipMoveTrackUp': 'Subir el clip a la pista compatible anterior',
  'timeline.clipMoveTrackDown': 'Bajar el clip a la pista compatible siguiente',
  'timeline.clipTrimIn': 'Recortar el borde de entrada del clip seleccionado',
  'timeline.clipTrimOut': 'Recortar el borde de salida del clip seleccionado',
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
  'playback.shuttleForward': 'Reproducción',
  'playback.shuttlePause': 'Reproducción',
  'playback.framePrev': 'Reproducción',
  'playback.frameNext': 'Reproducción',
  'playback.goToStart': 'Reproducción',
  'playback.goToEnd': 'Reproducción',
  'timeline.splitAtPlayhead': 'Timeline',
  'timeline.toggleMarker': 'Timeline',
  'timeline.trimIn': 'Timeline',
  'timeline.trimOut': 'Timeline',
  'timeline.zoomIn': 'Timeline',
  'timeline.zoomOut': 'Timeline',
  'timeline.zoomFit': 'Timeline',
  'timeline.clipMoveLeft': 'Timeline',
  'timeline.clipMoveRight': 'Timeline',
  'timeline.clipMoveTrackUp': 'Timeline',
  'timeline.clipMoveTrackDown': 'Timeline',
  'timeline.clipTrimIn': 'Timeline',
  'timeline.clipTrimOut': 'Timeline',
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
  // Shuttle: L reproduce (setPlaying(true)), K pausa (setPlaying(false)).
  // J no se registra: el motor de reproducción no soporta ir hacia atrás.
  'playback.shuttleForward': 'L',
  'playback.shuttlePause': 'K',
  'playback.framePrev': ',',
  'playback.frameNext': '.',
  'playback.goToStart': 'Home',
  'playback.goToEnd': 'End',
  // S y M ya operan hoy vía handlers propios del editor (EditorWorkspace y
  // Timeline); el registro documenta esa tecla y permite reasignarla.
  'timeline.splitAtPlayhead': 'S',
  'timeline.toggleMarker': 'M',
  'timeline.trimIn': '[',
  'timeline.trimOut': ']',
  'timeline.zoomIn': '+',
  'timeline.zoomOut': '-',
  'timeline.zoomFit': 'F',
  // Edición de clip por teclado (fase 2 de accesibilidad): Alt mueve el clip
  // (con Shift, de a 1 segundo); Ctrl+Alt recorta el borde que la combinación
  // agarra (entrada sin Shift, salida con Shift). Flechas sin Alt siguen
  // moviendo el playhead. Operan vía EditorWorkspace.tsx; detalle en
  // docs/ATAJOS-PRO.md.
  'timeline.clipMoveLeft': 'Alt+ArrowLeft',
  'timeline.clipMoveRight': 'Alt+ArrowRight',
  'timeline.clipMoveTrackUp': 'Alt+ArrowUp',
  'timeline.clipMoveTrackDown': 'Alt+ArrowDown',
  'timeline.clipTrimIn': 'Ctrl+Alt+ArrowLeft',
  'timeline.clipTrimOut': 'Ctrl+Alt+ArrowRight',
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
  // La tecla '+' es a la vez el separador del formato canónico: sin este caso
  // especial, '+'.split('+') devolvería una lista vacía y el binding se perdería.
  if (binding.trim() === '+') return '+';
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

// ---------------------------------------------------------------------------
// Activación nativa de controles (auditoría de accesibilidad H16)
// ---------------------------------------------------------------------------

/** Controles que el navegador activa con Space/Enter cuando tienen el foco. */
const ACTIVATABLE_TAGS = new Set([
  'BUTTON',
  'SUMMARY',
  'MENUITEM',
  'SELECT',
  'OPTION',
  'INPUT',
  'TEXTAREA',
]);

/** Roles ARIA con el mismo contrato de activación que un botón. */
const ACTIVATABLE_ROLES = new Set([
  'button',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
  'tab',
]);

/**
 * ¿El evento de teclado cayó sobre un control que se activa con Space?
 *
 * El click de activación por Space ocurre en keyup y no se dispara si el
 * keydown se previene: un atajo global que haga `preventDefault` en keydown
 * (como Reproducir/Pausar con Espacio) roba la activación del control
 * enfocado. El despacho global debe dejar pasar el evento cuando el foco está
 * en uno de estos controles.
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (ACTIVATABLE_TAGS.has(target.tagName)) return true;
  const role = target.getAttribute('role');
  return role !== null && ACTIVATABLE_ROLES.has(role);
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
