import { describe, it, expect } from 'vitest';
import type { ClipTransformKeyframe } from './timeline.ts';
import {
  sampleTransformKeyframes,
  cubicBezierProgress,
  getBezierFromEasing,
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
