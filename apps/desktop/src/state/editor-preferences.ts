/**
 * Preferencias de comportamiento del editor.
 *
 * A diferencia de `appearance` (que sólo cambia el aspecto), este archivo
 * guarda decisiones que cambian cómo responde el editor: cuánto tarda el
 * autoguardado, cuánto historial se conserva, con qué zoom abre la timeline y
 * qué capas de información se dibujan sobre los clips.
 *
 * Todo vive en `localStorage` de este equipo, cada campo está acotado y el
 * archivo completo se puede restablecer desde Ajustes → Editor.
 */

export const EDITOR_PREFS_STORAGE_KEY = 'editoria.editor-prefs.v1';
export const EDITOR_PREFS_CHANGED_EVENT = 'editoria:editor-prefs-changed';
/**
 * Clave histórica del toggle Ripple (vivía en la timeline). Se conserva para
 * migrar el valor a `timelineRipple` en la primera lectura; el toggle ahora
 * vive en Ajustes → Editor con el resto de preferencias.
 */
export const LEGACY_TIMELINE_RIPPLE_KEY = 'editoria.timeline-ripple.v1';

export interface EditorPreferences {
  readonly version: 1;
  /** Retardo del autoguardado tras el último cambio, en milisegundos. */
  readonly autosaveDelayMs: number;
  /** Cuántos pasos de deshacer se conservan. */
  readonly historyLimit: number;
  /** Zoom inicial de la timeline en píxeles por frame. */
  readonly defaultZoom: number;
  /** El imán arranca activo. */
  readonly snapEnabled: boolean;
  /** Tolerancia del imán en píxeles de pantalla. */
  readonly snapPixels: number;
  /** La timeline acompaña al playhead durante la reproducción. */
  readonly followPlayhead: boolean;
  /** Dibuja la forma de onda sobre los clips de audio. */
  readonly showWaveforms: boolean;
  /** Dibuja la miniatura sobre los clips visuales. */
  readonly showThumbnails: boolean;
  /** Al terminar, vuelve al inicio en lugar de detenerse. */
  readonly loopPlayback: boolean;
  /** Cuántos frames avanza la flecha del teclado. */
  readonly jumpStepFrames: number;
  /** Las guías de acción y título arrancan visibles. */
  readonly safeMargins: boolean;
  /** Estilo de emoji para la preview y el selector: Android o abierto. */
  readonly emojiStyle: 'android' | 'open';
  /** Densidad visual de la timeline: cómoda (default) o compacta. */
  readonly timelineDensity: 'comfortable' | 'compact';
  /** Etiquetas de clip: nombre + ventana (full) o sólo el nombre (minimal). */
  readonly timelineClipLabels: 'full' | 'minimal';
  /** Rejilla temporal sutil alineada con las marcas mayores de la regla. */
  readonly timelineShowGrid: boolean;
  /**
   * Ripple editing: mover/recortar desplaza los clips posteriores para no dejar
   * huecos. Default false (retrocompatible; migra `editoria.timeline-ripple.v1`).
   */
  readonly timelineRipple: boolean;
  /**
   * Proxies de reproducción: la UI decide cuándo pedirlos (el backend no
   * auto-genera). `autoProxy` genera para video >1080p; `proxyQuality` fija la
   * resolución del proxy.
   */
  readonly autoProxy: boolean;
  readonly proxyQuality: '540p' | '720p';
}

/** Almacenamiento mínimo que necesitan estas preferencias. */
export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  version: 1,
  autosaveDelayMs: 1_400,
  historyLimit: 80,
  defaultZoom: 2.4,
  snapEnabled: true,
  snapPixels: 10,
  followPlayhead: true,
  showWaveforms: true,
  showThumbnails: true,
  loopPlayback: false,
  jumpStepFrames: 1,
  safeMargins: false,
  emojiStyle: 'android',
  timelineDensity: 'comfortable',
  timelineClipLabels: 'full',
  timelineShowGrid: true,
  timelineRipple: false,
  autoProxy: false,
  proxyQuality: '540p',
};

