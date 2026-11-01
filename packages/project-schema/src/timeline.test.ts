import { describe, expect, it } from 'vitest';
import { ClipSchema, ClipTransitionSchema, TimelineSchema, TrackSchema } from './timeline.ts';
import { sampleEffectKeyframes } from './effect-keyframes.ts';

const TRACK_VIDEO = '11111111-1111-4111-8111-111111111111';
const TRACK_AUDIO = '22222222-2222-4222-8222-222222222222';
const CLIP_A = '33333333-3333-4333-8333-333333333333';
const CLIP_B = '44444444-4444-4444-8444-444444444444';
const ASSET = '55555555-5555-4555-8555-555555555555';
const MOTION = '66666666-6666-4666-8666-666666666666';

function videoTrack(overrides: Record<string, unknown> = {}) {
  return { id: TRACK_VIDEO, kind: 'video', label: 'V1', order: 0, ...overrides };
}

function videoClip(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIP_A,
    trackId: TRACK_VIDEO,
    kind: 'video',
    startFrame: 0,
    durationFrames: 90,
    source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
    ...overrides,
  };
}

function timeline(tracks: unknown[], clips: unknown[]) {
  return TimelineSchema.safeParse({ tracks, clips });
}

describe('TrackSchema', () => {
  it('accepts a minimal track definition', () => {
    expect(TrackSchema.safeParse(videoTrack()).success).toBe(true);
  });

  it('defaults the visibility flags to false so files stay small', () => {
    const parsed = TrackSchema.parse(videoTrack());
    expect(parsed.muted).toBe(false);
    expect(parsed.hidden).toBe(false);
    expect(parsed.locked).toBe(false);
  });

  it('accepts a caption track', () => {
    expect(
      TrackSchema.safeParse(
        videoTrack({ id: TRACK_AUDIO, kind: 'caption', label: 'C1', order: 1 })
      ).success,
    ).toBe(true);
  });

  it('rejects an unknown track kind', () => {
    expect(TrackSchema.safeParse(videoTrack({ kind: 'cloud' })).success).toBe(false);
  });

  it('rejects a negative layer order', () => {
    expect(TrackSchema.safeParse(videoTrack({ order: -1 })).success).toBe(false);
  });

  it('rejects an unknown track key', () => {
    expect(TrackSchema.safeParse(videoTrack({ volume: 1 })).success).toBe(false);
  });

  it('acepta ganancia y solo por pista', () => {
    const parsed = TrackSchema.safeParse(videoTrack({ gainDb: -6.5, solo: true }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gainDb).toBe(-6.5);
      expect(parsed.data.solo).toBe(true);
    }
  });

  it('acepta paneo y EQ de 3 bandas por pista', () => {
    const parsed = TrackSchema.safeParse(
      videoTrack({ pan: -0.4, eqLowDb: 3.5, eqMidDb: -2, eqHighDb: 6 }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pan).toBe(-0.4);
      expect(parsed.data.eqLowDb).toBe(3.5);
      expect(parsed.data.eqMidDb).toBe(-2);
      expect(parsed.data.eqHighDb).toBe(6);
    }
  });

  it('rechaza paneo y EQ fuera de rango', () => {
    expect(TrackSchema.safeParse(videoTrack({ pan: 1.2 })).success).toBe(false);
    expect(TrackSchema.safeParse(videoTrack({ pan: -1.2 })).success).toBe(false);
    expect(TrackSchema.safeParse(videoTrack({ eqLowDb: -18 })).success).toBe(false);
    expect(TrackSchema.safeParse(videoTrack({ eqHighDb: 13 })).success).toBe(false);
  });

  it('rechaza una ganancia de pista fuera del rango de audio', () => {
    expect(TrackSchema.safeParse(videoTrack({ gainDb: 18 })).success).toBe(false);
  });

  it('acepta keyframes de fader y paneo de pista con easing y bezier', () => {
    const parsed = TrackSchema.safeParse(
      videoTrack({
        gainKeyframes: [
          { frame: 0, gainDb: -6, easing: 'ease-in' },
          { frame: 30, gainDb: 0, bezier: { cp1X: 0.2, cp1Y: 0, cp2X: 0.8, cp2Y: 1 } },
        ],
        panKeyframes: [
          { frame: 0, value: -1 },
          { frame: 60, value: 1, easing: 'hold' },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gainKeyframes?.length).toBe(2);
      expect(parsed.data.panKeyframes?.length).toBe(2);
    }
  });

  it('rechaza keyframes de pista con frames repetidos o desordenados', () => {
    expect(
      TrackSchema.safeParse(
        videoTrack({
          gainKeyframes: [
            { frame: 30, gainDb: -6 },
            { frame: 0, gainDb: 0 },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      TrackSchema.safeParse(
        videoTrack({
          panKeyframes: [
            { frame: 10, value: 0 },
            { frame: 10, value: 0.5 },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rechaza keyframes de pista con frame negativo o lista vacía', () => {
    expect(
      TrackSchema.safeParse(videoTrack({ gainKeyframes: [{ frame: -1, gainDb: 0 }] })).success,
    ).toBe(false);
    expect(TrackSchema.safeParse(videoTrack({ panKeyframes: [] })).success).toBe(false);
  });

  it('rechaza valores fuera del rango del fader y del paneo en las claves de pista', () => {
    expect(
      TrackSchema.safeParse(videoTrack({ gainKeyframes: [{ frame: 0, gainDb: 13 }] })).success,
    ).toBe(false);
    expect(
      TrackSchema.safeParse(videoTrack({ gainKeyframes: [{ frame: 0, gainDb: -61 }] })).success,
    ).toBe(false);
    expect(
      TrackSchema.safeParse(videoTrack({ panKeyframes: [{ frame: 0, value: 1.2 }] })).success,
    ).toBe(false);
  });

  it('rechaza una clave de pista con propiedades desconocidas', () => {
    expect(
      TrackSchema.safeParse(
        videoTrack({ gainKeyframes: [{ frame: 0, gainDb: 0, scale: 1 }] }),
      ).success,
    ).toBe(false);
    expect(
      TrackSchema.safeParse(videoTrack({ panKeyframes: [{ frame: 0, pan: 0.5 }] })).success,
    ).toBe(false);
  });
});

describe('adjustment layers', () => {
  const ADJUSTMENT_TRACK = '77777777-7777-4777-8777-777777777777';
  const adjustmentTrack = {
    id: ADJUSTMENT_TRACK,
    kind: 'adjustment',
    label: 'Ajustes',
    order: 2,
  };
  const adjustmentClip = {
    id: CLIP_B,
    trackId: ADJUSTMENT_TRACK,
    kind: 'adjustment',
    label: 'Capa de ajuste',
    startFrame: 15,
    durationFrames: 60,
    source: { type: 'adjustment' },
    effects: { saturation: 1.1 },
  };

  it('accepts an adjustment clip on its own track', () => {
    expect(TimelineSchema.safeParse({ tracks: [adjustmentTrack], clips: [adjustmentClip] }).success).toBe(true);
  });

  it('rejects an adjustment clip on a video track', () => {
    expect(
      TimelineSchema.safeParse({ tracks: [videoTrack()], clips: [adjustmentClip] }).success,
    ).toBe(false);
  });

  it('rejects overlapping adjustment clips on the same track', () => {
    expect(
      TimelineSchema.safeParse({
        tracks: [adjustmentTrack],
        clips: [
          adjustmentClip,
          { ...adjustmentClip, id: CLIP_A, startFrame: 30 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('freeze clips', () => {
  const IMAGE_TRACK = '88888888-8888-4888-8888-888888888888';
  const freezeClip = {
    id: CLIP_B,
    trackId: TRACK_VIDEO,
    kind: 'freeze',
    label: 'Congelado',
    startFrame: 30,
    durationFrames: 60,
    source: { type: 'asset', assetId: ASSET },
    effects: { saturation: 1.05 },
    blendMode: 'screen',
  };

  it('accepts a freeze clip on a video track', () => {
    expect(
      TimelineSchema.safeParse({ tracks: [videoTrack()], clips: [freezeClip] }).success,
    ).toBe(true);
  });

  it('rejects a freeze clip on an image track', () => {
    expect(
      TimelineSchema.safeParse({
        tracks: [
          videoTrack({ id: IMAGE_TRACK, kind: 'image', label: 'I1' }),
        ],
        clips: [{ ...freezeClip, trackId: IMAGE_TRACK }],
      }).success,
    ).toBe(false);
  });

  it('rejects a freeze clip with a windowed source', () => {
    expect(
      ClipSchema.safeParse({
        ...freezeClip,
        source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 30 },
      }).success,
    ).toBe(false);
  });

  it('rejects a freeze clip with speed', () => {
    expect(
      ClipSchema.safeParse({ ...freezeClip, speed: { num: 2, den: 1 } }).success,
    ).toBe(false);
  });
});

describe('ClipSchema', () => {
  it('accepts a video clip whose duration matches its source window', () => {
    expect(ClipSchema.safeParse(videoClip()).success).toBe(true);
  });

  it('accepts an enabled flag and rejects a non-boolean one', () => {
    expect(ClipSchema.safeParse(videoClip({ enabled: false })).success).toBe(true);
    expect(ClipSchema.safeParse(videoClip({ enabled: 'no' })).success).toBe(false);
  });

  it('accepts a clip color tag and rejects an unknown one', () => {    expect(ClipSchema.safeParse(videoClip({ colorTag: 'teal' })).success).toBe(true);
    expect(ClipSchema.safeParse(videoClip({ colorTag: 'neon' })).success).toBe(false);
  });

  it('accepts a per-clip audio mute and rejects a non-boolean', () => {
    expect(ClipSchema.safeParse(videoClip({ audio: { muted: true } })).success).toBe(true);
    expect(ClipSchema.safeParse(videoClip({ audio: { muted: 'yes' } })).success).toBe(false);
  });

  it('accepts a LUT intensity between 0 and 1 and rejects values outside', () => {
    expect(
      ClipSchema.safeParse(videoClip({ effects: { lutFile: 'media/luts/x.cube', lutIntensity: 0.4 } }))
        .success,
    ).toBe(true);
    expect(
      ClipSchema.safeParse(videoClip({ effects: { lutFile: 'media/luts/x.cube', lutIntensity: 1.5 } }))
        .success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse(videoClip({ effects: { lutFile: 'media/luts/x.cube', lutIntensity: -0.1 } }))
        .success,
    ).toBe(false);
  });

  it('rejects a video clip whose duration disagrees with its source window', () => {
    expect(ClipSchema.safeParse(videoClip({ durationFrames: 89 })).success).toBe(false);
  });

  it('rejects an empty source window', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({ source: { type: 'asset', assetId: ASSET, inFrame: 30, outFrame: 30 } }),
      ).success,
    ).toBe(false);
  });

  it('rejects a source window that ends before it starts', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 30,
          source: { type: 'asset', assetId: ASSET, inFrame: 60, outFrame: 30 },
        }),
      ).success,
    ).toBe(false);
  });

  it('scales the timeline duration by the clip speed', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 45,
          speed: { num: 2, den: 1 },
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a speed that does not divide the source window into whole frames', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 45,
          speed: { num: 3, den: 2 },
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
        }),
      ).success,
    ).toBe(false);
  });

  it('acepta una curva de velocidad aunque la ventana no tenga velocidad constante', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 100,
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 88 },
          speedCurve: {
            points: [
              { t: 0, speed: 0.5 },
              { t: 0.5, speed: 0.5 },
              { t: 1, speed: 2 },
            ],
          },
        }),
      ).success,
    ).toBe(true);
  });

  it('rechaza una curva combinada con reverse', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 100,
          reverse: true,
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 88 },
          speedCurve: {
            points: [
              { t: 0, speed: 0.5 },
              { t: 1, speed: 2 },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('sigue rechazando velocidad constante y curva en el mismo clip', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          durationFrames: 100,
          speed: { num: 1, den: 1 },
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 88 },
          speedCurve: {
            points: [
              { t: 0, speed: 0.5 },
              { t: 1, speed: 2 },
            ],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts an image clip held for a duration with no source window', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({ kind: 'image', source: { type: 'asset', assetId: ASSET } }),
      ).success,
    ).toBe(true);
  });

  it('rejects a source window on an image clip', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          kind: 'image',
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts a graphic clip that references a motion item', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({ kind: 'graphic', source: { type: 'graphic', motionId: MOTION } }),
      ).success,
    ).toBe(true);
  });

  it('rejects an asset reference on a graphic clip', () => {
    expect(
      ClipSchema.safeParse(videoClip({ kind: 'graphic' })).success,
    ).toBe(false);
  });

  it('accepts a source-less adjustment clip with a grade', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          kind: 'adjustment',
          source: { type: 'adjustment' },
          effects: { contrast: 1.2, curvePreset: 'vintage' },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects an adjustment clip that carries media', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          kind: 'adjustment',
          source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown clip kind', () => {
    expect(ClipSchema.safeParse(videoClip({ kind: 'exe' })).success).toBe(false);
  });

  it('rejects an unknown clip key', () => {
    expect(ClipSchema.safeParse(videoClip({ renderCommand: 'ffmpeg -i x' })).success).toBe(false);
  });

  it('rejects a transform opacity outside the unit interval', () => {
    expect(ClipSchema.safeParse(videoClip({ transform: { opacity: 1.4 } })).success).toBe(false);
  });

  it('accepts a transform with an offset and an opacity', () => {
    expect(
      ClipSchema.safeParse(
        videoClip({
          transform: {
            offsetX: 12,
            offsetY: -4,
            scaleX: 1.2,
            scaleY: 1.2,
            rotationDeg: 90,
            opacity: 0.8,
            flipH: true,
            flipV: false,
          },
        }),
      ).success,
    ).toBe(true);
  });
});

