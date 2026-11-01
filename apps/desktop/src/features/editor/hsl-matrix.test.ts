import { describe, expect, it } from 'vitest';
import {
  applyHslMatrix,
  applySelectiveHsl,
  hslColorMask,
  hslMatrixRows,
  hslSelectiveWeight,
} from './hsl-matrix';

describe('hsl matrix (huesaturation)', () => {
  it('es identidad sin parámetros', () => {
    const rows = hslMatrixRows({});
    expect(applyHslMatrix(rows, [255, 0, 0])).toEqual([255, 0, 0]);
    expect(applyHslMatrix(rows, [128, 128, 128])).toEqual([128, 128, 128]);
  });

  it('coincide con FFmpeg (≤1/255) para hue 30, sat 0.2, intensidad 0.1', () => {
    // Valores medidos con el binario empaquetado y colors=a/strength=100/lightness=true.
    const rows = hslMatrixRows({ hue: 30, saturation: 0.2, intensity: 0.1 });
    const check = (rgb: [number, number, number], expected: number[]): void => {
      const got = applyHslMatrix(rows, rgb);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((got[channel] ?? 0) - expected[channel]!)).toBeLessThanOrEqual(1);
      }
    };
    check([255, 0, 0], [255, 92, 0]);
    check([0, 255, 0], [0, 255, 93]);
    check([0, 0, 255], [93, 0, 255]);
    check([255, 255, 255], [255, 255, 255]);
    check([128, 128, 128], [140, 140, 140]);
  });

  it('selectivo coincide con FFmpeg: rojo entra en r (92,255,0) y no en g', () => {
    // Medido con el binario empaquetado: huesaturation=hue=90:saturation=0.2:
    // intensity=0.1:colors=r|g:strength=100:lightness=true sobre rojo.
    const rows = hslMatrixRows({ hue: 90, saturation: 0.2, intensity: 0.1 });
    const selected = applySelectiveHsl(rows, hslColorMask(['r']), [255, 0, 0]);
    expect(Math.abs(selected[0] - 92)).toBeLessThanOrEqual(2);
    expect(Math.abs(selected[1] - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(selected[2] - 0)).toBeLessThanOrEqual(2);
    const masked = applySelectiveHsl(rows, hslColorMask(['g']), [255, 0, 0]);
    expect(masked).toEqual([255, 0, 0]);
    expect(hslColorMask(['r', 'y'])).toBe(3);
    expect(hslColorMask([])).toBe(63);
    expect(hslSelectiveWeight(1, [128, 128, 128])).toBe(0);
  });
});
