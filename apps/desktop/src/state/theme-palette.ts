/**
 * Motor de color de Olyvia.
 *
 * El editor dejó de tener «un acento configurable»: toda la interfaz se pinta
 * con una paleta de 34 tokens. Este módulo es la fuente de verdad de ese
 * contrato (docs/COLOR-CUSTOMIZATION.md, §2):
 *
 * - define los tokens (`COLOR_TOKENS`) y sus grupos de UI (`COLOR_GROUPS`);
 * - completa los 8 presets (`THEME_PALETTES`: 7 oscuros + el claro «Claro
 *   neutro») y deriva la escala de los presets oscuros desde sus 5 colores base
 *   (`paletteFromBase`);
 * - emite TODAS las variables CSS que consume la hoja de estilos
 *   (`paletteCssVariables`), incluidos los alias `--commercial-*`,
 *   `--olyvia-*`, los estados y la marca;
 * - mide contraste WCAG y corrige textos ilegibles (`themeContrastReport`,
 *   `ensureContrast`, `fixTextContrast`);
 * - serializa y valida archivos de tema (`serializeThemeFile`,
 *   `parseThemeFile`).
 *
 * Los colores son siempre hex `#rrggbb` en minúsculas. Nada de literales: el
 * CSS sólo usa las variables que este módulo emite.
 */

// --------------------------------------------------------------------------- //
// Tipos base del modelo de apariencia
// --------------------------------------------------------------------------- //

/** Identificador de tema. `custom` agrupa cualquier combinación editada. */
export type ThemePresetId =
  | 'olyvia'
  | 'resolve'
  | 'mint'
  | 'ember'
  | 'violet'
  | 'ocean'
  | 'graphite'
  | 'light'
  | 'custom';

/** Los cinco colores base que definían la apariencia antes de la paleta. */
export interface ThemeColors {
  readonly accent: string;
  readonly info: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
}

export type ThemeGroupId = 'superficies' | 'acento' | 'estados' | 'medios' | 'marca';

export type ThemeTokenId =
  // superficies (14)
  | 'bg'
  | 'surface'
  | 'panel'
  | 'panel2'
  | 'panel3'
  | 'panelRaised'
  | 'surfaceRaised'
  | 'border'
  | 'borderStrong'
  | 'text'
  | 'textMuted'
  | 'textSecondary'
  | 'textFaint'
  | 'empty'
  // acento (5)
  | 'accent'
  | 'accentLight'
  | 'accentStrong'
  | 'accentInk'
  | 'info'
  // estados (5)
  | 'success'
  | 'warning'
  | 'danger'
  | 'dangerStrong'
  | 'cta'
  // medios (6)
  | 'video'
  | 'image'
  | 'audio'
  | 'narration'
  | 'caption'
  | 'graphic'
  // marca (4)
  | 'brandCyan'
  | 'brandBlue'
  | 'brandViolet'
  | 'brandMagenta';

/** Definición de un token: qué es, en qué variable CSS se publica y cómo se agrupa. */
export interface ThemeTokenDefinition {
  readonly id: ThemeTokenId;
  readonly cssVar: string;
  readonly label: string;
  readonly group: ThemeGroupId;
  readonly hint: string;
}

/** Paleta completa: los 34 tokens, siempre presentes y con hex válido. */
export type ThemePalette = Readonly<Record<ThemeTokenId, string>>;

/** Grupos y orden en que la UI muestra los tokens. */
export const COLOR_GROUPS: readonly { id: ThemeGroupId; label: string; icon?: string }[] = [
  { id: 'superficies', label: 'Superficies', icon: '▤' },
  { id: 'acento', label: 'Acento', icon: '◆' },
  { id: 'estados', label: 'Estados', icon: '●' },
  { id: 'medios', label: 'Medios', icon: '▶' },
  { id: 'marca', label: 'Marca', icon: '✦' },
];

