/**
 * Local appearance model.
 *
 * The editor is a desktop tool, so its chrome is part of the workspace: the
 * user can choose the palette, the typography, the scale and the density. All
 * of it is stored in this machine only (localStorage) and applied as CSS custom
 * properties, never baked into a project file.
 */

export const APPEARANCE_STORAGE_KEY = 'editor-ia.appearance.v1';

export type ThemePresetId = 'mint' | 'ember' | 'violet' | 'ocean' | 'graphite' | 'custom';
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
  preset: 'mint',
  ...THEME_PRESETS.mint,
  fontUi: 'Segoe UI Variable Text',
  fontDisplay: 'Segoe UI Variable Display',
  fontMono: 'Cascadia Mono',
  scale: 1,
  density: 'comfortable',
  sidebarLabels: false,
  sidebarWidth: 188,
  radius: 8,
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
  return value === 'mint' ||
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
  const sidebar = appearance.sidebarLabels ? appearance.sidebarWidth : 58;
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
