import { describe, expect, it } from 'vitest';
import { effectsToCss } from './effects-to-css';

describe('effectsToCss', () => {
  it('traduce el giro de tono a un filtro CSS real', () => {
    const style = effectsToCss({ hueRotateDeg: 45 });
    expect(style.filter).toContain('hue-rotate(45deg)');
  });

  it('combina color, desenfoque y giro de tono', () => {
    const style = effectsToCss({ brightness: 0.2, blur: 3, hueRotateDeg: -30 });
    expect(style.filter).toContain('brightness(1.2)');
    expect(style.filter).toContain('blur(3px)');
    expect(style.filter).toContain('hue-rotate(-30deg)');
  });

  it('no inventa preview para efectos sin equivalente CSS', () => {
    expect(effectsToCss({ denoise: 0.5 }).filter).toBeUndefined();
    expect(effectsToCss({ glow: { intensity: 0.5, radius: 10, threshold: 0.5 } }).filter).toBeUndefined();
  });

  it('omite la aproximación de ruedas cuando el shader aplica la exacta', () => {
    const wheels = {
      lift: { r: 0.4, g: 0, b: -0.2 },
      gamma: { r: 0.3, g: 0, b: 0 },
      gain: { r: 0.2, g: 0, b: 0 },
    };
    const approximate = effectsToCss(wheels);
    expect(approximate.filter).toBeTruthy();
    expect(effectsToCss(wheels, { colorWheels: false }).filter).toBeUndefined();
    const mixed = effectsToCss(
      { ...wheels, brightness: 0.2 },
      { colorWheels: false },
    );
    expect(mixed.filter).toBe('brightness(1.2)');
    expect(
      effectsToCss(
        { ...wheels, brightness: 0.2 },
        { colorWheels: false, brightness: false },
      ).filter,
    ).toBeUndefined();
    expect(effectsToCss({ brightness: 0.2 }, { brightness: false }).filter).toBeUndefined();
  });

  it('omite la temperatura cuando el shader aplica colorbalance', () => {
    expect(effectsToCss({ temperature: 0.6 }).filter).toContain('sepia(');
    expect(effectsToCss({ temperature: 0.6 }, { temperature: false }).filter).toBeUndefined();
  });

  it('omite saturación, contraste y giro de tono cuando el shader los aplica', () => {
    expect(effectsToCss({ saturation: 0.5 }).filter).toContain('saturate(0.5)');
    expect(effectsToCss({ saturation: 0.5 }, { saturation: false }).filter).toBeUndefined();
    expect(effectsToCss({ contrast: 0.5 }).filter).toContain('contrast(0.5)');
    expect(effectsToCss({ contrast: 0.5 }, { contrast: false }).filter).toBeUndefined();
    expect(effectsToCss({ hueRotateDeg: 120 }).filter).toContain('hue-rotate(120deg)');
    expect(effectsToCss({ hueRotateDeg: 120 }, { hue: false }).filter).toBeUndefined();
    const colorMatch = { r: 1.2, g: 1, b: 1, strength: 1 };
    expect(effectsToCss({ colorMatch }).filter).toBeTruthy();
    expect(effectsToCss({ colorMatch }, { colorMatch: false }).filter).toBeUndefined();
    expect(effectsToCss({ grayscale: true }).filter).toContain('grayscale(1)');
    expect(effectsToCss({ grayscale: true }, { grayscale: false }).filter).toBeUndefined();
    expect(effectsToCss({ sepia: true }).filter).toContain('sepia(1)');
    expect(effectsToCss({ sepia: true }, { sepia: false }).filter).toBeUndefined();
  });
});
