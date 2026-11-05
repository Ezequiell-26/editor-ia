/**
 * Local appearance model.
 *
 * The editor is a desktop tool, so its chrome is part of the workspace: the
 * user can choose the palette, the typography, the scale and the density. All
 * of it is stored in this machine only (localStorage) and applied as CSS custom
 * properties, never baked into a project file.
 *
 * Desde la iteración «color customizable», el color vive en una paleta de 34
 * tokens (`state/theme-palette.ts`); este módulo guarda el modelo persistido,
 * conserva los 5 colores base como espejos por compatibilidad y emite las
 * variables no-color (tipografía, radios, zoom, sidebar).
 */

import {
  THEME_PALETTES,
  colorSchemeFor,
  hslToHex,
  hueOf,
  normalizePalette,
  paletteBaseColors,
  paletteCssVariables,
  paletteFromBase,
  type ThemeColors,
  type ThemePalette,
  type ThemePresetId,
  type ThemeTokenId,
} from './theme-palette';

// La api pública histórica de colors se mantiene disponible desde este módulo.
export { THEME_PRESETS, contrastInk, hslToHex, hueOf, mixHex } from './theme-palette';
export type { ThemeColors, ThemePalette, ThemePresetId } from './theme-palette';

/**
 * v4: la clave se conserva para no perder las preferencias ya guardadas. Los
 * datos sin `palette` se migran al leerlos (ver `normalizeAppearance`).
 */
export const APPEARANCE_STORAGE_KEY = 'editor-ia.appearance.v4';

export type Density = 'compact' | 'comfortable' | 'spacious';

export interface AppearanceSettings extends ThemeColors {
  readonly version: 1;
  readonly preset: ThemePresetId;
  /** Paleta completa de 34 tokens: la fuente de verdad del color. */
  readonly palette: ThemePalette;
  readonly fontUi: string;
  readonly fontDisplay: string;
  readonly fontMono: string;
  /** Global zoom factor applied to the whole shell (0.85–1.2). */
  readonly scale: number;
  readonly density: Density;
  readonly sidebarLabels: boolean;
  readonly sidebarWidth: number;
  readonly radius: number;
  readonly timelineRows: number;
  readonly showStatusbar: boolean;
  readonly reduceMotion: boolean;
}

export const UI_FONTS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'Segoe UI Variable Text', label: 'Segoe UI Variable' },
  { id: 'Segoe UI', label: 'Segoe UI' },
  { id: 'Arial', label: 'Arial' },
  { id: 'Verdana', label: 'Verdana' },
  { id: 'Tahoma', label: 'Tahoma' },
  { id: 'Trebuchet MS', label: 'Trebuchet MS' },
  { id: 'Georgia', label: 'Georgia' },
];

export const DISPLAY_FONTS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'Segoe UI Variable Display', label: 'Segoe UI Variable Display' },
  { id: 'Segoe UI', label: 'Segoe UI' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Trebuchet MS', label: 'Trebuchet MS' },
  { id: 'Arial', label: 'Arial' },
];

export const MONO_FONTS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'Cascadia Mono', label: 'Cascadia Mono' },
  { id: 'Cascadia Code', label: 'Cascadia Code' },
  { id: 'Consolas', label: 'Consolas' },
  { id: 'Courier New', label: 'Courier New' },
];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: 1,
  preset: 'filmora',
  ...paletteBaseColors(THEME_PALETTES.filmora),
  palette: THEME_PALETTES.filmora,
  fontUi: 'Segoe UI',
  fontDisplay: 'Segoe UI',
  fontMono: 'Cascadia Mono',
  scale: 1,
  density: 'compact',
  sidebarLabels: false,
  sidebarWidth: 172,
  // Filmora usa esquinas de 2 px en controles y paneles planos. El slider de
  // Apariencia sigue permitiendo 2–18 px: sólo cambia el valor por defecto.
  radius: 2,
  timelineRows: 48,
  showStatusbar: true,
  reduceMotion: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const FONT_NAMES = new Set(
  [...UI_FONTS, ...DISPLAY_FONTS, ...MONO_FONTS].map((font) => font.id),
);

/** Campos base persistidos por v4 y el token de paleta que espejan. */
const BASE_FIELDS: readonly { readonly field: keyof ThemeColors; readonly token: ThemeTokenId }[] = [
  { field: 'accent', token: 'accent' },
  { field: 'info', token: 'info' },
  { field: 'background', token: 'bg' },
  { field: 'surface', token: 'surface' },
  { field: 'text', token: 'text' },
];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)) * 100) / 100;
}

