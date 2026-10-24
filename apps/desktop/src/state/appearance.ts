/**
 * Local appearance model.
 *
 * The editor is a desktop tool, so its chrome is part of the workspace: the
 * user can choose the palette, the typography, the scale and the density. All
 * of it is stored in this machine only (localStorage) and applied as CSS custom
 * properties, never baked into a project file.
 */

/**
 * v3: la identidad visual es Olyvia (azul/cian/violeta del emblema orbital).
 * Se cambia la clave a propósito para que una instalación existente reciba el
 * tema de marca en vez de conservar el grafito de la etapa Editor IA.
 */
export const APPEARANCE_STORAGE_KEY = 'editor-ia.appearance.v3';

export type ThemePresetId =
  | 'olyvia'
  | 'resolve'
  | 'mint'
  | 'ember'
  | 'violet'
  | 'ocean'
  | 'graphite'
  | 'custom';
export type Density = 'compact' | 'comfortable' | 'spacious';

export interface ThemeColors {
  readonly accent: string;
  readonly info: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
}

export interface AppearanceSettings extends ThemeColors {
  readonly version: 1;
  readonly preset: ThemePresetId;
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

export const THEME_PRESETS: Readonly<Record<Exclude<ThemePresetId, 'custom'>, ThemeColors>> = {
  /** Olyvia: el emblema orbital en cian, azul y violeta sobre tinta nocturna. */
  olyvia: {
    accent: '#35d6ff',
    info: '#a78bfa',
    background: '#05070f',
    surface: '#0a0f1e',
    text: '#eef4ff',
  },
  /**
   * DaVinci Resolve: grafito neutro, sin tinte azul ni verde, y un azul
   * desaturado como único acento. Los paneles se derivan mezclando la
   * superficie con el texto, así que este preset define toda la escala.
   */
  resolve: {
    accent: '#4b8fd6',
    info: '#6fa8dc',
    background: '#141517',
    surface: '#1e1f22',
    text: '#d8d9dc',
  },
  mint: {
    accent: '#5eead4',
    info: '#5aa9ff',
    background: '#07090d',
    surface: '#0d1117',
    text: '#edf2f8',
  },
  ember: {
    accent: '#ffab70',
    info: '#7aa2f7',
    background: '#0a0807',
    surface: '#14100d',
    text: '#f7efe8',
  },
  violet: {
    accent: '#b8a1ff',
    info: '#67e8f9',
    background: '#080710',
    surface: '#12101d',
    text: '#f2effc',
  },
  ocean: {
    accent: '#38bdf8',
    info: '#a78bfa',
    background: '#050a10',
    surface: '#0a1420',
    text: '#e8f5fc',
  },
  graphite: {
    accent: '#d7dee8',
    info: '#9fb3c8',
    background: '#070809',
    surface: '#111315',
    text: '#f4f6f9',
  },
};

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
  preset: 'olyvia',
  ...THEME_PRESETS.olyvia,
  fontUi: 'Segoe UI Variable Text',
  fontDisplay: 'Segoe UI Variable Display',
  fontMono: 'Cascadia Mono',
  scale: 1,
  density: 'comfortable',
  sidebarLabels: false,
  sidebarWidth: 172,
  radius: 10,
  timelineRows: 48,
  showStatusbar: true,
  reduceMotion: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const FONT_NAMES = new Set(
  [...UI_FONTS, ...DISPLAY_FONTS, ...MONO_FONTS].map((font) => font.id),
);

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)) * 100) / 100;
}

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;
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
    value === 'resolve' ||
    value === 'mint' ||
    value === 'ember' ||
    value === 'violet' ||
    value === 'ocean' ||
    value === 'graphite' ||
    value === 'custom'
    ? value
    : DEFAULT_APPEARANCE.preset;
}

/** Coerce anything read from disk into a safe, bounded appearance. */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    version: 1,
    preset: preset(source.preset),
    accent: hex(source.accent, DEFAULT_APPEARANCE.accent),
    info: hex(source.info, DEFAULT_APPEARANCE.info),
    background: hex(source.background, DEFAULT_APPEARANCE.background),
    surface: hex(source.surface, DEFAULT_APPEARANCE.surface),
    text: hex(source.text, DEFAULT_APPEARANCE.text),
    fontUi: font(source.fontUi, DEFAULT_APPEARANCE.fontUi),
    fontDisplay: font(source.fontDisplay, DEFAULT_APPEARANCE.fontDisplay),
    fontMono: font(source.fontMono, DEFAULT_APPEARANCE.fontMono),
    scale: clamp(source.scale, 0.85, 1.2, DEFAULT_APPEARANCE.scale),
    density: density(source.density),
    sidebarLabels: bool(source.sidebarLabels, DEFAULT_APPEARANCE.sidebarLabels),
    sidebarWidth: clamp(source.sidebarWidth, 150, 320, DEFAULT_APPEARANCE.sidebarWidth),
    radius: clamp(source.radius, 2, 18, DEFAULT_APPEARANCE.radius),
    timelineRows: clamp(source.timelineRows, 34, 76, DEFAULT_APPEARANCE.timelineRows),
    showStatusbar: bool(source.showStatusbar, DEFAULT_APPEARANCE.showStatusbar),
    reduceMotion: bool(source.reduceMotion, DEFAULT_APPEARANCE.reduceMotion),
  };
}

