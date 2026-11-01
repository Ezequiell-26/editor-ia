import { describe, expect, it } from 'vitest';
import {
  appendSharpenFilter,
  clampSharpen,
  sharpenFilterId,
  sharpenKernel,
} from './sharpen-preview';

describe('preview de nitidez', () => {
  it('acota la intensidad al rango 0..1', () => {
    expect(clampSharpen(undefined)).toBe(0);
    expect(clampSharpen(Number.NaN)).toBe(0);
    expect(clampSharpen(-2)).toBe(0);
    expect(clampSharpen(3)).toBe(1);
    expect(clampSharpen(0.5)).toBe(0.5);
  });

  it('construye un núcleo 3x3 que conserva el brillo medio', () => {
    const kernel = sharpenKernel(0.5).split(' ').map(Number);
    expect(kernel).toHaveLength(9);
    expect(kernel.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 6);
    expect(kernel[4]).toBeGreaterThan(1);
    expect(kernel[1]).toBeLessThan(0);
  });

  it('una intensidad cero deja el núcleo identidad', () => {
    expect(sharpenKernel(0)).toBe('0 0 0 0 1 0 0 0 0');
  });

  it('genera un id estable por clip', () => {
    expect(sharpenFilterId('clip-1')).toBe('olyvia-sharpen-clip-1');
  });

  it('agrega la referencia SVG sin perder los filtros CSS previos', () => {
    expect(appendSharpenFilter('brightness(1.2)', 'c1', 0.5)).toBe(
      'brightness(1.2) url(#olyvia-sharpen-c1)',
    );
    expect(appendSharpenFilter('', 'c1', 0.5)).toBe('url(#olyvia-sharpen-c1)');
    expect(appendSharpenFilter('brightness(1.2)', 'c1', 0)).toBe('brightness(1.2)');
  });
});
