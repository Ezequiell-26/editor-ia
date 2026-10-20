import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function audioClip(audio: unknown) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'audio',
    source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
    startFrame: 0,
    durationFrames: 90,
    audio,
  };
}

function imageClip(chromaKey: unknown) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'image',
    source: { type: 'asset', assetId: ASSET },
    startFrame: 0,
    durationFrames: 90,
    chromaKey,
  };
}

describe('suite de audio del clip', () => {
  it('acepta filtros, EQ, compresor y reducción de ruido en rango', () => {
    const parsed = ClipSchema.safeParse(
      audioClip({
        gainDb: -3,
        highPassHz: 80,
        lowPassHz: 12_000,
        eqLowDb: -2,
        eqMidDb: 3,
        eqHighDb: 2,
        compressor: true,
        denoise: 0.2,
        fadeInFrames: 8,
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rechaza valores fuera de rango y claves desconocidas', () => {
    expect(ClipSchema.safeParse(audioClip({ highPassHz: 5 })).success).toBe(false);
    expect(ClipSchema.safeParse(audioClip({ lowPassHz: 30_000 })).success).toBe(false);
    expect(ClipSchema.safeParse(audioClip({ eqMidDb: 30 })).success).toBe(false);
    expect(ClipSchema.safeParse(audioClip({ denoise: 2 })).success).toBe(false);
    expect(ClipSchema.safeParse(audioClip({ reverb: true })).success).toBe(false);
  });
});

describe('chroma key', () => {
  it('acepta clave de color, similitud y mezcla', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({ color: '#00ff00', similarity: 0.3, blend: 0.1 }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rechaza colores inválidos y valores fuera de rango', () => {
    expect(ClipSchema.safeParse(imageClip({ color: 'green', similarity: 0.3, blend: 0.1 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ color: '#00ff00', similarity: 2, blend: 0.1 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ color: '#00ff00', similarity: 0.3, blend: 2 })).success).toBe(false);
  });

  it('no se admite chroma key en audio', () => {
    const clip = audioClip({});
    expect(ClipSchema.safeParse({ ...clip, chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }).success).toBe(false);
  });
});
