import { describe, expect, it } from 'vitest';
import {
  curveSourceFraction,
  meanSpeedCurve,
  sampleSpeedCurve,
  type Clip,
  type SpeedCurve,
} from '@editor-ia/project-schema';
import {
  clipIsReversed,
  clipPreviewRateAtLocal,
  clipSourceFrameAtLocal,
} from './clip-source-time';

function videoClip(partial: Record<string, unknown> = {}): Clip {
  return {
    id: 'c1',
    trackId: 'v1',
    kind: 'video',
    label: 'clip',
    startFrame: 0,
    durationFrames: 60,
    source: { type: 'asset', assetId: 'a1', inFrame: 10, outFrame: 70 },
    ...partial,
  } as Clip;
}

const RAMP: SpeedCurve = {
  points: [
    { t: 0, speed: 0.5 },
    { t: 1, speed: 2 },
  ],
};

describe('clipSourceFrameAtLocal', () => {
  it('devuelve null para fuentes sin ventana (graphic/image)', () => {
    const graphic = {
      id: 'g',
      trackId: 'v1',
      kind: 'graphic',
      label: 'g',
      startFrame: 0,
      durationFrames: 30,
      source: { type: 'graphic', motionId: 'm' },
    } as Clip;
    expect(clipSourceFrameAtLocal(graphic, 5)).toBeNull();
  });

  it('velocidad 1×: frame local se suma a inFrame', () => {
    expect(clipSourceFrameAtLocal(videoClip(), 12)).toBe(22);
  });

  it('velocidad constante 2× duplica el paso a la fuente', () => {
    const clip = videoClip({ speed: { num: 2, den: 1 } });
    expect(clipSourceFrameAtLocal(clip, 5)).toBe(20);
  });

  it('local negativo (lead de transición) retrocede desde inFrame', () => {
    const clip = videoClip({ speed: { num: 2, den: 1 } });
    expect(clipSourceFrameAtLocal(clip, -3)).toBe(4);
  });

  it('reverse recorre la ventana de salida al revés', () => {
    const clip = videoClip({ reverse: true });
    // durationFrames 60 → espejo 59 - 10 = 49 → inFrame 10 + 49 = 59.
    expect(clipSourceFrameAtLocal(clip, 10)).toBe(59);
    expect(clipSourceFrameAtLocal(clip, 0)).toBe(69);
  });

  it('speedCurve mapea por curveSourceFraction (extremos exactos)', () => {
    const clip = videoClip({ speedCurve: RAMP });
    expect(clipSourceFrameAtLocal(clip, 0)).toBe(10);
    expect(clipSourceFrameAtLocal(clip, 59)).toBe(70);
    const mid = clipSourceFrameAtLocal(clip, 30);
    const expected =
      10 + curveSourceFraction(RAMP, 30 / 59) * (70 - 10);
    expect(mid).toBeCloseTo(expected, 6);
  });

  it("speedCurve modo 'mean' usa la media constante (render con lead)", () => {
    const clip = videoClip({ speedCurve: RAMP });
    const mean = meanSpeedCurve(RAMP);
    expect(clipSourceFrameAtLocal(clip, 10, { speedCurve: 'mean' })).toBeCloseTo(
      10 + 10 * mean,
      6,
    );
  });

  it("speedCurve modo 'off' ignora la curva y usa velocidad constante", () => {
    const clip = videoClip({ speedCurve: RAMP });
    expect(clipSourceFrameAtLocal(clip, 10, { speedCurve: 'off' })).toBe(20);
  });
});

describe('clipPreviewRateAtLocal', () => {
  it('devuelve la velocidad instantánea de la curva', () => {
    const clip = videoClip({ speedCurve: RAMP });
    // t=0 → speed 0.5; t=1 → speed 2 (lineal).
    expect(clipPreviewRateAtLocal(clip, 0)).toBeCloseTo(0.5, 6);
    expect(clipPreviewRateAtLocal(clip, 59)).toBeCloseTo(2, 6);
    expect(clipPreviewRateAtLocal(clip, 30)).toBeCloseTo(
      sampleSpeedCurve(RAMP, 30 / 59),
      6,
    );
  });

  it("modo 'mean' devuelve la media; 'off' y sin curva la velocidad del clip", () => {
    const clip = videoClip({ speedCurve: RAMP });
    expect(clipPreviewRateAtLocal(clip, 30, { speedCurve: 'mean' })).toBeCloseTo(
      meanSpeedCurve(RAMP),
      6,
    );
    expect(clipPreviewRateAtLocal(clip, 30, { speedCurve: 'off' })).toBe(1);
    expect(
      clipPreviewRateAtLocal(videoClip({ speed: { num: 3, den: 2 } }), 0),
    ).toBeCloseTo(1.5, 6);
  });

  it('devuelve null sin fuente de ventana', () => {
    const graphic = {
      id: 'g',
      trackId: 'v1',
      kind: 'graphic',
      label: 'g',
      startFrame: 0,
      durationFrames: 30,
      source: { type: 'graphic', motionId: 'm' },
    } as Clip;
    expect(clipPreviewRateAtLocal(graphic, 0)).toBeNull();
  });
});

describe('clipIsReversed', () => {
  it('detecta reverse en video y audio', () => {
    expect(clipIsReversed(videoClip({ reverse: true }))).toBe(true);
    expect(clipIsReversed(videoClip())).toBe(false);
    const audio = {
      id: 'a',
      trackId: 'a1',
      kind: 'audio',
      label: 'a',
      startFrame: 0,
      durationFrames: 60,
      reverse: true,
      source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 60 },
    } as Clip;
    expect(clipIsReversed(audio)).toBe(true);
    expect(clipSourceFrameAtLocal(audio, 10)).toBe(49);
  });
});