/** Los 34 tokens editables, en el orden exacto en que se muestran. */
export const COLOR_TOKENS: readonly ThemeTokenDefinition[] = [
  { id: 'bg', cssVar: '--color-bg', label: 'Fondo', group: 'superficies', hint: 'Fondo de la ventana y del área de trabajo.' },
  { id: 'surface', cssVar: '--color-surface', label: 'Superficie', group: 'superficies', hint: 'Superficie de paneles, tarjetas y menús.' },
  { id: 'panel', cssVar: '--color-panel', label: 'Panel', group: 'superficies', hint: 'Panel del timeline y del inspector.' },
  { id: 'panel2', cssVar: '--color-panel-2', label: 'Panel 2', group: 'superficies', hint: 'Segundo nivel de elevación.' },
  { id: 'panel3', cssVar: '--color-panel-3', label: 'Panel 3', group: 'superficies', hint: 'Tercer nivel de elevación.' },
  { id: 'panelRaised', cssVar: '--color-panel-raised', label: 'Panel elevado', group: 'superficies', hint: 'Panel flotante sobre el fondo.' },
  { id: 'surfaceRaised', cssVar: '--color-surface-raised', label: 'Superficie elevada', group: 'superficies', hint: 'Superficie sutil por encima del fondo.' },
  { id: 'border', cssVar: '--color-border', label: 'Borde', group: 'superficies', hint: 'Bordes normales de paneles y campos.' },
  { id: 'borderStrong', cssVar: '--color-border-strong', label: 'Borde fuerte', group: 'superficies', hint: 'Bordes de foco y separadores marcados.' },
  { id: 'text', cssVar: '--color-text', label: 'Texto', group: 'superficies', hint: 'Texto principal y títulos.' },
  { id: 'textMuted', cssVar: '--color-text-muted', label: 'Texto atenuado', group: 'superficies', hint: 'Texto secundario de uso frecuente.' },
  { id: 'textSecondary', cssVar: '--color-text-secondary', label: 'Texto secundario', group: 'superficies', hint: 'Texto de apoyo y metadatos.' },
  { id: 'textFaint', cssVar: '--color-text-faint', label: 'Texto tenue', group: 'superficies', hint: 'Texto muy tenue para datos densos.' },
  { id: 'empty', cssVar: '--color-empty', label: 'Vacío', group: 'superficies', hint: 'Texto de estados vacíos y placeholders.' },
  { id: 'accent', cssVar: '--color-accent', label: 'Acento', group: 'acento', hint: 'Color principal de la interfaz.' },
  { id: 'accentLight', cssVar: '--color-accent-light', label: 'Acento claro', group: 'acento', hint: 'Variante clara para hover y brillos.' },
  { id: 'accentStrong', cssVar: '--color-accent-strong', label: 'Acento intenso', group: 'acento', hint: 'Variante oscura para presionado y bordes.' },
  { id: 'accentInk', cssVar: '--color-accent-ink', label: 'Tinta del acento', group: 'acento', hint: 'Texto que se dibuja sobre el acento.' },
  { id: 'info', cssVar: '--color-info', label: 'Información', group: 'acento', hint: 'Mensajes y datos informativos.' },
  { id: 'success', cssVar: '--color-success', label: 'Éxito', group: 'estados', hint: 'Confirmaciones y estados correctos.' },
  { id: 'warning', cssVar: '--color-warning', label: 'Aviso', group: 'estados', hint: 'Advertencias que no bloquean.' },
  { id: 'danger', cssVar: '--color-danger', label: 'Peligro', group: 'estados', hint: 'Errores y acciones destructivas.' },
  { id: 'dangerStrong', cssVar: '--color-danger-strong', label: 'Peligro intenso', group: 'estados', hint: 'Confirmaciones destructivas.' },
  { id: 'cta', cssVar: '--color-cta', label: 'Llamada a la acción', group: 'estados', hint: 'Botones principales de venta o exportación.' },
  { id: 'video', cssVar: '--color-video', label: 'Video', group: 'medios', hint: 'Clips de video en la timeline.' },
  { id: 'image', cssVar: '--color-image', label: 'Imagen', group: 'medios', hint: 'Clips e íconos de imagen.' },
  { id: 'audio', cssVar: '--color-audio', label: 'Audio', group: 'medios', hint: 'Clips de audio y waveforms.' },
  { id: 'narration', cssVar: '--color-narration', label: 'Narración', group: 'medios', hint: 'Locución y voz en off.' },
  { id: 'caption', cssVar: '--color-caption', label: 'Subtítulos', group: 'medios', hint: 'Subtítulos y títulos.' },
  { id: 'graphic', cssVar: '--color-graphic', label: 'Gráficos', group: 'medios', hint: 'Formas, efectos y gráficos.' },
  { id: 'brandCyan', cssVar: '--color-brand-cyan', label: 'Marca cian', group: 'marca', hint: 'Primera parada del degradado de marca.' },
  { id: 'brandBlue', cssVar: '--color-brand-blue', label: 'Marca azul', group: 'marca', hint: 'Azul del emblema orbital.' },
  { id: 'brandViolet', cssVar: '--color-brand-violet', label: 'Marca violeta', group: 'marca', hint: 'Violeta del emblema orbital.' },
  { id: 'brandMagenta', cssVar: '--color-brand-magenta', label: 'Marca magenta', group: 'marca', hint: 'Última parada del degradado de marca.' },
];

