import { describe, expect, it } from 'vitest';
import { curvesToLut } from './curves-lut';
import { composeToneWithCurves, toneCurveTable } from './tone-curve';

describe('tone curve (sombras/luces/fade)', () => {
  it('reproduce los puntos fijos del export', () => {
    const table = toneCurveTable({ shadows: 0.8, fade: 0.5 })!;
    // Puntos: 0.25 → 0.25 + 0.8*0.12 + 0.5*0.05 = 0.371; 0.5 → 0.51.
    expect(table[0]).toBe(Math.round(0.05 * 255));
    expect(table[64]).toBeGreaterThanOrEqual(94);
    expect(table[64]).toBeLessThanOrEqual(96);
    expect(table[128]).toBeGreaterThanOrEqual(129);
    expect(table[128]).toBeLessThanOrEqual(131);
  });

  it('devuelve null sin cambios y compone antes de las curvas', () => {
    expect(toneCurveTable({})).toBeNull();
    const tone = toneCurveTable({ highlights: -0.5 })!;
    const curves = curvesToLut({
      red: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
    })!;
    const composed = composeToneWithCurves(tone, curves)!;
    for (const index of [0, 64, 128, 192, 255]) {
      expect(composed[index * 4]).toBe(curves[(tone[index] ?? index) * 4]);
      expect(composed[index * 4 + 3]).toBe(255);
    }
    const onlyTone = composeToneWithCurves(tone, null)!;
    expect(onlyTone[64 * 4]).toBe(tone[64]);
  });
});
