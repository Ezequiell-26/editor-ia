import { describe, expect, it } from 'vitest';
import {
  curveDurationFrames,
  meanSpeedCurve,
} from '@editor-ia/project-schema';
import { suggestBeatSpeedCurve } from './speed-ramp-suggest';

const FPS = 30;
const IN_FRAME = 0;
const OUT_FRAME = 300; // 10 s de fuente

function beatsEvery(seconds: number, count: number, offset = 0): number[] {
  return Array.from({ length: count }, (_, index) => offset + index * seconds);
}

describe('suggestBeatSpeedCurve', () => {
  it('devuelve null sin pulsos dentro de la ventana', () => {
    expect(suggestBeatSpeedCurve([], IN_FRAME, OUT_FRAME, FPS)).toBeNull();
    expect(suggestBeatSpeedCurve([1], IN_FRAME, OUT_FRAME, FPS)).toBeNull();
  });

  it('descarta pulsos fuera de la ventana de origen', () => {
    // Ventana 100..200 frames (3.33–6.67 s): los pulsos de 1 s y 9 s quedan afuera.
    const suggestion = suggestBeatSpeedCurve(
      [1, 3.5, 4, 5, 6.5, 9],
      100,
      200,
      FPS,
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.beatsInClip).toBe(4);
  });

  it('genera una curva válida: extremos 0/1, t creciente, velocidades en rango', () => {
    const suggestion = suggestBeatSpeedCurve(
      beatsEvery(1, 8),
      IN_FRAME,
      OUT_FRAME,
      FPS,
    );
    expect(suggestion).not.toBeNull();
    const { points } = suggestion!.curve;
    expect(points.length).toBeGreaterThanOrEqual(8);
    expect(points.length).toBeLessThanOrEqual(50);
    expect(points[0]!.t).toBe(0);
    expect(points[points.length - 1]!.t).toBe(1);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.t).toBeGreaterThan(points[index - 1]!.t);
      expect(points[index]!.speed).toBeGreaterThanOrEqual(0.1);
      expect(points[index]!.speed).toBeLessThanOrEqual(4);
    }
  });

  it('las ventanas bajan la velocidad cerca de cada pulso y la media es < 1', () => {
    const suggestion = suggestBeatSpeedCurve(
      beatsEvery(1, 8),
      IN_FRAME,
      OUT_FRAME,
      FPS,
      { slowSpeed: 0.5, dipSeconds: 0.6 },
    )!;
    const { curve, sourceFrames } = suggestion;
    // Los puntos de la curva incluyen el fondo de cada ventana.
    const minSpeed = Math.min(...curve.points.map((point) => point.speed));
    expect(minSpeed).toBeLessThan(0.7);
    expect(minSpeed).toBeGreaterThanOrEqual(0.45);
    // Lejos de los pulsos la velocidad es ~1× (los pulsos cada 1 s con dip
    // de 0.6 s dejan huecos; el punto medio entre pulsos está a 0.5 s).
    expect(suggestion.meanSpeed).toBeLessThan(1);
    expect(suggestion.durationFrames).toBe(
      curveDurationFrames(sourceFrames, curve),
    );
    expect(suggestion.durationFrames).toBeGreaterThan(sourceFrames);
    expect(meanSpeedCurve(curve)).toBeCloseTo(suggestion.meanSpeed, 6);
  });

  it('fusiona pulsos más cercanos que minGapSeconds', () => {
    // Pulsos a 1.00 s y 1.10 s (3 frames de fuente): con gap 0.3 s se funden.
    const suggestion = suggestBeatSpeedCurve(
      [1, 1.1, 3, 5, 7, 9],
      IN_FRAME,
      OUT_FRAME,
      FPS,
    )!;
    expect(suggestion.beatsInClip).toBe(6);
    expect(suggestion.dips).toBe(5);
  });

  it('dos pulsos muy juntos no producen dips solapados imposibles', () => {
    const suggestion = suggestBeatSpeedCurve(
      [2, 2.05, 8],
      IN_FRAME,
      OUT_FRAME,
      FPS,
    );
    // 2.00 y 2.05 se funden → quedan 2 dips → curva válida.
    expect(suggestion).not.toBeNull();
    expect(suggestion!.dips).toBe(2);
  });

  it('respeta slowSpeed y acota el resultado al rango del schema', () => {
    const suggestion = suggestBeatSpeedCurve(
      beatsEvery(1, 8),
      IN_FRAME,
      OUT_FRAME,
      FPS,
      { slowSpeed: 0.25, dipSeconds: 1.2 },
    )!;
    const speeds = suggestion.curve.points.map((point) => point.speed);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0.25 - 1e-4);
    expect(Math.min(...speeds)).toBeLessThan(0.4);
  });

  it('devuelve null con ventana de origen inválida o fps inválido', () => {
    expect(suggestBeatSpeedCurve([1, 2, 3], 100, 100, FPS)).toBeNull();
    expect(suggestBeatSpeedCurve([1, 2, 3], 100, 200, 0)).toBeNull();
    expect(suggestBeatSpeedCurve([1, 2, 3], 100, 200, Number.NaN)).toBeNull();
  });

  it('la duración resultante es coherente con la media de la curva', () => {
    const sourceFrames = 450;
    const suggestion = suggestBeatSpeedCurve(
      [1, 2.5, 4, 6, 8, 10, 12, 14],
      0,
      sourceFrames,
      FPS,
      { slowSpeed: 0.4 },
    )!;
    const expected = Math.max(
      1,
      Math.round(sourceFrames / suggestion.meanSpeed),
    );
    expect(suggestion.durationFrames).toBe(expected);
    expect(suggestion.sourceFrames).toBe(sourceFrames);
  });
});
