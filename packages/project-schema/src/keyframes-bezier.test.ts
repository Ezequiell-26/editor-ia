import { describe, it, expect } from 'vitest';
import type { ClipTransformKeyframe } from './timeline.ts';
import {
  sampleTransformKeyframes,
  cubicBezierProgress,
  getBezierFromEasing,
  BEZIER_PRESETS,
  bezierPresetId,
} from './keyframes.ts';

describe('cubicBezierProgress', () => {
  it('es la identidad con control points lineales (0,0,1,1)', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(cubicBezierProgress(t, 0, 0, 1, 1)).toBeCloseTo(t, 6);
    }
  });

  it('clampa fuera de rango a los extremos', () => {
    expect(cubicBezierProgress(-0.5, 0, 0, 1, 1)).toBe(0);
    expect(cubicBezierProgress(1.5, 0.42, 0, 0.58, 1)).toBe(1);
  });

  it('curva simétrica ease-in-out cruza el centro en 0.5 y arranca lenta', () => {
    const p = (t: number) => cubicBezierProgress(t, 0.42, 0, 0.58, 1);
    expect(p(0.5)).toBeCloseTo(0.5, 5);
    expect(p(0.25)).toBeLessThan(0.25);
    expect(p(0.75)).toBeGreaterThan(0.75);
  });

  it('curva con arranque demorado (0.9,0,1,1) mantiene el progreso bajo en la primera mitad', () => {
    const slowStart = cubicBezierProgress(0.5, 0.9, 0, 1, 1);
    expect(slowStart).toBeLessThan(0.3);
    expect(slowStart).toBeGreaterThan(0);
  });

  it('es monótona no decreciente en una grilla fina', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 40; i += 1) {
      const value = cubicBezierProgress(i / 40, 0.3, 0, 0.7, 1);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });
});

describe('getBezierFromEasing', () => {
  it('mapea presets a puntos de partida del editor', () => {
    expect(getBezierFromEasing('linear')).toEqual({ cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1 });
    expect(getBezierFromEasing('ease-in-out')).toEqual({ cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 });
    expect(getBezierFromEasing('ease-out').cp2X).toBeCloseTo(0.58, 6);
    expect(getBezierFromEasing('desconocido')).toEqual({ cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1 });
  });
});

describe('muestreo con bezier explícito en keyframes', () => {
  it('un bezier explícito reemplaza al preset del segmento', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 0, bezier: { cp1X: 0.9, cp1Y: 0, cp2X: 1, cp2Y: 1 } },
      { frame: 100, scale: 100 },
    ];
    // Con arranque demorado, a mitad de segmento el valor debe quedar bastante
    // por debajo del linear (50) pero avanzar respecto del inicio (0).
    const sampled = sampleTransformKeyframes(keyframes, 50);
    expect(sampled.scale).toBeDefined();
    expect(sampled.scale!).toBeGreaterThan(0);
    expect(sampled.scale!).toBeLessThan(30);
  });

  it('el bezier gobierna el segmento que empieza en su keyframe (convención de easing)', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 0, bezier: { cp1X: 0, cp1Y: 0, cp2X: 0.1, cp2Y: 1 } },
      { frame: 100, scale: 100 },
    ];
    // Curva con salida temprana: en el 25% del segmento ya supera la mitad del valor.
    const sampled = sampleTransformKeyframes(keyframes, 25);
    expect(sampled.scale!).toBeGreaterThan(50);
  });

  it('un bezier en el keyframe final es inerte (no hay segmento que empiece ahí)', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 0 },
      { frame: 100, scale: 100, bezier: { cp1X: 0, cp1Y: 0, cp2X: 0.1, cp2Y: 1 } },
    ];
    expect(sampleTransformKeyframes(keyframes, 25).scale).toBeCloseTo(25, 6);
  });

  it('sin bezier el preset legacy se mantiene exacto (ease-in cúbico)', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 0, easing: 'ease-in' },
      { frame: 100, scale: 100 },
    ];
    expect(sampleTransformKeyframes(keyframes, 50).scale).toBeCloseTo(100 * 0.5 ** 3, 6);
  });

  it('hold sigue siendo un escalón y no una curva', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 1, easing: 'hold' },
      { frame: 100, scale: 5 },
    ];
    expect(sampleTransformKeyframes(keyframes, 50).scale).toBe(1);
    expect(sampleTransformKeyframes(keyframes, 100).scale).toBe(5);
  });

  it('keyframes con y sin bezier conviven por segmentos', () => {
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 0, bezier: { cp1X: 0.9, cp1Y: 0, cp2X: 1, cp2Y: 1 } },
      { frame: 50, scale: 50, easing: 'linear' },
      { frame: 100, scale: 100 },
    ];
    // Primer segmento con bezier lento: por debajo del linear 25.
    expect(sampleTransformKeyframes(keyframes, 25).scale!).toBeLessThan(25);
    // Segundo segmento sin bezier y linear: exacto (el bezier del keyframe
    // inicial no se filtra al segmento siguiente).
    expect(sampleTransformKeyframes(keyframes, 75).scale!).toBeCloseTo(75, 6);
  });

  it('un bezier inválido se ignora y no rompe el muestreo', () => {
    const keyframes = [
      { frame: 0, scale: 0, bezier: { cp1X: 'x' } },
      { frame: 100, scale: 100, easing: 'linear' },
    ] as unknown as ClipTransformKeyframe[];
    expect(sampleTransformKeyframes(keyframes, 50).scale).toBeCloseTo(50, 6);
  });
});

