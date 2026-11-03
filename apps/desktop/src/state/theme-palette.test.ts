import { describe, expect, it } from 'vitest';
import {
  COLOR_GROUPS,
  COLOR_TOKENS,
  THEME_FILE_KIND,
  THEME_PALETTES,
  THEME_PRESETS,
  colorSchemeFor,
  contrastInk,
  contrastRatio,
  ensureContrast,
  fixTextContrast,
  hueOf,
  mixHex,
  normalizePalette,
  paletteCssVariables,
  paletteFromBase,
  parseThemeFile,
  relativeLuminance,
  serializeThemeFile,
  themeContrastReport,
  type ThemePalette,
} from './theme-palette';

const TOKEN_IDS = COLOR_TOKENS.map((token) => token.id);

/** Valores exactos del preset Olyvia según docs/COLOR-CUSTOMIZATION.md §2.2. */
const OLYVIA_EXPECTED: ThemePalette = {
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

const HEX = /^#[0-9a-f]{6}$/;

function expectCompletePalette(palette: ThemePalette): void {
  expect(Object.keys(palette).sort()).toEqual([...TOKEN_IDS].sort());
  for (const id of TOKEN_IDS) {
    expect(palette[id], `token ${id}`).toMatch(HEX);
  }
}

describe('tokens de color', () => {
  it('define exactamente 34 tokens, sin ids ni variables repetidas', () => {
    expect(COLOR_TOKENS).toHaveLength(34);
    expect(new Set(TOKEN_IDS).size).toBe(34);
    expect(new Set(COLOR_TOKENS.map((token) => token.cssVar)).size).toBe(34);
    for (const token of COLOR_TOKENS) {
      expect(token.cssVar).toMatch(/^--color-[a-z0-9-]+$/);
      expect(token.label.length).toBeGreaterThan(0);
      expect(token.hint.length).toBeGreaterThan(10);
    }
  });

  it('agrupa superficies, acento, estados, medios y marca en ese orden', () => {
    expect(COLOR_GROUPS.map((group) => group.id)).toEqual([
      'superficies',
      'acento',
      'estados',
      'medios',
      'marca',
    ]);
    const groupIds = new Set(COLOR_GROUPS.map((group) => group.id));
    for (const token of COLOR_TOKENS) expect(groupIds.has(token.group)).toBe(true);
    const count = (group: string) => COLOR_TOKENS.filter((token) => token.group === group).length;
    expect(count('superficies')).toBe(14);
    expect(count('acento')).toBe(5);
    expect(count('estados')).toBe(5);
    expect(count('medios')).toBe(6);
    expect(count('marca')).toBe(4);
  });

  it('el grupo marca publica los alias --color-brand-*', () => {
    expect(COLOR_TOKENS.filter((token) => token.group === 'marca').map((token) => token.cssVar)).toEqual([
      '--color-brand-cyan',
      '--color-brand-blue',
      '--color-brand-violet',
      '--color-brand-magenta',
    ]);
  });
});

describe('presets completos', () => {
  it('Olyvia reproduce exactamente los valores del contrato', () => {
    expect(THEME_PALETTES.olyvia).toEqual(OLYVIA_EXPECTED);
    expectCompletePalette(THEME_PALETTES.olyvia);
  });

  it('los 7 presets están completos, con hex válido y sin custom', () => {
    expect(Object.keys(THEME_PALETTES)).toEqual([
      'olyvia',
      'resolve',
      'mint',
      'ember',
      'violet',
      'ocean',
      'graphite',
    ]);
    for (const palette of Object.values(THEME_PALETTES)) expectCompletePalette(palette);
  });

  it('el resto de los presets se deriva de sus 5 colores base', () => {
    for (const preset of ['resolve', 'mint', 'ember', 'violet', 'ocean', 'graphite'] as const) {
      expect(THEME_PALETTES[preset]).toEqual(paletteFromBase(THEME_PRESETS[preset]));
    }
  });

  it('los 5 colores base del preset Olyvia son espejo de su paleta', () => {
    expect(THEME_PALETTES.olyvia.bg).toBe(THEME_PRESETS.olyvia.background);
    expect(THEME_PALETTES.olyvia.surface).toBe(THEME_PRESETS.olyvia.surface);
    expect(THEME_PALETTES.olyvia.text).toBe(THEME_PRESETS.olyvia.text);
    expect(THEME_PALETTES.olyvia.accent).toBe(THEME_PRESETS.olyvia.accent);
    expect(THEME_PALETTES.olyvia.info).toBe(THEME_PRESETS.olyvia.info);
  });
});

describe('derivación paletteFromBase', () => {
  const base = {
    accent: '#d35cff',
    info: '#38bdf8',
    background: '#101418',
    surface: '#1a2029',
    text: '#f0f4fa',
  };
  const palette = paletteFromBase(base);

  it('copia los 5 colores base en sus tokens', () => {
    expect(palette.bg).toBe(base.background);
    expect(palette.surface).toBe(base.surface);
    expect(palette.text).toBe(base.text);
    expect(palette.accent).toBe(base.accent);
    expect(palette.info).toBe(base.info);
  });

  it('aplica la tabla de mezclas del contrato §2.3', () => {
    expect(palette.panel).toBe(mixHex(base.surface, base.text, 0.035));
    expect(palette.panel2).toBe(mixHex(base.surface, base.text, 0.075));
    expect(palette.panel3).toBe(mixHex(base.surface, base.text, 0.115));
    expect(palette.panelRaised).toBe(mixHex(palette.panel2, base.text, 0.04));
    expect(palette.surfaceRaised).toBe(mixHex(base.surface, base.text, 0.02));
    expect(palette.border).toBe(mixHex(base.surface, base.text, 0.14));
    expect(palette.borderStrong).toBe(mixHex(base.surface, base.text, 0.28));
    expect(palette.textMuted).toBe(mixHex(base.text, base.background, 0.42));
    expect(palette.textSecondary).toBe(mixHex(base.text, base.background, 0.24));
    expect(palette.textFaint).toBe(mixHex(base.text, base.background, 0.55));
    expect(palette.empty).toBe(mixHex(base.text, base.background, 0.6));
    expect(palette.accentLight).toBe(mixHex(base.accent, '#ffffff', 0.35));
    expect(palette.accentStrong).toBe(mixHex(base.accent, base.background, 0.24));
    expect(palette.accentInk).toBe(contrastInk(base.accent));
    expect(palette.brandCyan).toBe(palette.accentLight);
    expect(palette.brandBlue).toBe(base.accent);
    expect(palette.brandViolet).toBe(base.info);
    expect(palette.brandMagenta).toBe(mixHex(base.info, base.accent, 0.5));
  });

  it('usa los defaults fijos de estados y medios', () => {
    expect(palette.success).toBe('#22c55e');
    expect(palette.warning).toBe('#f59e0b');
    expect(palette.danger).toBe('#ef4444');
    expect(palette.dangerStrong).toBe('#dc2626');
    expect(palette.cta).toBe('#ff6b2b');
    expect(palette.video).toBe('#4d8df0');
    expect(palette.image).toBe('#8b74e8');
    expect(palette.audio).toBe('#2eb8a6');
    expect(palette.narration).toBe('#56b97f');
    expect(palette.caption).toBe('#d9b34a');
    expect(palette.graphic).toBe('#d76fa9');
  });
});

describe('normalizePalette', () => {
  it('devuelve el fallback completo si no hay datos', () => {
    const fallback = THEME_PALETTES.ocean;
    expect(normalizePalette(undefined, fallback)).toEqual(fallback);
    expect(normalizePalette(null, fallback)).toEqual(fallback);
    expect(normalizePalette([], fallback)).toEqual(fallback);
    expect(normalizePalette('nope', fallback)).toEqual(fallback);
  });

  it('aplica sólo tokens válidos y normaliza mayúsculas y espacios', () => {
    const palette = normalizePalette(
      { accent: ' #FF2D55 ', bg: 'rojo', surface: 42, text: '#ABC' },
      THEME_PALETTES.olyvia,
    );
    expect(palette.accent).toBe('#ff2d55');
    expect(palette.bg).toBe(THEME_PALETTES.olyvia.bg);
    expect(palette.surface).toBe(THEME_PALETTES.olyvia.surface);
    expect(palette.text).toBe(THEME_PALETTES.olyvia.text);
    expectCompletePalette(palette);
  });

  it('no muta el fallback ni propaga claves desconocidas', () => {
    const fallback = THEME_PALETTES.olyvia;
    const before = { ...fallback };
    const palette = normalizePalette(
      { accent: '#112233', tokenInventado: '#445566' },
      fallback,
    );
    expect(fallback).toEqual(before);
    expect((palette as unknown as Record<string, string>).tokenInventado).toBeUndefined();
    expect(palette.accent).toBe('#112233');
  });
});

describe('variables CSS emitidas', () => {
  const variables = paletteCssVariables(THEME_PALETTES.olyvia);

  it('emite las 34 --color-* de los tokens', () => {
    for (const token of COLOR_TOKENS) {
      expect(variables[token.cssVar], `falta ${token.cssVar}`).toBe(OLYVIA_EXPECTED[token.id]);
    }
  });

  it('emite los alias comerciales, de marca y los estados con fallback', () => {
    const required = [
      '--commercial-canvas',
      '--commercial-surface',
      '--commercial-border',
      '--commercial-border-strong',
      '--commercial-accent',
      '--commercial-success',
      '--commercial-cta',
      '--commercial-text',
      '--commercial-muted',
      '--commercial-input',
      '--olyvia-cyan',
      '--olyvia-blue',
      '--olyvia-violet',
      '--olyvia-magenta',
      '--olyvia-ink',
      '--olyvia-panel',
      '--olyvia-border',
      '--color-ok',
      '--color-ok-strong',
      '--color-warn',
      '--color-warn-strong',
      '--brand-gradient',
      '--brand-gradient-hover',
      '--brand-gradient-subtle',
      '--brand-glow',
      '--brand-border',
      '--brand-ink',
      '--glow-accent',
      '--glow-accent-strong',
      '--glow-success',
      '--glow-danger',
      '--primary-hue',
    ];
    for (const name of required) {
      expect(variables[name], `falta ${name}`).toBeTruthy();
      expect(typeof variables[name]).toBe('string');
    }
    expect(variables['--commercial-canvas']).toBe(OLYVIA_EXPECTED.bg);
    expect(variables['--commercial-accent']).toBe(OLYVIA_EXPECTED.accent);
    expect(variables['--commercial-input']).toBe(
      mixHex(OLYVIA_EXPECTED.bg, OLYVIA_EXPECTED.surface, 0.6),
    );
    expect(variables['--olyvia-cyan']).toBe(OLYVIA_EXPECTED.brandCyan);
    expect(variables['--olyvia-border']).toContain('color-mix');
    expect(variables['--olyvia-border']).toContain('--color-border-strong');
    expect(variables['--color-ok']).toBe(OLYVIA_EXPECTED.success);
    expect(variables['--color-ok-strong']).toBe(
      mixHex(OLYVIA_EXPECTED.success, OLYVIA_EXPECTED.bg, 0.22),
    );
    expect(variables['--color-warn']).toBe(OLYVIA_EXPECTED.warning);
    expect(variables['--color-warn-strong']).toBe(
      mixHex(OLYVIA_EXPECTED.warning, OLYVIA_EXPECTED.bg, 0.22),
    );
  });

  it('los alias siguen a la paleta cuando el usuario cambia el acento', () => {
    const custom = paletteFromBase({
      accent: '#ff2d55',
      info: '#38bdf8',
      background: '#0a0b0d',
      surface: '#15171b',
      text: '#f5f7fa',
    });
    const vars = paletteCssVariables(custom);
    expect(vars['--color-accent']).toBe('#ff2d55');
    expect(vars['--commercial-accent']).toBe('#ff2d55');
    expect(vars['--olyvia-blue']).toBe('#ff2d55');
    expect(vars['--olyvia-cyan']).toBe(custom.brandCyan);
    expect(vars['--brand-gradient']).toContain('#ff2d55');
    expect(vars['--primary-hue']).toBe(String(hueOf('#ff2d55')));
  });

  it('publica el degradado de marca con las 4 paradas del contrato', () => {
    expect(variables['--brand-gradient']).toBe(
      'linear-gradient(135deg, #35d6ff 0%, #4f8dff 42%, #8b5cf6 76%, #d35cff 100%)',
    );
    expect(variables['--brand-gradient-hover']).toContain(mixHex('#35d6ff', '#ffffff', 0.18));
    expect(variables['--brand-gradient-subtle']).toContain('color-mix');
    expect(variables['--brand-ink']).toBe(contrastInk(OLYVIA_EXPECTED.brandViolet));
  });

  it('no publica variables propias de marcador: el CSS las deriva de los tokens', () => {
    // Los marcadores son categorías semánticas: `.marker-*` en app.css arma
    // `--marker-color` con success/warning/danger/accent/image/text-muted, y
    // MarkersPanel usa las mismas clases. No hacen falta variables globales.
    for (const name of [
      '--marker-blue',
      '--marker-amber',
      '--marker-red',
      '--marker-green',
      '--marker-purple',
      '--marker-gray',
    ]) {
      expect(variables).not.toHaveProperty(name);
    }
  });

  it('no emite valores vacíos ni undefined', () => {
    for (const [name, value] of Object.entries(variables)) {
      expect(typeof value, name).toBe('string');
      expect(value.length, name).toBeGreaterThan(0);
    }
  });
});

describe('color-scheme', () => {
  it('Olyvia es oscura y un fondo claro cambia a light', () => {
    expect(colorSchemeFor(THEME_PALETTES.olyvia)).toBe('dark');
    expect(colorSchemeFor({ ...THEME_PALETTES.olyvia, bg: '#f5f5f5' })).toBe('light');
    expect(colorSchemeFor({ ...THEME_PALETTES.olyvia, bg: '#ffffff' })).toBe('light');
    expect(colorSchemeFor({ ...THEME_PALETTES.olyvia, bg: '#8a8a8a' })).toBe('dark');
  });
});

describe('contraste WCAG', () => {
  it('convierte canales a luminancia relativa 0–1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('no-es-color')).toBe(0);
    expect(relativeLuminance('#808080')).toBeGreaterThan(0.2);
    expect(relativeLuminance('#808080')).toBeLessThan(0.25);
  });

  it('calcula las razones de contraste conocidas', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('el reporte de Olyvia incluye los pares del contrato y todos pasan', () => {
    const report = themeContrastReport(THEME_PALETTES.olyvia);
    expect(report.map((check) => check.id)).toEqual([
      'text-bg',
      'text-surface',
      'text-panel',
      'muted-surface',
      'empty-surface',
      'accent-bg',
      'accent-ink-accent',
      'success-surface',
      'warning-surface',
      'danger-surface',
    ]);
    for (const check of report) {
      expect(check.ratio).toBeGreaterThanOrEqual(1);
      expect(check.ratio).toBeLessThanOrEqual(21);
      expect(check.pass, `${check.id} (${check.ratio})`).toBe(true);
    }
  });

  it('detecta un par ilegible', () => {
    const broken = { ...THEME_PALETTES.olyvia, text: THEME_PALETTES.olyvia.bg };
    const report = themeContrastReport(broken);
    const textBg = report.find((check) => check.id === 'text-bg')!;
    expect(textBg.pass).toBe(false);
    expect(textBg.ratio).toBe(1);
    expect(textBg.minimum).toBe(4.5);
  });
});

describe('ensureContrast y fixTextContrast', () => {
  it('deja intacto un color que ya alcanza el mínimo', () => {
    expect(ensureContrast('#000000', '#ffffff', 4.5)).toBe('#000000');
    expect(ensureContrast('#000000', '#ffffff', 21)).toBe('#000000');
  });

  it('acerca el color a blanco o negro hasta alcanzar el mínimo', () => {
    const onWhite = ensureContrast('#777777', '#ffffff', 4.5);
    expect(contrastRatio(onWhite, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const onBlack = ensureContrast('#555555', '#000000', 4.5);
    expect(contrastRatio(onBlack, '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it('sube text/textMuted/textFaint/empty a 4.5:1 sin tocar el resto', () => {
    const broken: ThemePalette = {
      ...THEME_PALETTES.olyvia,
      text: '#14161a',
      textMuted: '#171a1f',
      textFaint: '#1b1e24',
      empty: '#20232a',
    };
    const fixed = fixTextContrast(broken);
    expect(fixed.text).not.toBe(broken.text);
    expect(contrastRatio(fixed.text, fixed.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.text, fixed.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.text, fixed.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.textMuted, fixed.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.textFaint, fixed.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.empty, fixed.surface)).toBeGreaterThanOrEqual(4.5);
    expect(themeContrastReport(fixed).every((check) => check.pass)).toBe(true);
    // El resto de la paleta no cambia y el original no se muta.
    expect(fixed.bg).toBe(broken.bg);
    expect(fixed.accent).toBe(broken.accent);
    expect(fixed.panel).toBe(broken.panel);
    expect(broken.text).toBe('#14161a');
  });
});

describe('archivo de tema', () => {
  it('serializa el formato olyvia-theme con los 34 tokens', () => {
    const text = serializeThemeFile(THEME_PALETTES.mint, 'Menta de prueba');
    const raw = JSON.parse(text) as {
      kind: string;
      version: number;
      name: string;
      exportedAt: string;
      palette: Record<string, string>;
    };
    expect(raw.kind).toBe(THEME_FILE_KIND);
    expect(raw.kind).toBe('olyvia-theme');
    expect(raw.version).toBe(1);
    expect(raw.name).toBe('Menta de prueba');
    expect(Number.isNaN(Date.parse(raw.exportedAt))).toBe(false);
    expect(Object.keys(raw.palette)).toEqual(TOKEN_IDS);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('hace round-trip paleta → texto → paleta sin pérdida', () => {
    for (const palette of Object.values(THEME_PALETTES)) {
      const parsed = parseThemeFile(serializeThemeFile(palette, 'Tema'));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.palette).toEqual(palette);
      expect(parsed.name).toBe('Tema');
    }
  });

  it('acepta también el objeto ya parseado', () => {
    const raw = JSON.parse(serializeThemeFile(THEME_PALETTES.ocean, 'Océano')) as unknown;
    const parsed = parseThemeFile(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.palette).toEqual(THEME_PALETTES.ocean);
    expect(parsed.name).toBe('Océano');
  });

  it('usa un nombre por defecto y tolera nombres raros', () => {
    const parsed = parseThemeFile(serializeThemeFile(THEME_PALETTES.olyvia));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name.length).toBeGreaterThan(0);
  });

  it('rechaza archivos ajenos, vacíos o rotos con mensaje en español', () => {
    const empty = parseThemeFile('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/vacío/i);

    const broken = parseThemeFile('{ no es json');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toMatch(/JSON/i);

    const foreign = parseThemeFile({
      kind: 'otro-formato',
      version: 1,
      palette: OLYVIA_EXPECTED,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toMatch(/Olyvia/i);

    const array = parseThemeFile([OLYVIA_EXPECTED]);
    expect(array.ok).toBe(false);
  });

  it('rechaza versiones inválidas o futuras', () => {
    const base = JSON.parse(serializeThemeFile(THEME_PALETTES.olyvia)) as Record<string, unknown>;
    const future = parseThemeFile({ ...base, version: 2 });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/más nueva/i);

    const zero = parseThemeFile({ ...base, version: 0 });
    expect(zero.ok).toBe(false);
    const text = parseThemeFile({ ...base, version: 'uno' });
    expect(text.ok).toBe(false);
    const missing = parseThemeFile({ ...base, version: undefined });
    expect(missing.ok).toBe(false);
  });

  it('rechaza un token faltante sin aplicar nada', () => {
    const raw = JSON.parse(serializeThemeFile(THEME_PALETTES.olyvia)) as {
      palette: Record<string, string>;
    };
    delete raw.palette.brandMagenta;
    const parsed = parseThemeFile(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/faltan/i);
  });

  it('rechaza un token con formato inválido', () => {
    const raw = JSON.parse(serializeThemeFile(THEME_PALETTES.olyvia)) as {
      palette: Record<string, string>;
    };
    raw.palette.accent = 'azul';
    const parsed = parseThemeFile(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/formato inválido/i);
      expect(parsed.error).toMatch(/accent/);
    }
  });

  it('rechaza una paleta ausente y no aplica a medias', () => {
    const parsed = parseThemeFile({ kind: THEME_FILE_KIND, version: 1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/paleta/i);
  });

  it('ignora tokens extra desconocidos', () => {
    const raw = JSON.parse(serializeThemeFile(THEME_PALETTES.mint)) as {
      palette: Record<string, string>;
    };
    raw.palette.tokenFuturo = '#ffffff';
    const parsed = parseThemeFile(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.palette)).toHaveLength(34);
    expect((parsed.palette as unknown as Record<string, string>).tokenFuturo).toBeUndefined();
  });
});

describe('mixHex', () => {
  it('mezcla en ambos extremos y con pesos fuera de rango', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixHex('#123456', '#654321', 0.5)).toMatch(HEX);
  });
});
