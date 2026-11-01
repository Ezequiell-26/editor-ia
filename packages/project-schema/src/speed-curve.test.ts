import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.ts';
import {
  SPEED_CURVE_MAX_KNOTS,
  buildSpeedKnots,
  curveDurationFrames,
  curveSourceFraction,
  meanSpeedCurve,
  sampleSpeedCurve,
  speedEasingProgress,
} from './speed-curve.ts';
import type { SpeedCurveLike } from './speed-curve.ts';

const TRACK = '11111111-1111-4111-8111-111111111111';
const CLIP = '33333333-3333-4333-8333-333333333333';
const ASSET = '55555555-5555-4555-8555-555555555555';

const ramp: SpeedCurveLike = {
  points: [
    { t: 0, speed: 0.5 },
    { t: 1, speed: 2 },
  ],
};

function videoClip(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIP,
    trackId: TRACK,
    kind: 'video',
    startFrame: 0,
    durationFrames: 96,
    source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 120 },
    ...overrides,
  };
}

describe('matemática de curvas de velocidad', () => {
  it('interpola una rampa lineal en el tiempo de salida', () => {
    expect(sampleSpeedCurve(ramp, 0)).toBeCloseTo(0.5, 6);
    expect(sampleSpeedCurve(ramp, 0.5)).toBeCloseTo(1.25, 6);
    expect(sampleSpeedCurve(ramp, 1)).toBeCloseTo(2, 6);
  });

  it('respeta el easing del punto que abre el tramo', () => {
    const eased: SpeedCurveLike = {
      points: [
        { t: 0, speed: 0, easing: 'ease-in' },
        { t: 1, speed: 4 },
      ],
    };
    // La velocidad mínima del esquema es 0.1; acá se prueban las matemáticas.
    expect(sampleSpeedCurve(eased, 0.5)).toBeCloseTo(4 * speedEasingProgress('ease-in', 0.5), 6);
  });

  it('la media de una rampa lineal es la media de sus extremos', () => {
    expect(meanSpeedCurve(ramp)).toBeCloseTo(1.25, 4);
  });

  it('calcula la duración desde la ventana de origen y la media', () => {
    expect(curveDurationFrames(120, ramp)).toBe(96);
    expect(curveDurationFrames(120, { points: [{ t: 0, speed: 2 }, { t: 1, speed: 2 }] })).toBe(60);
  });

  it('la fracción de fuente acumulada es monótona y cierra en 1', () => {
    expect(curveSourceFraction(ramp, 0)).toBe(0);
    expect(curveSourceFraction(ramp, 1)).toBe(1);
    let previous = 0;
    for (let step = 1; step <= 10; step += 1) {
      const value = curveSourceFraction(ramp, step / 10);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('genera knots ordenados con extremos exactos y respeta el tope', () => {
    const knots = buildSpeedKnots(ramp, 8);
    expect(knots).toHaveLength(9);
    expect(knots[0]).toEqual({ input: 0, output: 0 });
    expect(knots[knots.length - 1]).toEqual({ input: 1, output: 1 });
    let previous = -1;
    for (const knot of knots) {
      expect(knot.input).toBeGreaterThanOrEqual(previous);
      previous = knot.input;
    }
    expect(buildSpeedKnots(ramp, 500)).toHaveLength(SPEED_CURVE_MAX_KNOTS + 1);
  });
});

describe('schema de curva de velocidad', () => {
  it('acepta un clip cuya duración sigue la media de la curva', () => {
    expect(
      ClipSchema.safeParse(videoClip({ speedCurve: ramp })).success,
    ).toBe(true);
  });

  it('rechaza una duración que no corresponde a la media', () => {
    const result = ClipSchema.safeParse(videoClip({ speedCurve: ramp, durationFrames: 70 }));
    expect(result.success).toBe(false);
  });

  it('tolera un frame de redondeo', () => {
    expect(
      ClipSchema.safeParse(videoClip({ speedCurve: ramp, durationFrames: 95 })).success,
    ).toBe(true);
  });

  it('no permite velocidad constante y curva en el mismo clip', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({ speedCurve: ramp, speed: { num: 1, den: 1 } }),
      ).success,
    ).toBe(false);
  });

  it('exige que la curva empiece en 0 y termine en 1', () => {
    const broken = { points: [{ t: 0.2, speed: 1 }, { t: 1, speed: 1 }] };
    expect(ClipSchema.safeParse(videoClip({ speedCurve: broken })).success).toBe(false);
  });
});
