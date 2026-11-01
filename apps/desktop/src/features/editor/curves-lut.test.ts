import { describe, expect, it } from 'vitest';
import {
  CURVE_LUT_SIZE,
  applyCurveToPixels,
  curvesEqual,
  curvesToLut,
} from './curves-lut';

function channel(table: Uint8Array, offset: 0 | 1 | 2): number[] {
  return Array.from({ length: CURVE_LUT_SIZE }, (_, index) => table[index * 4 + offset]!);
}

describe('curves preview table', () => {
  it('devuelve null sin curvas o con una identidad explícita', () => {
    expect(curvesToLut(undefined)).toBeNull();
    expect(
      curvesToLut({ master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    ).toBeNull();
    expect(
      curvesToLut({
        red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      }),
    ).toBeNull();
  });

  it('invierte sólo el canal rojo', () => {
    const table = curvesToLut({ red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] });
    expect(table).not.toBeNull();
    expect(table![0]).toBe(255);
    expect(table![CURVE_LUT_SIZE * 4 - 4]).toBe(0);
    expect(table![1]).toBe(0);
    expect(table![CURVE_LUT_SIZE * 4 - 3]).toBe(255);
    expect(table![2]).toBe(0);
  });

  it('aplica la maestra después de la curva de cada canal', () => {
    const invert = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    const table = curvesToLut({ red: invert, master: invert })!;
    // invertir dos veces vuelve a la identidad.
    expect(channel(table, 0)).toEqual(
      Array.from({ length: CURVE_LUT_SIZE }, (_, index) => index),
    );
    const masterOnly = curvesToLut({ master: invert })!;
    expect(masterOnly[0]).toBe(255);
    expect(masterOnly[1]).toBe(255);
    expect(masterOnly[2]).toBe(255);
    expect(masterOnly[CURVE_LUT_SIZE * 4 - 4]).toBe(0);
  });

  it('ignora canales que no empiezan en 0 y terminan en 1, como el export', () => {
    expect(
      curvesToLut({ red: [{ x: 0.1, y: 0 }, { x: 1, y: 1 }] }),
    ).toBeNull();
  });

  it('respeta el punto de control con spline natural', () => {
    const table = curvesToLut({
      red: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.25 },
        { x: 1, y: 1 },
      ],
    })!;
    expect(Math.abs(table[128 * 4]! - 64)).toBeLessThanOrEqual(1);
    expect(table[0]).toBe(0);
    expect(table[255 * 4]).toBe(255);
  });

  it('aplica la tabla a píxeles y conserva el alfa', () => {
    const table = curvesToLut({ master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] })!;
    const pixels = new Uint8ClampedArray([0, 128, 255, 77]);
    applyCurveToPixels(table, pixels);
    expect(pixels[0]).toBe(255);
    expect(pixels[1]).toBe(127);
    expect(pixels[2]).toBe(0);
    expect(pixels[3]).toBe(77);
  });

  it('compara tablas por contenido', () => {
    const table = curvesToLut({ red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] });
    expect(curvesEqual(table, table)).toBe(true);
    expect(curvesEqual(table, Uint8Array.from(table!))).toBe(true);
    expect(curvesEqual(table, null)).toBe(false);
    const other = Uint8Array.from(table!);
    other[0] = (other[0]! + 1) % 256;
    expect(curvesEqual(table, other)).toBe(false);
  });
});