function parse(hexColor: string): [number, number, number] {
  const value = hexColor.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0');
}

/** Linear mix: `weight` is the amount of `b` in the result (0–1). */
export function mixHex(a: string, b: string, weight: number): string {
  const first = parse(a);
  const second = parse(b);
  const amount = Math.min(1, Math.max(0, weight));
  return `#${first
    .map((channel, index) => toHex(channel + ((second[index] ?? channel) - channel) * amount))
    .join('')}`;
}

/** Readable ink for text drawn on top of the accent colour. */
export function contrastInk(color: string): string {
  const [red, green, blue] = parse(color);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.6 ? '#07110e' : '#f8fffc';
}

function stack(name: string, fallback: string): string {
  return `'${name}', ${fallback}`;
}

/** CSS custom properties and data attributes for the current appearance. */
export function appearanceCssVariables(appearance: AppearanceSettings): Record<string, string> {
  const sidebar = appearance.sidebarLabels ? appearance.sidebarWidth : 40;
  return {
    '--color-bg': appearance.background,
    '--color-surface': appearance.surface,
    '--color-panel': mixHex(appearance.surface, appearance.text, 0.035),
    '--color-panel-2': mixHex(appearance.surface, appearance.text, 0.075),
    '--color-panel-3': mixHex(appearance.surface, appearance.text, 0.115),
    '--color-border': mixHex(appearance.surface, appearance.text, 0.14),
    '--color-border-strong': mixHex(appearance.surface, appearance.text, 0.28),
    '--color-text': appearance.text,
    '--color-text-muted': mixHex(appearance.text, appearance.background, 0.42),
    '--color-empty': mixHex(appearance.text, appearance.background, 0.6),
    '--color-accent': appearance.accent,
    '--color-accent-strong': mixHex(appearance.accent, appearance.background, 0.24),
    '--color-accent-ink': contrastInk(appearance.accent),
    '--color-info': appearance.info,
    '--font-ui': stack(appearance.fontUi, "'Segoe UI', system-ui, sans-serif"),
    '--font-display': stack(appearance.fontDisplay, "'Segoe UI', system-ui, sans-serif"),
    '--font-mono': stack(appearance.fontMono, 'ui-monospace, monospace'),
    '--sidebar-width': `${sidebar}px`,
    '--sidebar-min': `${sidebar}px`,
    '--sidebar-max': `${sidebar}px`,
    '--radius-1': `${Math.max(2, appearance.radius - 3)}px`,
    '--radius-2': `${appearance.radius}px`,
    '--radius-3': `${appearance.radius + 4}px`,
    '--timeline-row': `${appearance.timelineRows}px`,
    '--app-zoom': String(appearance.scale),
    '--app-width': `${100 / appearance.scale}vw`,
    '--app-height': `${100 / appearance.scale}dvh`,
    '--glow-accent': `0 0 0 1px ${mixHex(appearance.accent, appearance.background, 0.65)}, 0 0 26px ${mixHex(
      appearance.accent,
      appearance.background,
      0.8,
    )}`,
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
  root.dataset.density = appearance.density;
  root.dataset.reduceMotion = String(appearance.reduceMotion);
  root.dataset.statusbar = appearance.showStatusbar ? 'visible' : 'hidden';
  root.dataset.sidebar = appearance.sidebarLabels ? 'labels' : 'rail';
}

export function loadAppearance(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AppearanceSettings {
  if (!storage) return DEFAULT_APPEARANCE;
  try {
    const text = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (!text) return DEFAULT_APPEARANCE;
    return normalizeAppearance(JSON.parse(text));
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
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
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

/** HSL (0-360, 0-1, 0-1) a hex `#rrggbb`. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Hex `#rrggbb` a matiz (0-360). Devuelve 0 si no se puede leer. */
export function hueOf(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;
  const value = Number.parseInt(match[1]!, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return Math.round(((hue * 60) % 360 + 360) % 360);
}

/**
 * Paleta derivada de un matiz. El acento se mantiene legible sobre fondo oscuro
 * y el color secundario queda a 150° para que no compita con el acento.
 */
export function paletteFromHue(hue: number): Pick<ThemeColors, 'accent' | 'info'> {
  return {
    accent: hslToHex(hue, 0.74, 0.63),
    info: hslToHex(hue + 150, 0.62, 0.66),
  };
}
