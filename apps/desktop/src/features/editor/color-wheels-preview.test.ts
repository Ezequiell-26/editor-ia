import { describe, expect, it } from 'vitest';
import {
  applyColorWheelsToPixels,
  colorBalancePixel,
  colorWheelsUniforms,
  gammaTable,
  hasColorWheels,
  sampleGamma,
} from './color-wheels-preview';

describe('color wheels preview', () => {
  it('detecta ruedas activas y descarta las vacías', () => {
    expect(hasColorWheels(undefined)).toBe(false);
    expect(
      hasColorWheels({ lift: { r: 0.001, g: 0, b: 0 } }),
    ).toBe(false);
    expect(hasColorWheels({ lift: { r: 0.2, g: 0, b: 0 } })).toBe(true);
    expect(hasColorWheels({ gamma: { b: -0.3, r: 0, g: 0 } })).toBe(true);
    expect(colorWheelsUniforms({ lift: { r: 0, g: 0, b: 0 } })).toBeNull();
  });

  it('recorta los valores al rango del export', () => {
    const wheels = colorWheelsUniforms({
      lift: { r: 5, g: -5, b: 0.25 },
      gain: { r: 1, g: 0, b: 0 },
    })!;
    expect(wheels.lift).toEqual([1, -1, 0.25]);
    expect(wheels.gain).toEqual([1, 0, 0]);
    expect(wheels.gamma).toBeNull();
  });

  it('suma el brillo a las nueve perillas como el export', () => {
    const wheels = colorWheelsUniforms({
      lift: { r: 0.4, g: 0, b: -0.4 },
      brightness: 0.5,
    })!;
    expect(wheels.lift[0]).toBeCloseTo(0.9, 6);
    expect(wheels.lift[1]).toBeCloseTo(0.5, 6);
    expect(wheels.lift[2]).toBeCloseTo(0.1, 6);
    expect(wheels.offset).toEqual([0.5, 0.5, 0.5]);
    expect(wheels.gain).toEqual([0.5, 0.5, 0.5]);
    // El brillo solo no activa el shader: lo maneja el CSS.
    expect(colorWheelsUniforms({ brightness: 0.5 })).toBeNull();
    // Salvo que la capa ya use shader por otro efecto.
    const only = colorWheelsUniforms({ brightness: 0.5 }, { brightnessOnly: true })!;
    expect(only.lift).toEqual([0.5, 0.5, 0.5]);
    expect(only.offset).toEqual([0.5, 0.5, 0.5]);
    expect(only.gain).toEqual([0.5, 0.5, 0.5]);
  });

  it('reproduce la curva gamma por canal', () => {
    const table = gammaTable([0.5, 0, 0])!;
    // mid = 0.5^(1/1.5) = 0.62996 → 161/255 en el centro.
    expect(Math.abs(table[128 * 4]! - 161)).toBeLessThanOrEqual(1);
    expect(table[0]).toBe(0);
    expect(table[255 * 4]).toBe(255);
    // Verde y azul quedan en identidad.
    expect(table[128 * 4 + 1]).toBe(128);
    expect(table[128 * 4 + 2]).toBe(128);
    expect(gammaTable([0, 0, 0])).toBeNull();
  });

  it('aplica colorbalance con la ligereza max+min', () => {
    const zero: [number, number, number] = [0, 0, 0];
    expect(colorBalancePixel([0.5, 0.5, 0.5], zero, zero, zero)).toEqual([
      0.5, 0.5, 0.5,
    ]);
    // El gris medio cae en luces: solo la perilla de gain actúa.
    expect(colorBalancePixel([0.5, 0.5, 0.5], zero, zero, [1, 0, 0])).toEqual([
      1, 0.5, 0.5,
    ]);
    // El gris oscuro reparte sombras y medios.
    const dark = colorBalancePixel([0.2, 0.2, 0.2], [1, 0, 0], zero, zero);
    expect(dark[0]).toBeCloseTo(0.2 + 0.232 * 0.7, 3);
    expect(dark[1]).toBeCloseTo(0.2, 3);
    const mids = colorBalancePixel([0.2, 0.2, 0.2], zero, [1, 0, 0], zero);
    expect(mids[0]).toBeCloseTo(0.2 + 0.768 * 0.7, 3);
  });

  it('interpola la tabla gamma como la textura', () => {
    const table = gammaTable([0.5, 0, 0])!;
    const atHalf = sampleGamma(table, 0, 128 / 255);
    expect(Math.abs(atHalf - table[128 * 4]! / 255)).toBeLessThan(0.004);
    expect(sampleGamma(table, 0, 0)).toBe(0);
    expect(sampleGamma(table, 0, 1)).toBe(1);
  });

  it('aplica ruedas y gamma a píxeles RGBA sin tocar el alfa', () => {
    const wheels = colorWheelsUniforms({
      lift: { r: 0.3, g: 0.1, b: -0.2 },
      offset: { r: 0.1, g: 0, b: 0.2 },
      gain: { r: 0.2, g: -0.1, b: 0.05 },
      gamma: { r: 0.3, g: 0, b: 0 },
    })!;
    const data = new Uint8ClampedArray([128, 128, 128, 77]);
    applyColorWheelsToPixels(wheels, data);
    const base = colorBalancePixel(
      [128 / 255, 128 / 255, 128 / 255],
      wheels.lift,
      wheels.offset,
      wheels.gain,
    );
    for (let channel = 0; channel < 3; channel += 1) {
      const expected = Math.round(
        (wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!) *
          255,
      );
      expect(Math.abs(data[channel]! - expected)).toBeLessThanOrEqual(1);
    }
    expect(data[3]).toBe(77);
  });
});