// --------------------------------------------------------------------------- //
// Aritmética de color
// --------------------------------------------------------------------------- //

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Devuelve el hex normalizado (minúsculas) o `null` si no es `#rrggbb`. */
function hexOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function parseChannels(color: string): [number, number, number] {
  const value = color.replace('#', '');
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

/** Mezcla lineal: `weight` es la cantidad de `b` en el resultado (0–1). */
export function mixHex(a: string, b: string, weight: number): string {
  const first = parseChannels(a);
  const second = parseChannels(b);
  const amount = Math.min(1, Math.max(0, weight));
  return `#${first
    .map((channel, index) => toHex(channel + ((second[index] ?? channel) - channel) * amount))
    .join('')}`;
}

/** Tinta legible para texto dibujado sobre `color` (la regla histórica del editor). */
export function contrastInk(color: string): string {
  const [red, green, blue] = parseChannels(color);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.6 ? '#07110e' : '#f8fffc';
}

/** Color HSL con la misma convención que `hslToHex`: h 0-360, s y l 0-1. */
export interface HslColor {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/**
 * Hex `#rgb`/`#rrggbb` a HSL. Es la inversa de `hslToHex` y la base de la rueda
 * de color: el ángulo sale del tono y el radio de la saturación.
 */
export function hexToHsl(color: string): HslColor {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return { h: 0, s: 0, l: 0 };
  const digits = match[1]!;
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')
      : digits;
  const value = Number.parseInt(expanded, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { h: (((hue * 60) % 360) + 360) % 360, s: Math.min(1, s), l };
}

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
  return Math.round((((hue * 60) % 360) + 360) % 360);
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG (0 para negro, 1 para blanco). */
export function relativeLuminance(hex: string): number {
  const normalized = hexOrNull(hex);
  if (!normalized) return 0;
  const [red, green, blue] = parseChannels(normalized);
  return (
    0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
  );
}

/** Razón de contraste WCAG entre dos colores (1–21), redondeada a dos decimales. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  const ratio = (light + 0.05) / (dark + 0.05);
  return Math.min(21, Math.max(1, Math.round(ratio * 100) / 100));
}

// --------------------------------------------------------------------------- //
// Presets
// --------------------------------------------------------------------------- //

/** Estados y medios con valores fijos en todos los presets (contrato §2.3). */
const STATUS_DEFAULTS = {
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  dangerStrong: '#dc2626',
  cta: '#ff6b2b',
} as const;

const MEDIA_DEFAULTS = {
  video: '#4d8df0',
  image: '#8b74e8',
  audio: '#2eb8a6',
  narration: '#56b97f',
  caption: '#d9b34a',
  graphic: '#d76fa9',
} as const;

/** Los cinco colores base de cada preset (compatibilidad con la UI anterior). */
export const THEME_PRESETS: Readonly<Record<Exclude<ThemePresetId, 'custom'>, ThemeColors>> = {
  /** Olyvia: el emblema orbital en cian, azul y violeta sobre tinta nocturna. */
  olyvia: {
    accent: '#1f5eff',
    info: '#22c55e',
    background: '#0f1115',
    surface: '#181b20',
    text: '#f2f5ff',
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
  /**
   * Claro neutro: el único preset nativo de tema claro. Superficies
   * acromáticas (bg luminancia 0.87 → `color-scheme: light`) y el azul Olyvia
   * como único acento. La paleta completa es explícita (`LIGHT_PALETTE`) porque
   * estados y medios deben oscurecerse para conservar AA sobre fondo claro.
   */
  light: {
    accent: '#1f5eff',
    info: '#15803d',
    background: '#eef0f3',
    surface: '#f7f8fa',
    text: '#15181e',
  },
};

/**
 * Deriva los 34 tokens desde los 5 colores base. Es el camino de los presets
 * que no son Olyvia y de los datos v4 sin paleta persistida.
 */
export function paletteFromBase(base: ThemeColors): ThemePalette {
  const accentLight = mixHex(base.accent, '#ffffff', 0.35);
  return {
    bg: base.background,
    surface: base.surface,
    panel: mixHex(base.surface, base.text, 0.035),
    panel2: mixHex(base.surface, base.text, 0.075),
    panel3: mixHex(base.surface, base.text, 0.115),
    panelRaised: mixHex(mixHex(base.surface, base.text, 0.075), base.text, 0.04),
    surfaceRaised: mixHex(base.surface, base.text, 0.02),
    border: mixHex(base.surface, base.text, 0.14),
    borderStrong: mixHex(base.surface, base.text, 0.28),
    text: base.text,
    textMuted: mixHex(base.text, base.background, 0.42),
    textSecondary: mixHex(base.text, base.background, 0.24),
    textFaint: mixHex(base.text, base.background, 0.55),
    empty: mixHex(base.text, base.background, 0.6),
    accent: base.accent,
    accentLight,
    accentStrong: mixHex(base.accent, base.background, 0.24),
    accentInk: contrastInk(base.accent),
    info: base.info,
    ...STATUS_DEFAULTS,
    ...MEDIA_DEFAULTS,
    brandCyan: accentLight,
    brandBlue: base.accent,
    brandViolet: base.info,
    brandMagenta: mixHex(base.info, base.accent, 0.5),
  };
}

/**
 * Olyvia es explícita para reproducir exactamente el look actual: sus paneles
 * no siguen la derivación genérica (por eso `panel` es igual a `surface`).
 */
const OLYVIA_PALETTE: ThemePalette = {
  bg: '#0f1115',
  surface: '#181b20',
  panel: '#181b20',
  panel2: '#1c2027',
  panel3: '#222731',
  panelRaised: '#1b2029',
  surfaceRaised: '#161a20',
  border: '#2d3240',
  borderStrong: '#3a4152',
  text: '#f2f5ff',
  textMuted: '#9ca3af',
  textSecondary: '#7a8ba8',
  textFaint: '#6b7480',
  empty: '#6b7280',
  accent: '#1f5eff',
  accentLight: '#6ee1ff',
  accentStrong: '#1748c9',
  accentInk: '#f8fffc',
  info: '#22c55e',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  dangerStrong: '#dc2626',
  cta: '#ff6b2b',
  video: '#4d8df0',
  image: '#8b74e8',
  audio: '#2eb8a6',
  narration: '#56b97f',
  caption: '#d9b34a',
  graphic: '#d76fa9',
  brandCyan: '#35d6ff',
  brandBlue: '#4f8dff',
  brandViolet: '#8b5cf6',
  brandMagenta: '#d35cff',
};

/**
 * Claro neutro — preset nativo de tema claro, medido para WCAG AA.
 *
 * Criterios (docs/COLOR-CUSTOMIZATION.md §2.6):
 * - `text` 15.6:1 sobre bg, 16.7:1 sobre surface y 16.0:1 sobre panel.
 * - `textMuted` 7.1:1, `textSecondary` 5.5:1, `textFaint` 5.3:1 y `empty`
 *   4.65:1 sobre surface (los cuatro pasan 4.5:1; «Corregir texto» no cambia
 *   ningún token, así que el preset es estable).
 * - `accentInk` sobre `accent` 5.0:1; acento sobre bg 4.5:1.
 * - Estados y medios oscurecidos para pasar ≥4.5:1 sobre `surface` (success,
 *   warning y danger pasan ≥4.5 incluso sobre `bg`).
 * - `borderStrong` 3.4:1 sobre surface (bordes no textuales ≥3:1).
 * Es explícita a propósito: derivar la paleta con `paletteFromBase` reutilizaría
 * los estados oscuros del contrato, que fallan AA sobre fondo claro.
 */
const LIGHT_PALETTE: ThemePalette = {
  bg: '#eef0f3',
  surface: '#f7f8fa',
  panel: '#f2f3f6',
  panel2: '#e9ebef',
  panel3: '#e1e4ea',
  panelRaised: '#ffffff',
  surfaceRaised: '#fbfbfd',
  border: '#d5d9e0',
  borderStrong: '#7f8896',
  text: '#15181e',
  textMuted: '#4b5563',
  textSecondary: '#5d6673',
  textFaint: '#5f6874',
  empty: '#68717d',
  accent: '#1f5eff',
  accentLight: '#4a83ff',
  accentStrong: '#1748c9',
  accentInk: '#f8fffc',
  info: '#15803d',
  success: '#15803d',
  warning: '#b45309',
  danger: '#dc2626',
  dangerStrong: '#b91c1c',
  cta: '#c2410c',
  video: '#2563eb',
  image: '#7c3aed',
  audio: '#0d9488',
  narration: '#15803d',
  caption: '#b45309',
  graphic: '#be185d',
  brandCyan: '#0891b2',
  brandBlue: '#1f5eff',
  brandViolet: '#7c3aed',
  brandMagenta: '#c026d3',
};

/** Paletas completas de los 8 presets (Olyvia y Claro neutro explícitos). */
export const THEME_PALETTES: Readonly<
  Record<Exclude<ThemePresetId, 'custom'>, ThemePalette>
> = {
  olyvia: OLYVIA_PALETTE,
  resolve: paletteFromBase(THEME_PRESETS.resolve),
  mint: paletteFromBase(THEME_PRESETS.mint),
  ember: paletteFromBase(THEME_PRESETS.ember),
  violet: paletteFromBase(THEME_PRESETS.violet),
  ocean: paletteFromBase(THEME_PRESETS.ocean),
  graphite: paletteFromBase(THEME_PRESETS.graphite),
  light: LIGHT_PALETTE,
};

/** Etiquetas de UI de los presets (Ajustes y estudio de color usan esta fuente). */
export const THEME_PRESET_LABELS: Readonly<
  Record<Exclude<ThemePresetId, 'custom'>, string>
> = {
  olyvia: 'Olyvia',
  resolve: 'Resolve',
  mint: 'Menta',
  ember: 'Ámbar',
  violet: 'Violeta',
  ocean: 'Océano',
  graphite: 'Grafito',
  light: 'Claro neutro',
};

/** Los cinco espejos base de una paleta (compatibilidad con el modelo v4). */
export function paletteBaseColors(palette: ThemePalette): ThemeColors {
  return {
    accent: palette.accent,
    info: palette.info,
    background: palette.bg,
    surface: palette.surface,
    text: palette.text,
  };
}

/**
 * Normaliza una paleta leída de disco: cada token válido se aplica y cada
 * token ausente o basura conserva el valor del fallback. Nunca propaga valores
 * raros y siempre devuelve una paleta completa nueva.
 */
export function normalizePalette(raw: unknown, fallback: ThemePalette): ThemePalette {
  const palette = { ...fallback };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return palette;
  const source = raw as Record<string, unknown>;
  for (const token of COLOR_TOKENS) {
    const value = hexOrNull(source[token.id]);
    if (value) palette[token.id] = value;
  }
  return palette;
}

// --------------------------------------------------------------------------- //
// Variables CSS (contrato §2.4)
// --------------------------------------------------------------------------- //

/** Paradas del degradado de marca, en el orden cian → azul → violeta → magenta. */
const BRAND_STOPS = [0, 42, 76, 100] as const;

function brandGradient(stops: readonly string[]): string {
  return `linear-gradient(135deg, ${stops
    .map((color, index) => `${color} ${BRAND_STOPS[index] ?? 0}%`)
    .join(', ')})`;
}

function brandPaletteColors(palette: ThemePalette): readonly string[] {
  return [palette.brandCyan, palette.brandBlue, palette.brandViolet, palette.brandMagenta];
}

/**
 * Todas las variables CSS que la paleta escribe inline en `documentElement`:
 * los 34 tokens, los alias `--commercial-*` y `--olyvia-*`, los estados con
 * fallback (`--color-ok`/`--color-warn`), la marca (degradados, glow, borde) y
 * los marcadores del timeline. No incluye tipografía, radios ni layout: eso
 * sigue en `appearanceCssVariables`.
 */
export function paletteCssVariables(palette: ThemePalette): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const token of COLOR_TOKENS) {
    variables[token.cssVar] = palette[token.id];
  }

  // Alias comerciales: la capa `commercial.css` pinta con estos nombres.
  variables['--commercial-canvas'] = palette.bg;
  variables['--commercial-surface'] = palette.surface;
  variables['--commercial-border'] = palette.border;
  variables['--commercial-border-strong'] = palette.borderStrong;
  variables['--commercial-accent'] = palette.accent;
  variables['--commercial-success'] = palette.success;
  variables['--commercial-cta'] = palette.cta;
  variables['--commercial-text'] = palette.text;
  variables['--commercial-muted'] = palette.textMuted;
  variables['--commercial-input'] = mixHex(palette.bg, palette.surface, 0.6);

  // Alias de la identidad orbital.
  variables['--olyvia-cyan'] = palette.brandCyan;
  variables['--olyvia-blue'] = palette.brandBlue;
  variables['--olyvia-violet'] = palette.brandViolet;
  variables['--olyvia-magenta'] = palette.brandMagenta;
  variables['--olyvia-ink'] = palette.bg;
  variables['--olyvia-panel'] = palette.surface;
  variables['--olyvia-border'] =
    'color-mix(in srgb, var(--color-border-strong) 70%, transparent)';

  // Estados que la CSS ya usaba con fallback pero nadie definía.
  variables['--color-ok'] = palette.success;
  variables['--color-ok-strong'] = mixHex(palette.success, palette.bg, 0.22);
  variables['--color-warn'] = palette.warning;
  variables['--color-warn-strong'] = mixHex(palette.warning, palette.bg, 0.22);

  // Marca: degradados, borde, tinta y glow.
  const brandColors = brandPaletteColors(palette);
  variables['--brand-gradient'] = brandGradient(brandColors);
  variables['--brand-gradient-hover'] = brandGradient(
    brandColors.map((color) => mixHex(color, '#ffffff', 0.18)),
  );
  variables['--brand-gradient-subtle'] = `linear-gradient(135deg, ${brandColors
    .map(
      (color, index) =>
        `color-mix(in srgb, ${color} 15%, transparent) ${BRAND_STOPS[index] ?? 0}%`,
    )
    .join(', ')})`;
  variables['--brand-glow'] =
    `0 0 24px color-mix(in srgb, ${palette.brandCyan} 20%, transparent), ` +
    `0 0 64px color-mix(in srgb, ${palette.brandViolet} 15%, transparent)`;
  variables['--brand-border'] = `color-mix(in srgb, ${palette.brandBlue} 25%, transparent)`;
  variables['--brand-ink'] = contrastInk(palette.brandViolet);

  // Glows de acento y estados.
  const accentDeep = mixHex(palette.accent, palette.bg, 0.25);
  variables['--glow-accent'] =
    `0 0 0 1px color-mix(in srgb, ${palette.accent} 30%, transparent), ` +
    `0 0 22px color-mix(in srgb, ${palette.accent} 18%, transparent)`;
  variables['--glow-accent-strong'] =
    `0 0 0 2px color-mix(in srgb, ${accentDeep} 55%, transparent), ` +
    `0 0 28px color-mix(in srgb, ${palette.accent} 32%, transparent)`;
  variables['--glow-success'] =
    `0 0 0 1px color-mix(in srgb, ${palette.success} 30%, transparent), ` +
    `0 0 20px color-mix(in srgb, ${palette.success} 15%, transparent)`;
  variables['--glow-danger'] =
    `0 0 0 1px color-mix(in srgb, ${palette.danger} 30%, transparent), ` +
    `0 0 20px color-mix(in srgb, ${palette.danger} 15%, transparent)`;

  // Matiz del acento para lo que ya lo usaba (`hsl(var(--primary-hue) …)`).
  variables['--primary-hue'] = String(hueOf(palette.accent));

  return variables;
}

/** `color-scheme` del documento según la luminancia del fondo (contrato §2.4). */
export function colorSchemeFor(palette: ThemePalette): 'light' | 'dark' {
  return relativeLuminance(palette.bg) > 0.55 ? 'light' : 'dark';
}

// --------------------------------------------------------------------------- //
// Contraste y accesibilidad (contrato §2.6)
// --------------------------------------------------------------------------- //

export interface ContrastCheck {
  readonly id: string;
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly minimum: number;
  readonly pass: boolean;
}

/**
 * Pares mínimos que la UI muestra como reporte de contraste. Los mínimos son
 * los del contrato: 4.5 para texto legible, 3 para texto grande/estados.
 */
export function themeContrastReport(palette: ThemePalette): ContrastCheck[] {
  const check = (
    id: string,
    label: string,
    foreground: string,
    background: string,
    minimum: number,
  ): ContrastCheck => {
    const ratio = contrastRatio(foreground, background);
    return { id, label, foreground, background, ratio, minimum, pass: ratio >= minimum };
  };
  return [
    check('text-bg', 'Texto sobre fondo', palette.text, palette.bg, 4.5),
    check('text-surface', 'Texto sobre superficie', palette.text, palette.surface, 4.5),
    check('text-panel', 'Texto sobre panel', palette.text, palette.panel, 4.5),
    check(
      'muted-surface',
      'Texto atenuado sobre superficie',
      palette.textMuted,
      palette.surface,
      4.5,
    ),
    check('empty-surface', 'Texto vacío sobre superficie', palette.empty, palette.surface, 3),
    check('accent-bg', 'Acento sobre fondo', palette.accent, palette.bg, 3),
    check('accent-ink-accent', 'Tinta del acento sobre acento', palette.accentInk, palette.accent, 4.5),
    check('success-surface', 'Éxito sobre superficie', palette.success, palette.surface, 3),
    check('warning-surface', 'Aviso sobre superficie', palette.warning, palette.surface, 3),
    check('danger-surface', 'Peligro sobre superficie', palette.danger, palette.surface, 3),
  ];
}

/**
 * Devuelve `foreground` tal cual si ya alcanza el mínimo; si no, lo acerca
 * paso a paso a blanco o negro hasta lograrlo (mejor esfuerzo si es imposible).
 */
export function ensureContrast(foreground: string, background: string, minimum: number): string {
  const start = hexOrNull(foreground) ?? '#000000';
  const backdrop = hexOrNull(background) ?? '#000000';
  if (contrastRatio(start, backdrop) >= minimum) return start;
  const target = relativeLuminance(backdrop) > 0.1791 ? '#000000' : '#ffffff';
  for (let amount = 0.01; amount <= 1.0001; amount += 0.01) {
    const candidate = mixHex(start, target, amount > 1 ? 1 : amount);
    if (contrastRatio(candidate, backdrop) >= minimum) return candidate;
  }
  return target;
}

/**
 * Sube los textos de la paleta hasta 4.5:1. `text` se valida contra fondo,
 * superficie y panel; el resto contra la superficie, que es donde se leen.
 */
export function fixTextContrast(palette: ThemePalette): ThemePalette {
  const text = ensureContrast(
    ensureContrast(ensureContrast(palette.text, palette.bg, 4.5), palette.surface, 4.5),
    palette.panel,
    4.5,
  );
  return {
    ...palette,
    text,
    textMuted: ensureContrast(palette.textMuted, palette.surface, 4.5),
    textFaint: ensureContrast(palette.textFaint, palette.surface, 4.5),
    empty: ensureContrast(palette.empty, palette.surface, 4.5),
  };
}

// --------------------------------------------------------------------------- //
// Archivo de tema (contrato §2.7)
// --------------------------------------------------------------------------- //

export const THEME_FILE_KIND = 'olyvia-theme';
export const THEME_FILE_VERSION = 1;

export type ThemeFileParseResult =
  | { readonly ok: true; readonly name: string; readonly palette: ThemePalette }
  | { readonly ok: false; readonly error: string };

/** JSON estable de un tema: 34 tokens en el orden de `COLOR_TOKENS`. */
export function serializeThemeFile(palette: ThemePalette, name = 'Tema de Olyvia'): string {
  const tokens: Record<string, string> = {};
  for (const token of COLOR_TOKENS) {
    tokens[token.id] = palette[token.id];
  }
  const safeName =
    typeof name === 'string' && name.trim() ? name.trim() : 'Tema de Olyvia';
  return `${JSON.stringify(
    {
      kind: THEME_FILE_KIND,
      version: THEME_FILE_VERSION,
      name: safeName,
      exportedAt: new Date().toISOString(),
      palette: tokens,
    },
    null,
    2,
  )}\n`;
}

/**
 * Valida un archivo de tema completo. Es estricto a propósito: un archivo de
 * otra app, de una versión futura, corrupto o al que le falte / sobre un token
 * inválido se rechaza entero con un mensaje en español y no se aplica nada.
 */
export function parseThemeFile(raw: string | unknown): ThemeFileParseResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return { ok: false, error: 'El archivo de tema está vacío.' };
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: 'El archivo de tema no es JSON válido.' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'El archivo no contiene un tema de Olyvia.' };
  }
  const source = value as Record<string, unknown>;
  if (source.kind !== THEME_FILE_KIND) {
    return {
      ok: false,
      error: 'El archivo no es un tema de Olyvia (falta la marca "olyvia-theme").',
    };
  }
  if (typeof source.version !== 'number' || !Number.isInteger(source.version)) {
    return { ok: false, error: 'El archivo de tema no declara una versión válida.' };
  }
  if (source.version > THEME_FILE_VERSION) {
    return {
      ok: false,
      error: `El tema es de una versión más nueva (v${source.version}); esta app entiende hasta v${THEME_FILE_VERSION}.`,
    };
  }
  if (source.version !== THEME_FILE_VERSION) {
    return {
      ok: false,
      error: `La versión ${source.version} del archivo de tema no es válida (se espera v${THEME_FILE_VERSION}).`,
    };
  }
  if (!source.palette || typeof source.palette !== 'object' || Array.isArray(source.palette)) {
    return { ok: false, error: 'El tema no incluye la paleta de 34 colores.' };
  }
  const rawPalette = source.palette as Record<string, unknown>;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const token of COLOR_TOKENS) {
    const value = rawPalette[token.id];
    if (value === undefined) missing.push(token.id);
    else if (!hexOrNull(value)) invalid.push(token.id);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Al tema le faltan ${missing.length} color${missing.length === 1 ? '' : 'es'} (${missing.join(
        ', ',
      )}). No se aplicó nada.`,
    };
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `El tema tiene ${invalid.length} color${invalid.length === 1 ? '' : 'es'} con formato inválido; se espera #rrggbb (${invalid.join(
        ', ',
      )}). No se aplicó nada.`,
    };
  }
  const palette = normalizePalette(rawPalette, THEME_PALETTES.olyvia);
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : 'Tema importado';
  return { ok: true, name, palette };
}
