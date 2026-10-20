import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.js';

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

describe('efectos de clip', () => {
  it('acepta ajustes de color y efectos dentro de rango', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({
        brightness: 0.2,
        contrast: 1.2,
        saturation: 1.1,
        temperature: -0.3,
        vignette: 0.4,
        sharpen: 1.5,
        blur: 2,
        grayscale: false,
        sepia: true,
        hueRotateDeg: 24,
        curvePreset: 'vintage',
        fadeInFrames: 10,
        fadeOutFrames: 15,
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rechaza valores fuera de rango y claves desconocidas', () => {
    expect(ClipSchema.safeParse(imageClip({ brightness: 2 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ contrast: -1 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ blur: -3 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ glow: 4 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ hueRotateDeg: 300 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ curvePreset: 'sepia' }))).toMatchObject({ success: false });
  });

  it('no permite efectos en un clip de audio', () => {
    const audio = {
      id: ID,
      trackId: TRACK,
      kind: 'audio',
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
      startFrame: 0,
      durationFrames: 90,
      effects: { brightness: 0.1 },
    };
    expect(ClipSchema.safeParse(audio).success).toBe(false);
  });
});
