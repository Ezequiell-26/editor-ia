import { describe, expect, it } from 'vitest';
import { ClipSchema, ClipStabilizationSchema } from './timeline.ts';

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

function stabilization(extra: Record<string, unknown> = {}) {
  return {
    smoothing: 10,
    transformFile: 'media/stabilizers/abc.trf',
    inFrame: 0,
    outFrame: 90,
    ...extra,
  };
}

describe('estabilización de video', () => {
  it('acepta una ventana analizada dentro del clip', () => {
    const parsed = ClipSchema.safeParse(
      videoClip({ stabilization: stabilization() }),
    );
    expect(parsed.success).toBe(true);
  });

  it('exige un suavizado entero entre 1 y 60', () => {
    for (const smoothing of [0, 61, 1.5, -3]) {
      const parsed = ClipSchema.safeParse(
        videoClip({ stabilization: stabilization({ smoothing }) }),
      );
      expect(parsed.success, `suavizado ${smoothing}`).toBe(false);
    }
    expect(ClipStabilizationSchema.safeParse(stabilization({ smoothing: 1 })).success).toBe(
      true,
    );
    expect(ClipStabilizationSchema.safeParse(stabilization({ smoothing: 60 })).success).toBe(
      true,
    );
  });

  it('exige un archivo de transformación no vacío', () => {
    for (const transformFile of ['', 'x'.repeat(501)]) {
      const parsed = ClipStabilizationSchema.safeParse(
        stabilization({ transformFile }),
      );
      expect(parsed.success, transformFile.length ? 'ruta larga' : 'ruta vacía').toBe(
        false,
      );
    }
  });

  it('rechaza una ventana invertida o vacía', () => {
    const inverted = ClipStabilizationSchema.safeParse(
      stabilization({ inFrame: 30, outFrame: 30 }),
    );
    expect(inverted.success).toBe(false);
    const empty = ClipStabilizationSchema.safeParse(
      stabilization({ inFrame: 40, outFrame: 20 }),
    );
    expect(empty.success).toBe(false);
  });

  it('rechaza claves desconocidas y clips que no son video', () => {
    const unknown = ClipStabilizationSchema.safeParse(
      stabilization({ extra: true }),
    );
    expect(unknown.success).toBe(false);

    const image = ClipSchema.safeParse({
      id: ID,
      trackId: TRACK,
      kind: 'image',
      source: { type: 'asset', assetId: ASSET },
      startFrame: 0,
      durationFrames: 90,
      stabilization: stabilization(),
    });
    expect(image.success).toBe(false);
  });
});
