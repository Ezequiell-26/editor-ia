import { describe, expect, it } from 'vitest';
import { ClipSchema, ClipCurvesSchema, MAX_CURVE_POINTS } from './timeline.ts';
import {
  CURVE_IDENTITY,
  curvePointsFor,
  curveTableValues,
  hasCustomCurves,
  sampleCurvePoints,
} from './curves.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function imageClip(effects: unknown) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'image',
    source: { type: 'asset', assetId: ASSET },
    startFrame: 0,
    durationFrames: 90,
    effects,
  };
}

function sCurve() {
  return [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.18 },
    { x: 0.5, y: 0.55 },
    { x: 0.75, y: 0.86 },
    { x: 1, y: 1 },
  ];
}

describe('curvas de color personalizadas', () => {
  it('acepta canales maestro y por color dentro del clip', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({
        curves: {
          master: sCurve(),
          red: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('exige anclas en negro y blanco y orden estricto de x', () => {
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0.1, y: 0 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 0 }, { x: 0.9, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 0 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.7 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 0 }, { x: 0, y: 0.5 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
  });

  it('rechaza curvas vacías, cortas, largas y valores fuera de rango', () => {
    expect(ClipCurvesSchema.safeParse({}).success).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({ master: [{ x: 0, y: 0 }] }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: MAX_CURVE_POINTS + 1 }, (_, index) => ({
      x: index / MAX_CURVE_POINTS,
      y: index / MAX_CURVE_POINTS,
    }));
    expect(ClipCurvesSchema.safeParse({ master: tooMany }).success).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 1.2 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 0 }, { x: 0.5, y: 2 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
  });

  it('rechaza canales y claves desconocidas', () => {
    expect(
      ClipCurvesSchema.safeParse({
        lum: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipCurvesSchema.safeParse({
        master: [{ x: 0, y: 0, extra: 1 }, { x: 1, y: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse(
        imageClip({
          curves: { master: sCurve(), alpha: sCurve() },
        }),
      ).success,
    ).toBe(false);
  });

  it('muestrea de forma lineal y arma la tabla del preview', () => {
    expect(sampleCurvePoints(CURVE_IDENTITY, 0.37)).toBeCloseTo(0.37, 5);
    expect(sampleCurvePoints(sCurve(), 0.5)).toBeCloseTo(0.55, 5);
    expect(sampleCurvePoints(sCurve(), 0.25)).toBeCloseTo(0.18, 5);
    expect(sampleCurvePoints(sCurve(), -1)).toBe(0);
    expect(sampleCurvePoints(sCurve(), 2)).toBe(1);
    const table = curveTableValues(sCurve(), 16).split(' ');
    expect(table).toHaveLength(16);
    expect(table[0]).toBe('0.0000');
    expect(table[15]).toBe('1.0000');
    expect(Number(table[8])).toBeCloseTo(0.5913, 3);
  });

  it('detecta y recupera canales personalizados', () => {
    expect(hasCustomCurves(undefined)).toBe(false);
    expect(hasCustomCurves({})).toBe(false);
    expect(hasCustomCurves({ master: sCurve() })).toBe(true);
    expect(curvePointsFor(undefined, 'master')).toEqual(CURVE_IDENTITY);
    expect(curvePointsFor({ red: sCurve() }, 'red')).toHaveLength(5);
    expect(curvePointsFor({ red: sCurve() }, 'master')).toEqual(CURVE_IDENTITY);
  });
});
