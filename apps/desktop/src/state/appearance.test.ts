import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  appearanceCssVariables,
  applyAppearance,
  contrastInk,
  hueOf,
  loadAppearance,
  mixHex,
  normalizeAppearance,
  saveAppearance,
} from './appearance';
import { THEME_PALETTES } from './theme-palette';

describe('apariencia local', () => {
  it('normaliza valores corruptos y acota los números', () => {
    const appearance = normalizeAppearance({
      preset: 'neón',
      accent: 'red',
      fontUi: 'Comic Sans MS',
      scale: 4,
      sidebarWidth: 20,
      radius: -8,
      timelineRows: 900,
      density: 'enorme',
    });
    expect(appearance.preset).toBe(DEFAULT_APPEARANCE.preset);
    expect(appearance.accent).toBe(DEFAULT_APPEARANCE.accent);
    expect(appearance.fontUi).toBe(DEFAULT_APPEARANCE.fontUi);
    expect(appearance.scale).toBe(1.2);
    expect(appearance.sidebarWidth).toBe(150);
    expect(appearance.radius).toBe(2);
    expect(appearance.timelineRows).toBe(76);
    expect(appearance.density).toBe('comfortable');
  });

  it('ajusta la escala a pasos de 10 % para no emborronar el texto', () => {
    // 95 % obliga a rasterizar las letras a tamaños fraccionarios: se ajusta
    // al paso más cercano (100 %), que es el más nítido.
    expect(normalizeAppearance({ scale: 0.95 }).scale).toBe(1);
    expect(normalizeAppearance({ scale: 0.88 }).scale).toBe(0.9);
    expect(normalizeAppearance({ scale: 1.06 }).scale).toBe(1.1);
    expect(normalizeAppearance({ scale: 0.5 }).scale).toBe(0.9);
    expect(normalizeAppearance({ scale: 9 }).scale).toBe(1.2);
  });

  it('mezcla colores y elige tinta legible', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#5eead4', '#000000', 0)).toBe('#5eead4');
    expect(contrastInk('#f5f5f5')).toBe('#07110e');
    expect(contrastInk('#111111')).toBe('#f8fffc');
  });

  it('produce variables de CSS para el rail y la escala', () => {
    const rail = appearanceCssVariables(DEFAULT_APPEARANCE);
    expect(rail['--sidebar-width']).toBe('40px');
    expect(rail['--app-zoom']).toBe('1');
    expect(rail['--app-width']).toBe('100vw');

    const labels = appearanceCssVariables({
      ...DEFAULT_APPEARANCE,
      sidebarLabels: true,
      sidebarWidth: 240,
      scale: 1.1,
    });
    expect(labels['--sidebar-width']).toBe('240px');
    expect(labels['--app-width']).toBe(`${100 / 1.1}vw`);
  });

  it('guarda y recupera sólo desde el almacenamiento local', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    saveAppearance({ ...DEFAULT_APPEARANCE, accent: '#ffab70', preset: 'custom' }, storage);
    expect(store.has(APPEARANCE_STORAGE_KEY)).toBe(true);
    expect(loadAppearance(storage).accent).toBe('#ffab70');
    expect(loadAppearance(storage).preset).toBe('custom');
    expect(loadAppearance({ getItem: () => '{roto' })).toEqual(DEFAULT_APPEARANCE);
  });

  it('aplica datos y variables al documento sin lanzar', () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
        colorScheme: '',
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    applyAppearance(
      {
        ...DEFAULT_APPEARANCE,
        density: 'compact',
        reduceMotion: true,
        showStatusbar: false,
        sidebarLabels: true,
      },
      root,
    );
    expect(properties.get('--color-accent')).toBe(DEFAULT_APPEARANCE.accent);
    expect(root.dataset.density).toBe('compact');
    expect(root.dataset.reduceMotion).toBe('true');
    expect(root.dataset.statusbar).toBe('hidden');
    expect(root.dataset.sidebar).toBe('labels');
  });
});