/** Límites duros por campo: la UI y la normalización comparten la misma tabla. */
export const EDITOR_PREFERENCE_BOUNDS = {
  autosaveDelayMs: { min: 500, max: 8_000, step: 100 },
  historyLimit: { min: 20, max: 200, step: 10 },
  defaultZoom: { min: 0.4, max: 6, step: 0.1 },
  snapPixels: { min: 4, max: 24, step: 1 },
  jumpStepFrames: { min: 1, max: 60, step: 1 },
} as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)) * 100) / 100;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Convierte cualquier cosa leída de disco en preferencias seguras y acotadas. */
export function normalizeEditorPreferences(raw: unknown): EditorPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bounds = EDITOR_PREFERENCE_BOUNDS;
  return {
    version: 1,
    autosaveDelayMs: clamp(
      source.autosaveDelayMs,
      bounds.autosaveDelayMs.min,
      bounds.autosaveDelayMs.max,
      DEFAULT_EDITOR_PREFERENCES.autosaveDelayMs,
    ),
    historyLimit: Math.round(
      clamp(
        source.historyLimit,
        bounds.historyLimit.min,
        bounds.historyLimit.max,
        DEFAULT_EDITOR_PREFERENCES.historyLimit,
      ),
    ),
    defaultZoom: clamp(
      source.defaultZoom,
      bounds.defaultZoom.min,
      bounds.defaultZoom.max,
      DEFAULT_EDITOR_PREFERENCES.defaultZoom,
    ),
    snapEnabled: bool(source.snapEnabled, DEFAULT_EDITOR_PREFERENCES.snapEnabled),
    snapPixels: Math.round(
      clamp(
        source.snapPixels,
        bounds.snapPixels.min,
        bounds.snapPixels.max,
        DEFAULT_EDITOR_PREFERENCES.snapPixels,
      ),
    ),
    followPlayhead: bool(source.followPlayhead, DEFAULT_EDITOR_PREFERENCES.followPlayhead),
    showWaveforms: bool(source.showWaveforms, DEFAULT_EDITOR_PREFERENCES.showWaveforms),
    showThumbnails: bool(source.showThumbnails, DEFAULT_EDITOR_PREFERENCES.showThumbnails),
    loopPlayback: bool(source.loopPlayback, DEFAULT_EDITOR_PREFERENCES.loopPlayback),
    jumpStepFrames: Math.round(
      clamp(
        source.jumpStepFrames,
        bounds.jumpStepFrames.min,
        bounds.jumpStepFrames.max,
        DEFAULT_EDITOR_PREFERENCES.jumpStepFrames,
      ),
    ),
    safeMargins: bool(source.safeMargins, DEFAULT_EDITOR_PREFERENCES.safeMargins),
    emojiStyle: source.emojiStyle === 'open' ? 'open' : 'android',
    timelineDensity: source.timelineDensity === 'compact' ? 'compact' : 'comfortable',
    timelineClipLabels: source.timelineClipLabels === 'minimal' ? 'minimal' : 'full',
    timelineShowGrid: bool(
      source.timelineShowGrid,
      DEFAULT_EDITOR_PREFERENCES.timelineShowGrid,
    ),
    timelineRipple: bool(
      source.timelineRipple,
      DEFAULT_EDITOR_PREFERENCES.timelineRipple,
    ),
    autoProxy: bool(source.autoProxy, DEFAULT_EDITOR_PREFERENCES.autoProxy),
    proxyQuality: source.proxyQuality === '720p' ? '720p' : '540p',
  };
}

function safeStorage(): PreferencesStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readLegacyRipple(
  storage: Pick<PreferencesStorage, 'getItem'> | null,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(LEGACY_TIMELINE_RIPPLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function loadEditorPreferences(
  storage: Pick<PreferencesStorage, 'getItem'> | null = safeStorage(),
): EditorPreferences {
  if (!storage) return DEFAULT_EDITOR_PREFERENCES;
  try {
    const text = storage.getItem(EDITOR_PREFS_STORAGE_KEY);
    if (!text) {
      // Primera lectura sin preferencias nuevas: si el usuario tenía el toggle
      // Ripple viejo activo, se migra sin cambiar el resto (defaults).
      return readLegacyRipple(storage)
        ? { ...DEFAULT_EDITOR_PREFERENCES, timelineRipple: true }
        : DEFAULT_EDITOR_PREFERENCES;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const preferences = normalizeEditorPreferences(parsed);
    // Migración retrocompatible: sólo si las preferencias nuevas todavía no
    // tienen el campo (proyectos/instalaciones previas a la Ola 2b).
    if (parsed.timelineRipple === undefined && readLegacyRipple(storage)) {
      return { ...preferences, timelineRipple: true };
    }
    return preferences;
  } catch {
    return DEFAULT_EDITOR_PREFERENCES;
  }
}

/**
 * Guarda y avisa. El evento permite que componentes de larga vida (el store,
 * la timeline) relean las preferencias sin recargar la ventana.
 */
export function saveEditorPreferences(
  preferences: EditorPreferences,
  storage: PreferencesStorage | null = safeStorage(),
): EditorPreferences {
  const normalized = normalizeEditorPreferences(preferences);
  try {
    storage?.setItem(EDITOR_PREFS_STORAGE_KEY, JSON.stringify(normalized));
    // Una vez que el valor vive en las preferencias nuevas, la clave histórica
    // del timeline se descarta para no re-migrar valores viejos al restablecer.
    storage?.removeItem?.(LEGACY_TIMELINE_RIPPLE_KEY);
  } catch {
    // Sin cuota o en modo privado: la sesión sigue con los valores en memoria.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(EDITOR_PREFS_CHANGED_EVENT, { detail: normalized }),
    );
  }
  return normalized;
}

/** Aplica un parche parcial sobre lo guardado y devuelve el resultado. */
export function updateEditorPreferences(
  patch: Partial<Omit<EditorPreferences, 'version'>>,
  storage?: PreferencesStorage | null,
): EditorPreferences {
  const target = storage === undefined ? safeStorage() : storage;
  const current = loadEditorPreferences(target);
  return saveEditorPreferences({ ...current, ...patch }, target);
}

export function resetEditorPreferences(
  storage?: PreferencesStorage | null,
): EditorPreferences {
  const target = storage === undefined ? safeStorage() : storage;
  try {
    target?.removeItem?.(EDITOR_PREFS_STORAGE_KEY);
  } catch {
    // nada que limpiar
  }
  return saveEditorPreferences(DEFAULT_EDITOR_PREFERENCES, target);
}

/**
 * Suscribe a los cambios de preferencias. Devuelve la función para desuscribir.
 * Escucha tanto el evento propio como `storage` (otra ventana).
 */
export function subscribeEditorPreferences(
  listener: (preferences: EditorPreferences) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = () => listener(loadEditorPreferences());
  window.addEventListener(EDITOR_PREFS_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EDITOR_PREFS_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
