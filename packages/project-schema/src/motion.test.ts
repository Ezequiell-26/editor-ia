import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function imageClip(motion: unknown) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'image',
    source: { type: 'asset', assetId: ASSET },
    startFrame: 0,
    durationFrames: 90,
    motion,
  };
}

describe('movimiento de clip', () => {
  it('acepta un movimiento Ken Burns con intensidad dentro de rango', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({ type: 'zoom-in', intensity: 0.12 }),
    );
    expect(parsed.success).toBe(true);
  });

  it('acepta los seis presets sin intensidad explícita', () => {
    for (const type of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
      expect(ClipSchema.safeParse(imageClip({ type })).success).toBe(true);
    }
  });

  it('rechaza intensidades fuera de rango, presets desconocidos y claves extra', () => {
    expect(ClipSchema.safeParse(imageClip({ type: 'zoom-in', intensity: 0 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ type: 'zoom-in', intensity: 2 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ type: 'wobble' })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ type: 'zoom-in', speed: 2 })).success).toBe(false);
  });

  it('no permite movimiento en un clip de audio', () => {
    const audio = {
      id: ID,
      trackId: TRACK,
      kind: 'audio',
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
      startFrame: 0,
      durationFrames: 90,
      motion: { type: 'zoom-in' },
    };
    expect(ClipSchema.safeParse(audio).success).toBe(false);
  });
});
