import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  appearanceCssVariables,
  applyAppearance,
  contrastInk,
  loadAppearance,
  mixHex,
  normalizeAppearance,
  saveAppearance,
} from './appearance';

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
