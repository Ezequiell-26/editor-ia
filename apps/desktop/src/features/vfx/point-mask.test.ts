import { describe, expect, it } from 'vitest';
import type { ObjectTrackResult, PointTrackResult } from '../../services/project-service';
import { maskFromObjectTrack, maskFromPointTrack } from './point-mask';

function result(points: PointTrackResult['points']): PointTrackResult {
  return {
    durationSeconds: 1,
    fps: 6,
    scaledWidth: 480,
    scaledHeight: 270,
    points,
  };
}

function objectResult(points: PointTrackResult['points']): ObjectTrackResult {
  return {
    durationSeconds: 1,
    fps: 6,
    scaledWidth: 480,
    scaledHeight: 270,
    regionWidth: 0.2,
    regionHeight: 0.1,
    points,
  };
}

describe('máscara desde seguimiento de punto', () => {
  it('crea un polígono alrededor del primer punto y claves de desplazamiento', () => {
    const mask = maskFromPointTrack(
      result([
        { time: 0, x: 0.4, y: 0.5, confidence: 1 },
        { time: 0.5, x: 0.55, y: 0.5, confidence: 0.9 },
        { time: 1, x: 0.7, y: 0.45, confidence: 0.8 },
      ]),
      10,
      0.2,
    );
    expect(mask).not.toBeNull();
    expect(mask?.shape).toBe('polygon');
    expect(mask?.points).toHaveLength(8);
    expect(mask?.keyframes?.map((frame) => frame.frame)).toEqual([0, 5, 10]);
    expect(mask?.keyframes?.[1]?.x).toBeCloseTo(0.15, 5);
    expect(mask?.keyframes?.[2]?.y).toBeCloseTo(-0.05, 5);
    const first = mask?.points?.[0];
    expect(first?.x).toBeCloseTo(0.4, 5);
    expect(first?.y).toBeCloseTo(0.3, 5);
  });

  it('descarta muestras de baja confianza y devuelve null sin muestras', () => {
    const mask = maskFromPointTrack(
      result([
        { time: 0, x: 0.4, y: 0.5, confidence: 1 },
        { time: 0.2, x: 0.45, y: 0.5, confidence: 0.2 },
        { time: 0.4, x: 0.5, y: 0.5, confidence: 0.9 },
      ]),
      10,
    );
    expect(mask?.keyframes?.map((frame) => frame.frame)).toEqual([0, 4]);
    expect(maskFromPointTrack(result([]), 10)).toBeNull();
    expect(
      maskFromPointTrack(result([{ time: 0, x: 0.4, y: 0.5, confidence: 0.1 }]), 10),
    ).toBeNull();
  });

  it('acota el radio y la cantidad de claves', () => {
    const points = Array.from({ length: 120 }, (_, index) => ({
      time: index / 60,
      x: 0.5,
      y: 0.5,
      confidence: 1,
    }));
    const mask = maskFromPointTrack(result(points), 60, 9);
    expect((mask?.points?.[0]?.x ?? 0) - 0.5).toBeLessThan(0.46);
    expect(mask?.keyframes?.length).toBeLessThanOrEqual(48);
  });
});

describe('máscara desde seguimiento de objeto', () => {
  it('crea un rectángulo del tamaño de la región con claves de traslación', () => {
    const mask = maskFromObjectTrack(
      objectResult([
        { time: 0, x: 0.4, y: 0.5, confidence: 1 },
        { time: 0.5, x: 0.55, y: 0.45, confidence: 0.9 },
        { time: 1, x: 0.7, y: 0.5, confidence: 0.8 },
      ]),
      10,
    );
    expect(mask).not.toBeNull();
    expect(mask?.points).toHaveLength(4);
    const xs = mask?.points?.map((point) => point.x) ?? [];
    const ys = mask?.points?.map((point) => point.y) ?? [];
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.1, 5);
    expect(mask?.keyframes?.map((frame) => frame.frame)).toEqual([0, 5, 10]);
    expect(mask?.keyframes?.[1]?.x).toBeCloseTo(0.15, 5);
    expect(mask?.keyframes?.[2]?.y).toBeCloseTo(0, 5);
  });

  it('acota el tamaño, descarta baja confianza y devuelve null sin datos', () => {
    const mask = maskFromObjectTrack(
      objectResult([
        { time: 0, x: 0.1, y: 0.1, confidence: 1 },
        { time: 0.5, x: 0.9, y: 0.9, confidence: 0.2 },
      ]),
      10,
      3,
      3,
    );
    for (const point of mask?.points ?? []) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
    expect(maskFromObjectTrack(objectResult([]), 10)).toBeNull();
    expect(
      maskFromObjectTrack(
        objectResult([{ time: 0, x: 0.5, y: 0.5, confidence: 0.2 }]),
        10,
      ),
    ).toBeNull();
  });
});