describe('TimelineSchema', () => {
  it('accepts one track with one clip on it', () => {
    expect(timeline([videoTrack()], [videoClip()]).success).toBe(true);
  });

  it('rejects duplicate track ids', () => {
    expect(timeline([videoTrack(), videoTrack()], []).success).toBe(false);
  });

  it('rejects duplicate clip ids', () => {
    expect(timeline([videoTrack()], [videoClip(), videoClip()]).success).toBe(false);
  });

  it('rejects a clip that points at a track that does not exist', () => {
    expect(timeline([videoTrack()], [videoClip({ trackId: TRACK_AUDIO })]).success).toBe(false);
  });

  it('rejects a video clip placed on an audio track', () => {
    const audioTrack = videoTrack({ id: TRACK_AUDIO, kind: 'audio' });
    expect(timeline([audioTrack], [videoClip({ trackId: TRACK_AUDIO })]).success).toBe(false);
  });

  it('accepts an audio clip on a narration track', () => {
    const narration = videoTrack({ id: TRACK_AUDIO, kind: 'narration', label: 'N1' });
    const clip = videoClip({
      trackId: TRACK_AUDIO,
      kind: 'audio',
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
    });
    expect(timeline([narration], [clip]).success).toBe(true);
  });

  it('rejects two clips that overlap on the same track', () => {
    const second = videoClip({ id: CLIP_B, startFrame: 89, durationFrames: 10 });
    expect(timeline([videoTrack()], [videoClip(), second]).success).toBe(false);
  });

  it('accepts two clips that touch exactly at the boundary', () => {
    const second = videoClip({
      id: CLIP_B,
      startFrame: 90,
      durationFrames: 30,
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 30 },
    });
    expect(timeline([videoTrack()], [videoClip(), second]).success).toBe(true);
  });

  it('accepts clips that overlap across different tracks', () => {
    const audioTrack = videoTrack({ id: TRACK_AUDIO, kind: 'audio', order: 1 });
    const clip = videoClip({
      id: CLIP_B,
      trackId: TRACK_AUDIO,
      kind: 'audio',
      startFrame: 10,
      durationFrames: 30,
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 30 },
    });
    expect(timeline([videoTrack(), audioTrack], [videoClip(), clip]).success).toBe(true);
  });

  it('rejects duplicate layer orders', () => {
    const second = videoTrack({ id: TRACK_AUDIO, kind: 'audio' });
    expect(timeline([videoTrack(), second], []).success).toBe(false);
  });
});

