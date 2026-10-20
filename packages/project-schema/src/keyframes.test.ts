import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.ts';
import {
  hasGeometryKeyframes,
  keyframeFrameAt,
  sampleGainKeyframes,
  sampleTransformKeyframes,
} from './keyframes.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function videoClip(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'video',
    source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
    startFrame: 0,
    durationFrames: 90,
    ...extra,
  };
}

function imageClip(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'image',
    source: { type: 'asset', assetId: ASSET },
    startFrame: 0,
    durationFrames: 90,
    ...extra,
  };
}

describe('keyframes de transformación', () => {
  it('acepta una animación ordenada dentro del clip', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({
        transform: {
          scaleX: 1,
          keyframes: [
            { frame: 0, scale: 1, opacity: 1, offsetX: 0 },
            { frame: 30, scale: 1.4, opacity: 0.6, offsetX: 80 },
            { frame: 89, scale: 2, opacity: 1, offsetX: 0 },
          ],
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rechaza frames desordenados, duplicados o fuera del clip', () => {
    const unsorted = imageClip({
      transform: { keyframes: [{ frame: 20, scale: 1.2 }, { frame: 10, scale: 1 }] },
    });
    expect(ClipSchema.safeParse(unsorted).success).toBe(false);

    const duplicate = imageClip({
      transform: { keyframes: [{ frame: 10, scale: 1.2 }, { frame: 10, opacity: 0.5 }] },
    });
    expect(ClipSchema.safeParse(duplicate).success).toBe(false);

    const outside = imageClip({
      transform: { keyframes: [{ frame: 90, scale: 1.2 }] },
    });
    expect(ClipSchema.safeParse(outside).success).toBe(false);
  });

  it('rechaza una clave vacía, escala fuera de rango y claves desconocidas', () => {
    const empty = imageClip({ transform: { keyframes: [{ frame: 0 }] } });
    expect(ClipSchema.safeParse(empty).success).toBe(false);

    const small = imageClip({ transform: { keyframes: [{ frame: 0, scale: 0.2 }] } });
    expect(ClipSchema.safeParse(small).success).toBe(false);

    const unknown = imageClip({
      transform: { keyframes: [{ frame: 0, scale: 1, wobble: true }] },
    });
    expect(ClipSchema.safeParse(unknown).success).toBe(false);
  });

  it('no permite animar la transformación de un clip de audio', () => {
    const audio = {
      ...videoClip(),
      kind: 'audio',
      transform: { keyframes: [{ frame: 0, opacity: 0.5 }] },
    };
    expect(ClipSchema.safeParse(audio).success).toBe(false);
  });

  it('limita la cantidad de claves para acotar la expresión de FFmpeg', () => {
    const keyframes = Array.from({ length: 49 }, (_, frame) => ({ frame, scale: 1 }));
    const parsed = ClipSchema.safeParse(imageClip({ transform: { keyframes } }));
    expect(parsed.success).toBe(false);
  });
});

describe('keyframes de ganancia', () => {
  it('acepta automatización de volumen en video y audio', () => {
    const parsed = ClipSchema.safeParse(
      videoClip({
        audio: { gainKeyframes: [{ frame: 0, gainDb: 0 }, { frame: 89, gainDb: -18 }] },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rechaza automatización en imágenes y frames fuera del clip', () => {
    expect(
      ClipSchema.safeParse(
        imageClip({ audio: { gainKeyframes: [{ frame: 0, gainDb: 0 }] } }),
      ).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse(
        videoClip({ audio: { gainKeyframes: [{ frame: 120, gainDb: 0 }] } }),
      ).success,
    ).toBe(false);
  });
});

describe('muestreo lineal', () => {
  const keyframes = [
    { frame: 0, scale: 1, opacity: 1, rotationDeg: 0 },
    { frame: 40, scale: 2, opacity: 0.5, rotationDeg: 40 },
    { frame: 80, scale: 1.2, rotationDeg: 90 },
  ];

  it('mantiene la primera y la última muestra fuera del rango', () => {
    expect(sampleTransformKeyframes(keyframes, -10)).toEqual({
      scale: 1,
      opacity: 1,
      rotationDeg: 0,
    });
    expect(sampleTransformKeyframes(keyframes, 200)).toEqual({
      scale: 1.2,
      opacity: 0.5,
      rotationDeg: 90,
    });
  });

  it('interpola linealmente cada propiedad por separado', () => {
    expect(sampleTransformKeyframes(keyframes, 20).scale).toBeCloseTo(1.5);
    expect(sampleTransformKeyframes(keyframes, 20).opacity).toBeCloseTo(0.75);
    expect(sampleTransformKeyframes(keyframes, 60).scale).toBeCloseTo(1.6);
    expect(sampleTransformKeyframes(keyframes, 60).rotationDeg).toBeCloseTo(65);
  });

  it('ignora claves que no declaran la propiedad al interpolar', () => {
    const sparse = [
      { frame: 0, scale: 1 },
      { frame: 10, opacity: 0.5 },
      { frame: 20, scale: 2 },
    ];
    expect(sampleTransformKeyframes(sparse, 5).scale).toBeCloseTo(1.25);
    expect(sampleTransformKeyframes(sparse, 15).scale).toBeCloseTo(1.75);
    expect(sampleTransformKeyframes(sparse, 5).opacity).toBe(0.5);
  });

  it('detecta si hay geometría animada', () => {
    expect(hasGeometryKeyframes([{ frame: 0, opacity: 0.5 }])).toBe(false);
    expect(hasGeometryKeyframes([{ frame: 0, offsetX: 10 }])).toBe(true);
    expect(hasGeometryKeyframes([{ frame: 0, scale: 1.1 }])).toBe(true);
  });

  it('muestrea ganancia y la mantiene en los extremos', () => {
    const gain = [
      { frame: 0, gainDb: 0 },
      { frame: 30, gainDb: -12 },
    ];
    expect(sampleGainKeyframes(gain, 0)).toBe(0);
    expect(sampleGainKeyframes(gain, 15)).toBe(-6);
    expect(sampleGainKeyframes(gain, 100)).toBe(-12);
    expect(sampleGainKeyframes([], 10)).toBeUndefined();
  });

  it('clampa el playhead al interior del clip', () => {
    expect(keyframeFrameAt(0, 120, 90)).toBe(0);
    expect(keyframeFrameAt(120, 120, 90)).toBe(0);
    expect(keyframeFrameAt(170, 120, 90)).toBe(50);
    expect(keyframeFrameAt(999, 120, 90)).toBe(89);
  });
});