/**
 * Escala de la interfaz en pasos de 10 %.
 *
 * Cualquier valor intermedio (95 %, 105 %…) obliga a Chromium a rasterizar el
 * texto a tamaños fraccionarios: medido con capturas, el 95 % produce ~55 % de
 * píxeles de antialias por píxel sólido frente a ~35 % al 100 %. Esa niebla es
 * la que se percibe como «letras poco nítidas», así que la escala se ajusta a
 * 90/100/110/120 (100 = la más nítida).
 */
export const SCALE_STEPS: readonly number[] = [0.9, 1, 1.1, 1.2];

export function snapScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_APPEARANCE.scale;
  // Redondeo entero a décimas (0,95 → 1): evita el empate en coma flotante que
  // dejaba 95 % en 90 %.
  const stepped = Math.round(numeric * 10) / 10;
  return Math.min(SCALE_STEPS[SCALE_STEPS.length - 1]!, Math.max(SCALE_STEPS[0]!, stepped));
}

function validHex(value: unknown): string | null {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function hex(value: unknown, fallback: string): string {
  return validHex(value) ?? fallback;
}

function font(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return FONT_NAMES.has(trimmed) ? trimmed : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function density(value: unknown): Density {
  return value === 'compact' || value === 'comfortable' || value === 'spacious'
    ? value
    : DEFAULT_APPEARANCE.density;
}

function preset(value: unknown): ThemePresetId {
  return value === 'olyvia' ||
    value === 'filmora' ||
    value === 'resolve' ||
    value === 'mint' ||
    value === 'ember' ||
    value === 'violet' ||
    value === 'ocean' ||
    value === 'graphite' ||
    value === 'light' ||
    value === 'custom'
    ? value
    : DEFAULT_APPEARANCE.preset;
}

/**
 * Coerce anything read from disk into a safe, bounded appearance.
 *
 * La paleta se resuelve en tres pasos (contrato §2.5):
 * 1. fallback = preset completo o derivación desde los 5 base si es `custom`;
 * 2. `normalizePalette` aplica sólo los tokens válidos guardados;
 * 3. compatibilidad v4: un campo base presente y distinto del token manda y
 *    actualiza ese token (los datos viejos guardaban sólo esos 5 colores).
 */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const presetId = preset(source.preset);
  const base: Record<keyof ThemeColors, string> = {
    accent: hex(source.accent, DEFAULT_APPEARANCE.accent),
    info: hex(source.info, DEFAULT_APPEARANCE.info),
    background: hex(source.background, DEFAULT_APPEARANCE.background),
    surface: hex(source.surface, DEFAULT_APPEARANCE.surface),
    text: hex(source.text, DEFAULT_APPEARANCE.text),
  };
  const fallbackPalette =
    presetId === 'custom' ? paletteFromBase(base) : THEME_PALETTES[presetId];
  let palette = normalizePalette(source.palette, fallbackPalette);
  for (const { field, token } of BASE_FIELDS) {
    const explicit = validHex(source[field]);
    if (explicit && explicit !== palette[token]) {
      palette = { ...palette, [token]: explicit };
    }
  }
  const mirrors = paletteBaseColors(palette);
  return {
    version: 1,
    preset: presetId,
    ...mirrors,
    palette,
    fontUi: font(source.fontUi, DEFAULT_APPEARANCE.fontUi),
    fontDisplay: font(source.fontDisplay, DEFAULT_APPEARANCE.fontDisplay),
    fontMono: font(source.fontMono, DEFAULT_APPEARANCE.fontMono),
    scale: snapScale(source.scale),
    density: density(source.density),
    sidebarLabels: bool(source.sidebarLabels, DEFAULT_APPEARANCE.sidebarLabels),
    sidebarWidth: clamp(source.sidebarWidth, 150, 320, DEFAULT_APPEARANCE.sidebarWidth),
    radius: clamp(source.radius, 2, 18, DEFAULT_APPEARANCE.radius),
    timelineRows: clamp(source.timelineRows, 34, 76, DEFAULT_APPEARANCE.timelineRows),
    showStatusbar: bool(source.showStatusbar, DEFAULT_APPEARANCE.showStatusbar),
    reduceMotion: bool(source.reduceMotion, DEFAULT_APPEARANCE.reduceMotion),
  };
}

function stack(name: string, fallback: string): string {
  return `'${name}', ${fallback}`;
}

/**
 * CSS custom properties and data attributes for the current appearance.
 *
 * Los colores se delegan por completo en la paleta; acá sólo quedan las
 * variables no-color de siempre más el matiz del acento (que la paleta ya
 * emite y se repite para conservar el contrato histórico de este módulo).
 */
export function appearanceCssVariables(appearance: AppearanceSettings): Record<string, string> {
  const sidebar = appearance.sidebarLabels ? appearance.sidebarWidth : 40;
  return {
    ...paletteCssVariables(appearance.palette),
    '--primary-hue': String(hueOf(appearance.palette.accent)),
    '--font-ui': stack(appearance.fontUi, "'Segoe UI', system-ui, sans-serif"),
    '--font-display': stack(appearance.fontDisplay, "'Segoe UI', system-ui, sans-serif"),
    '--font-mono': stack(appearance.fontMono, 'ui-monospace, monospace'),
    '--sidebar-width': `${sidebar}px`,
    '--sidebar-min': `${sidebar}px`,
    '--sidebar-max': `${sidebar}px`,
    // Escala de esquinas: pequeña = radio - 2, media = radio, grande = radio + 2.
    '--radius-1': `${Math.max(2, appearance.radius - 2)}px`,
    '--radius-2': `${appearance.radius}px`,
    '--radius-3': `${appearance.radius + 2}px`,
    '--timeline-row': `${appearance.timelineRows}px`,
    '--app-zoom': String(appearance.scale),
    '--app-width': `${100 / appearance.scale}vw`,
    '--app-height': `${100 / appearance.scale}dvh`,
  };
}

export function applyAppearance(
  appearance: AppearanceSettings,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return;
  for (const [name, value] of Object.entries(appearanceCssVariables(appearance))) {
    root.style.setProperty(name, value);
  }
  // El navegador pinta controles nativos (scrollbars, inputs) según el tema.
  const scheme = colorSchemeFor(appearance.palette);
  root.style.colorScheme = scheme;
  // Marca explícita para que la capa visual sepa si debe usar superficies
  // oscuras o claras: `prefers-color-scheme` sigue al SO, no al preset.
  root.dataset.theme = scheme;
  root.dataset.density = appearance.density;
  root.dataset.reduceMotion = String(appearance.reduceMotion);
  root.dataset.statusbar = appearance.showStatusbar ? 'visible' : 'hidden';
  root.dataset.sidebar = appearance.sidebarLabels ? 'labels' : 'rail';
}

/**
 * Migración del rediseño visual, aplicada SÓLO a preferencias persistidas.
 *
 * Si lo guardado es exactamente el default cobalt anterior (sin
 * personalizar), se adopta el nuevo preset Filmora. Los temas
 * personalizados, los demás presets y el tema claro quedan intactos.
 * Está acá y no en `normalizeAppearance` porque esa función también recibe
 * los cambios explícitos del usuario: ponerla ahí impedía volver a elegir
 * «Olyvia» desde el estudio de color o desde Apariencia.
 */
const APPEARANCE_DESIGN_MARKER = 'filmora-12';

function migrateStoredAppearance(settings: AppearanceSettings): AppearanceSettings {
  const { palette } = settings;
  if (
    settings.preset === 'olyvia' &&
    palette.accent === '#1f5eff' &&
    palette.bg === '#0f1115' &&
    palette.surface === '#181b20' &&
    palette.text === '#f2f5ff'
  ) {
    return {
      ...settings,
      preset: 'filmora',
      ...paletteBaseColors(THEME_PALETTES.filmora),
      palette: THEME_PALETTES.filmora,
    };
  }
  return settings;
}

export function loadAppearance(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AppearanceSettings {
  if (!storage) return DEFAULT_APPEARANCE;
  try {
    const text = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (!text) return DEFAULT_APPEARANCE;
    const raw: unknown = JSON.parse(text);
    const settings = normalizeAppearance(raw);
    // Sólo migra datos de la generación anterior. `saveAppearance` escribe
    // la marca en CADA guardado, así que una elección explícita posterior
    // (por ejemplo volver al preset «Olyvia») nunca se vuelve a migrar.
    const marked =
      raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)._design === APPEARANCE_DESIGN_MARKER
        : false;
    return marked ? settings : migrateStoredAppearance(settings);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(
  appearance: AppearanceSettings,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...appearance, _design: APPEARANCE_DESIGN_MARKER }),
    );
  } catch {
    // Private mode or a full quota: the app keeps the in-memory appearance.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- //
// Color por matiz (para la barra de color)
// --------------------------------------------------------------------------- //

/**
 * Paleta de dos colores derivada de un matiz. El acento se mantiene legible
 * sobre fondo oscuro y el color secundario queda a 150° para que no compita.
 */
export function paletteFromHue(hue: number): Pick<ThemeColors, 'accent' | 'info'> {
  return {
    accent: hslToHex(hue, 0.74, 0.63),
    info: hslToHex(hue + 150, 0.62, 0.66),
  };
}
