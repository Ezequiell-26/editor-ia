import { describe, expect, it } from 'vitest';
import { extractPalette } from './palette';

function pixels(colors: readonly [number, number, number][], repeats = 20): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * repeats * 4);
  let index = 0;
  for (const [r, g, b] of colors) {
    for (let count = 0; count < repeats; count += 1) {
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
      index += 4;
    }
  }
  return data;
}

describe('extractPalette', () => {
  it('extrae los colores dominantes y elige un acento saturado', () => {
    const palette = extractPalette(
      pixels([
        [245, 242, 239],
        [28, 20, 16],
        [216, 0, 15],
        [216, 0, 15],
        [91, 140, 255],
      ]),
    );
    expect(palette.colors.length).toBeGreaterThanOrEqual(3);
    expect(palette.colors).toContain('#f5f2ef');
    expect(palette.colors).toContain('#1c1410');
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.accentOn).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.fg).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('descarta píxeles transparentes y devuelve un fallback si no hay imagen', () => {
    const empty = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0]);
    const palette = extractPalette(empty);
    expect(palette.colors).toEqual(['#5b8cff']);
    expect(palette.accent).toBe('#5b8cff');
  });

  it('limita la cantidad de colores pedidos', () => {
    const palette = extractPalette(
      pixels([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
        [255, 0, 255],
        [0, 255, 255],
        [10, 10, 10],
        [250, 250, 250],
      ]),
      3,
    );
    expect(palette.colors).toHaveLength(3);
  });
});