describe('apariencia · paleta de 34 tokens', () => {
  it('la apariencia por defecto usa Olyvia y espeja los cinco colores base', () => {
    expect(DEFAULT_APPEARANCE.preset).toBe('olyvia');
    expect(DEFAULT_APPEARANCE.palette).toEqual(THEME_PALETTES.olyvia);
    expect(DEFAULT_APPEARANCE.accent).toBe(DEFAULT_APPEARANCE.palette.accent);
    expect(DEFAULT_APPEARANCE.info).toBe(DEFAULT_APPEARANCE.palette.info);
    expect(DEFAULT_APPEARANCE.background).toBe(DEFAULT_APPEARANCE.palette.bg);
    expect(DEFAULT_APPEARANCE.surface).toBe(DEFAULT_APPEARANCE.palette.surface);
    expect(DEFAULT_APPEARANCE.text).toBe(DEFAULT_APPEARANCE.palette.text);
    expect(Object.keys(DEFAULT_APPEARANCE.palette)).toHaveLength(34);
  });

  it('emite toda la paleta y conserva las variables no-color de siempre', () => {
    const vars = appearanceCssVariables(DEFAULT_APPEARANCE);
    expect(vars['--color-bg']).toBe('#0f1115');
    expect(vars['--color-panel-raised']).toBe('#1b2029');
    expect(vars['--color-text-faint']).toBe('#6b7480');
    expect(vars['--commercial-canvas']).toBe('#0f1115');
    expect(vars['--commercial-accent']).toBe('#1f5eff');
    expect(vars['--olyvia-cyan']).toBe('#35d6ff');
    expect(vars['--color-ok']).toBe('#22c55e');
    expect(vars['--brand-gradient']).toContain('#35d6ff');
    expect(vars['--glow-accent']).toContain('color-mix');
    expect(vars['--primary-hue']).toBe(String(hueOf(DEFAULT_APPEARANCE.palette.accent)));

    // Variables no-color: no las toca la paleta.
    expect(vars['--font-ui']).toContain('Segoe UI Variable Text');
    expect(vars['--font-display']).toContain('Segoe UI Variable Display');
    expect(vars['--font-mono']).toContain('Cascadia Mono');
    expect(vars['--sidebar-width']).toBe('40px');
    expect(vars['--sidebar-min']).toBe('40px');
    expect(vars['--sidebar-max']).toBe('40px');
    expect(vars['--timeline-row']).toBe('48px');
    expect(vars['--app-zoom']).toBe('1');
    expect(vars['--app-width']).toBe('100vw');
    expect(vars['--app-height']).toBe('100dvh');
    expect(vars['--radius-2']).toBe('10px');
  });

  it('migra datos v4 con sólo los 5 colores a una paleta derivada completa', () => {
    const appearance = normalizeAppearance({
      version: 1,
      preset: 'custom',
      accent: '#ff6b2b',
      info: '#22c55e',
      background: '#101418',
      surface: '#1a2029',
      text: '#f0f4fa',
    });
    expect(Object.keys(appearance.palette)).toHaveLength(34);
    expect(appearance.palette.bg).toBe('#101418');
    expect(appearance.palette.surface).toBe('#1a2029');
    expect(appearance.palette.text).toBe('#f0f4fa');
    expect(appearance.palette.accent).toBe('#ff6b2b');
    expect(appearance.palette.info).toBe('#22c55e');
    expect(appearance.palette.panel).toBe(mixHex('#1a2029', '#f0f4fa', 0.035));
    expect(appearance.palette.textMuted).toBe(mixHex('#f0f4fa', '#101418', 0.42));
    expect(appearance.palette.accentLight).toBe(mixHex('#ff6b2b', '#ffffff', 0.35));
    expect(appearance.palette.accentInk).toBe(contrastInk('#ff6b2b'));
    expect(appearance.accent).toBe('#ff6b2b');
    expect(appearance.background).toBe('#101418');
  });

  it('resuelve el preset completo aunque los datos v4 no traigan colores base', () => {
    const appearance = normalizeAppearance({ version: 1, preset: 'ocean' });
    expect(appearance.preset).toBe('ocean');
    expect(appearance.palette).toEqual(THEME_PALETTES.ocean);
    expect(appearance.accent).toBe(THEME_PALETTES.ocean.accent);
    expect(appearance.background).toBe(THEME_PALETTES.ocean.bg);
  });

  it('compatibilidad v4: un campo base explícito manda sobre la paleta guardada', () => {
    const appearance = normalizeAppearance({ ...DEFAULT_APPEARANCE, accent: '#00ff88' });
    expect(appearance.accent).toBe('#00ff88');
    expect(appearance.palette.accent).toBe('#00ff88');
    // El resto de la paleta guardada no se descarta.
    expect(appearance.palette.bg).toBe(THEME_PALETTES.olyvia.bg);
    expect(appearance.palette.brandViolet).toBe(THEME_PALETTES.olyvia.brandViolet);
  });

  it('no propaga basura de una paleta corrupta', () => {
    const appearance = normalizeAppearance({
      preset: 'custom',
      accent: '#ff6b2b',
      background: '#101418',
      surface: '#1a2029',
      text: '#f0f4fa',
      palette: { accent: 'rojo', bg: 7, surface: 'no-es-color' },
    });
    expect(appearance.palette.accent).toBe('#ff6b2b');
    expect(appearance.palette.bg).toBe('#101418');
    // El campo base válido sigue mandando y actualiza su token.
    expect(appearance.palette.surface).toBe('#1a2029');
    expect(appearance.palette.panel).toBe(mixHex('#1a2029', '#f0f4fa', 0.035));
  });

  it('guarda y recupera una paleta completa', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const mint = normalizeAppearance({ preset: 'mint' });
    saveAppearance(mint, storage);
    const loaded = loadAppearance(storage);
    expect(loaded.preset).toBe('mint');
    expect(loaded.palette).toEqual(THEME_PALETTES.mint);
    expect(loaded.accent).toBe(THEME_PALETTES.mint.accent);
    expect(loaded.background).toBe(THEME_PALETTES.mint.bg);
    expect(loaded.text).toBe(THEME_PALETTES.mint.text);
  });

  it('los colores emitidos salen de la paleta, sin rama comercial hardcodeada', () => {
    const appearance = normalizeAppearance({
      preset: 'custom',
      palette: { ...THEME_PALETTES.olyvia, accent: '#ff2d55', cta: '#00d1b2' },
    });
    const vars = appearanceCssVariables(appearance);
    expect(vars['--color-accent']).toBe('#ff2d55');
    expect(vars['--commercial-accent']).toBe('#ff2d55');
    expect(vars['--color-cta']).toBe('#00d1b2');
    expect(vars['--commercial-cta']).toBe('#00d1b2');
    // El glow usa el acento de la paleta, no literales del look viejo.
    expect(vars['--glow-accent']).toContain('#ff2d55');
    expect(vars['--glow-accent']).not.toContain('#3dd6ff');
  });

  it('aplica color-scheme oscuro o claro según la luminancia del fondo', () => {
    const darkProperties = new Map<string, string>();
    const darkRoot = {
      style: {
        setProperty: (name: string, value: string) => {
          darkProperties.set(name, value);
        },
        colorScheme: '',
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    applyAppearance(DEFAULT_APPEARANCE, darkRoot);
    expect((darkRoot.style as CSSStyleDeclaration).colorScheme).toBe('dark');
    expect(darkProperties.get('--color-bg')).toBe('#0f1115');

    const light = normalizeAppearance({
      preset: 'custom',
      background: '#f2f2f2',
      surface: '#ffffff',
      text: '#111111',
      accent: '#1f5eff',
      info: '#22c55e',
    });
    const lightProperties = new Map<string, string>();
    const lightRoot = {
      style: {
        setProperty: (name: string, value: string) => {
          lightProperties.set(name, value);
        },
        colorScheme: '',
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    applyAppearance(light, lightRoot);
    expect((lightRoot.style as CSSStyleDeclaration).colorScheme).toBe('light');
    expect(lightProperties.get('--color-bg')).toBe('#f2f2f2');
  });
});
