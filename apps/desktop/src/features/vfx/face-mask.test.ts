import { describe, expect, it } from 'vitest';
import type { FaceTrackResult } from '../../services/project-service';
import { maskFromFaceTrack, polygonAroundCenter } from './face-mask';

function result(overrides: Partial<FaceTrackResult> = {}): FaceTrackResult {
  return {
    model: 'seeta-face',
    durationSeconds: 2,
    detections: 2,
    samples: [
      { time: 0, centerX: 0.5, centerY: 0.5, size: 0.2 },
      { time: 1, centerX: 0.6, centerY: 0.55, size: 0.2 },
    ],
    track: [],
    scaledWidth: 640,
    scaledHeight: 360,
    xExpression: '',
    yExpression: '',
    ...overrides,
  };
}

describe('roto asistido por seguimiento facial', () => {
  it('convierte el track en un polígono con claves x/y', () => {
    const mask = maskFromFaceTrack(result(), 30);
    expect(mask?.shape).toBe('polygon');
    expect(mask?.points).toHaveLength(8);
    expect(mask?.keyframes?.[0]?.frame).toBe(0);
    expect(mask?.keyframes?.[1]?.frame).toBe(30);
    expect(mask?.keyframes?.[1]?.x).toBeCloseTo(0.1, 3);
    expect(mask?.keyframes?.[1]?.y).toBeCloseTo(0.05, 3);
    expect(mask?.feather).toBe(0);
  });

  it('resta el inicio del análisis para que las claves sean locales al clip', () => {
    const mask = maskFromFaceTrack(
      result({
        samples: [
          { time: 10, centerX: 0.5, centerY: 0.5, size: 0.2 },
          { time: 12, centerX: 0.6, centerY: 0.5, size: 0.2 },
        ],
      }),
      30,
      10,
    );
    expect(mask?.keyframes?.[0]?.frame).toBe(0);
    expect(mask?.keyframes?.[1]?.frame).toBe(60);
  });

  it('limita el número de claves y deduplica frames', () => {
    const samples = Array.from({ length: 200 }, (_, index) => ({
      time: index / 120,
      centerX: 0.5,
      centerY: 0.5,
      size: 0.2,
    }));
    const mask = maskFromFaceTrack(result({ samples }), 30);
    expect(mask?.keyframes?.length).toBeLessThanOrEqual(48);
  });

  it('devuelve null sin muestras o sin fps válido', () => {
    expect(maskFromFaceTrack(result({ samples: [] }), 30)).toBeNull();
    expect(maskFromFaceTrack(result(), 0)).toBeNull();
  });

  it('crea un polígono manual alrededor de un punto', () => {
    const mask = polygonAroundCenter(0.5, 0.5, 0.2);
    expect(mask.points).toHaveLength(8);
    expect(mask.points?.[0]?.x).toBeCloseTo(0.5, 3);
    expect(mask.points?.[0]?.y).toBeCloseTo(0.3, 3);
  });
});