describe('ClipEffectKeyframes', () => {
  it('acepta keyframes de brillo/contraste/saturación dentro del clip', () => {
    const clip = videoClip({
      effectKeyframes: [
        { frame: 10, property: 'brightness', value: 0.4, easing: 'ease-in' },
        { frame: 40, property: 'brightness', value: -0.2 },
        { frame: 40, property: 'contrast', value: 1.4 },
        { frame: 20, property: 'blur', value: 6 },
        { frame: 25, property: 'hueRotateDeg', value: 45 },
        { frame: 30, property: 'lutIntensity', value: 0.5 },
        { frame: 35, property: 'glowIntensity', value: 0.7 },
        { frame: 40, property: 'grain', value: 0.4 },
      ],
    });
    expect(timeline([videoTrack()], [clip]).success).toBe(true);
  });

  it('rechaza frames fuera del clip, valores fuera de rango y propiedades desconocidas', () => {
    const late = videoClip({
      effectKeyframes: [{ frame: 500, property: 'brightness', value: 0.4 }],
    });
    expect(timeline([videoTrack()], [late]).success).toBe(false);
    const high = videoClip({
      effectKeyframes: [{ frame: 10, property: 'blur', value: 90 }],
    });
    expect(timeline([videoTrack()], [high]).success).toBe(false);
    const unknown = videoClip({
      effectKeyframes: [{ frame: 10, property: 'glow', value: 1 }],
    });
    expect(timeline([videoTrack()], [unknown]).success).toBe(false);
    const lutOutOfRange = videoClip({
      effectKeyframes: [{ frame: 10, property: 'lutIntensity', value: 1.5 }],
    });
    expect(timeline([videoTrack()], [lutOutOfRange]).success).toBe(false);
    const glowOutOfRange = videoClip({
      effectKeyframes: [{ frame: 10, property: 'glowIntensity', value: -0.1 }],
    });
    expect(timeline([videoTrack()], [glowOutOfRange]).success).toBe(false);
    const grainOutOfRange = videoClip({
      effectKeyframes: [{ frame: 10, property: 'grain', value: 1.5 }],
    });
    expect(timeline([videoTrack()], [grainOutOfRange]).success).toBe(false);
  });

  it('muestrea con clamp, interpolación y hold', () => {
    const keyframes = [
      { frame: 0, property: 'brightness' as const, value: 0, easing: 'linear' as const },
      { frame: 10, property: 'brightness' as const, value: 1, easing: 'linear' as const },
      { frame: 20, property: 'brightness' as const, value: 0.2, easing: 'hold' as const },
      { frame: 30, property: 'brightness' as const, value: 0.8 },
    ];
    expect(sampleEffectKeyframes(keyframes, -5)).toEqual({ brightness: 0 });
    expect(sampleEffectKeyframes(keyframes, 5)).toEqual({ brightness: 0.5 });
    expect(sampleEffectKeyframes(keyframes, 10)).toEqual({ brightness: 1 });
    expect(sampleEffectKeyframes(keyframes, 15)).toEqual({ brightness: 0.6 });
    expect(sampleEffectKeyframes(keyframes, 25)).toEqual({ brightness: 0.2 });
    expect(sampleEffectKeyframes(keyframes, 20)).toEqual({ brightness: 0.2 });
    expect(sampleEffectKeyframes(keyframes, 99)).toEqual({ brightness: 0.8 });
    expect(sampleEffectKeyframes([], 4)).toEqual({});
    expect(
      sampleEffectKeyframes(
        [
          { frame: 0, property: 'blur' as const, value: 0 },
          { frame: 10, property: 'blur' as const, value: 10 },
        ],
        5,
      ),
    ).toEqual({ blur: 5 });
  });
});

describe('ClipTransitionSchema', () => {
  it('accepts the four professional wipes and the iris reveal', () => {
    for (const type of ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'iris'] as const) {
      expect(ClipTransitionSchema.safeParse({ type, frames: 12 }).success).toBe(true);
      expect(
        ClipTransitionSchema.safeParse({ type, frames: 12, easing: 'ease-in' }).success,
      ).toBe(true);
    }
  });

  it('keeps rejecting unknown transitions and frames above the cap', () => {
    expect(ClipTransitionSchema.safeParse({ type: 'burn', frames: 12 }).success).toBe(false);
    expect(ClipTransitionSchema.safeParse({ type: 'wipe-left', frames: 121 }).success).toBe(false);
    expect(
      ClipTransitionSchema.safeParse({ type: 'wipe-left', frames: 12, easing: 'bounce' })
        .success,
    ).toBe(false);
    expect(
      ClipTransitionSchema.safeParse({
        type: 'fade-black',
        frames: 12,
        easing: 'ease-in',
      }).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse(
        videoClip({
          effectKeyframes: [{ frame: 5, property: 'hueRotateDeg', value: 200 }],
        }),
      ).success,
    ).toBe(false);
  });
});
