import { describe, expect, it } from 'vitest';
import {
  chromaKeyAlphaAt,
  chromaKeyUniforms,
  chromaUvFromColor,
  chromaUvFromRgb255,
} from './chroma-key-preview';

describe('chroma key preview', () => {
  it('convierte la clave con el punto fijo de FFmpeg', () => {
    const green = chromaUvFromColor('#00ff00')!;
    expect(green.u).toBeCloseTo(44 / 255, 6);
    expect(green.v).toBeCloseTo(21 / 255, 6);
    const red = chromaUvFromColor('#ff0000')!;
    expect(red.u).toBeCloseTo(85 / 255, 6);
    expect(red.v).toBeCloseTo(255 / 255, 6);
    const gray = chromaUvFromRgb255(128, 128, 128);
    expect(gray.u).toBeCloseTo(128 / 255, 6);
    expect(gray.v).toBeCloseTo(128 / 255, 6);
  });

  it('rechaza colores inválidos y normaliza los rangos', () => {
    expect(chromaUvFromColor('verde')).toBeNull();
    expect(chromaUvFromColor('#00ff0')).toBeNull();
    const key = chromaKeyUniforms({
      color: '#00ff00',
      similarity: 0.001,
      blend: 2,
    })!;
    expect(key.similarity).toBe(0.01);
    expect(key.blend).toBe(1);
    expect(
      chromaKeyUniforms({ color: '#00ff00', similarity: 0.3, blend: 0.1 }),
    ).not.toBeNull();
    expect(chromaKeyUniforms(undefined)).toBeNull();
  });

  it('da alfa 0 al color clave y 1 a un color lejano', () => {
    const key = chromaKeyUniforms({
      color: '#00ff00',
      similarity: 0.3,
      blend: 0.1,
    })!;
    const green = new Uint8ClampedArray(9 * 4);
    for (let index = 0; index < 9; index += 1) {
      green[index * 4] = 0;
      green[index * 4 + 1] = 255;
      green[index * 4 + 2] = 0;
      green[index * 4 + 3] = 255;
    }
    expect(chromaKeyAlphaAt(green, 3, 3, 1, 1, key)).toBe(0);
    const red = new Uint8ClampedArray(9 * 4);
    for (let index = 0; index < 9; index += 1) {
      red[index * 4] = 255;
      red[index * 4 + 1] = 0;
      red[index * 4 + 2] = 0;
      red[index * 4 + 3] = 255;
    }
    expect(chromaKeyAlphaAt(red, 3, 3, 1, 1, key)).toBe(1);
  });

  it('usa la rampa de blend en el borde', () => {
    const key = chromaKeyUniforms({
      color: '#00ff00',
      similarity: 0.02,
      blend: 0.4,
    })!;
    const almost = new Uint8ClampedArray(9 * 4);
    for (let index = 0; index < 9; index += 1) {
      almost[index * 4] = 40;
      almost[index * 4 + 1] = 220;
      almost[index * 4 + 2] = 40;
      almost[index * 4 + 3] = 255;
    }
    const alpha = chromaKeyAlphaAt(almost, 3, 3, 1, 1, key);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});