describe('BEZIER_PRESETS', () => {
  it('expone las 13 curvas con ids únicos y coords en rango de esquema', () => {
    expect(BEZIER_PRESETS).toHaveLength(13);
    const ids = new Set(BEZIER_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(13);
    for (const preset of BEZIER_PRESETS) {
      const { cp1X, cp1Y, cp2X, cp2Y } = preset.bezier;
      expect(cp1X).toBeGreaterThanOrEqual(0);
      expect(cp1X).toBeLessThanOrEqual(1);
      expect(cp2X).toBeGreaterThanOrEqual(0);
      expect(cp2X).toBeLessThanOrEqual(1);
      expect(cp1Y).toBeGreaterThanOrEqual(-1);
      expect(cp1Y).toBeLessThanOrEqual(2);
      expect(cp2Y).toBeGreaterThanOrEqual(-1);
      expect(cp2Y).toBeLessThanOrEqual(2);
    }
  });

  it('bezierPresetId reconoce la curva y devuelve null para personalizadas', () => {
    const linear = BEZIER_PRESETS.find((preset) => preset.id === 'linear')!;
    expect(bezierPresetId(linear.bezier)).toBe('linear');
    expect(bezierPresetId({ cp1X: 0.1, cp1Y: 0.2, cp2X: 0.3, cp2Y: 0.4 })).toBeNull();
    expect(bezierPresetId(undefined)).toBeNull();
  });

  it('los presets de rebote producen overshoot real (y fuera de [0,1])', () => {
    const reboteSalida = BEZIER_PRESETS.find((preset) => preset.id === 'rebote-salida')!;
    const values = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) =>
      cubicBezierProgress(t, reboteSalida.bezier.cp1X, reboteSalida.bezier.cp1Y, reboteSalida.bezier.cp2X, reboteSalida.bezier.cp2Y),
    );
    expect(Math.max(...values)).toBeGreaterThan(1);
    const reboteEntrada = BEZIER_PRESETS.find((preset) => preset.id === 'rebote-entrada')!;
    const entrada = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) =>
      cubicBezierProgress(t, reboteEntrada.bezier.cp1X, reboteEntrada.bezier.cp1Y, reboteEntrada.bezier.cp2X, reboteEntrada.bezier.cp2Y),
    );
    expect(Math.min(...entrada)).toBeLessThan(0);
  });

  it('un preset aplicado como bezier muestrea con overshoot en scale', () => {
    const rebote = BEZIER_PRESETS.find((preset) => preset.id === 'rebote-salida')!;
    const keyframes: ClipTransformKeyframe[] = [
      { frame: 0, scale: 1, bezier: { ...rebote.bezier } },
      { frame: 100, scale: 2 },
    ];
    // Con overshoot, algún punto intermedio supera el valor final relativo.
    const samples = [10, 30, 50, 70, 90].map((frame) =>
      sampleTransformKeyframes(keyframes, frame).scale!,
    );
    expect(Math.max(...samples)).toBeGreaterThan(2);
  });
});
