import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE,
  RECENT_COLORS_KEY,
  RECENT_COLORS_LIMIT,
  loadRecentColors,
} from './ColorSwatch';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('ColorSwatch · colores recientes y paleta', () => {
  it('la paleta tiene 64 muestras hex válidas', () => {
    expect(COLOR_PALETTE).toHaveLength(64);
    for (const color of COLOR_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('lee recientes válidos y descarta basura', () => {
    const storage = fakeStorage({
      [RECENT_COLORS_KEY]: JSON.stringify(['#FF0000', 'no-es-color', '#00ff00', 42]),
    });
    const recent = loadRecentColors(storage);
    expect(recent).toEqual(['#ff0000', '#00ff00']);
  });

  it('sin storage o con JSON roto devuelve lista vacía', () => {
    expect(loadRecentColors(null)).toEqual([]);
    expect(loadRecentColors(fakeStorage({ [RECENT_COLORS_KEY]: '{roto' }))).toEqual([]);
    expect(loadRecentColors(fakeStorage({ [RECENT_COLORS_KEY]: '"texto"' }))).toEqual([]);
  });

  it('respeta el límite de recientes al leer', () => {
    const many = Array.from({ length: RECENT_COLORS_LIMIT + 5 }, (_, i) =>
      `#${String(i).padStart(6, '0')}`,
    );
    const storage = fakeStorage({ [RECENT_COLORS_KEY]: JSON.stringify(many) });
    expect(loadRecentColors(storage)).toHaveLength(RECENT_COLORS_LIMIT);
  });
});
