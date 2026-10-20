import { z } from 'zod';
import { DecibelSchema, EntityIdSchema, UnitIntervalSchema } from './primitives.ts';
import { DurationSchema, FrameRateSchema, FrameSchema } from './time.ts';

/**
 * Tracks and clips: the editable timeline.
 *
 * Clips reference tracks and assets by id only. Timing is always integer
 * frames, and the relationship between a clip's source window, its speed and
 * its timeline duration is exact: `durationFrames x speed.num =
 * sourceFrames x speed.den`. A project that cannot state that equality is
 * malformed rather than approximated, because an approximated timeline drifts
 * once a renderer resamples it.
 */

export const TrackKindSchema = z.enum([
  'video',
  'image',
  'audio',
  'narration',
  'caption',
  'graphic',
]);

export const ClipKindSchema = z.enum(['video', 'image', 'audio', 'graphic']);

export const TrackSchema = z
  .object({
    id: EntityIdSchema,
    kind: TrackKindSchema,
    label: z.string().min(1).max(120),
    order: z.number().int().min(0).max(63),
    muted: z.boolean().default(false),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
  })
  .strict();

/** Hard caps keep the generated FFmpeg expressions inside a bounded argv. */
export const MAX_TRANSFORM_KEYFRAMES = 48;
export const MAX_GAIN_KEYFRAMES = 96;
export const TRANSFORM_KEYFRAME_SCALE_MIN = 0.5;
export const TRANSFORM_KEYFRAME_SCALE_MAX = 4;

/**
 * A transform keyframe is an absolute sample at `frame` frames from the clip
 * start. Properties absent from a keyframe fall back to the nearest keyframe
 * that defines them, then to the clip's static transform. `scale` is uniform:
 * the renderer animates it with zoompan, which cannot express a per-axis zoom.
 */
export const ClipTransformKeyframeSchema = z
  .object({
    frame: FrameSchema,
    offsetX: z.number().int().gte(-100_000).lte(100_000).optional(),
    offsetY: z.number().int().gte(-100_000).lte(100_000).optional(),
    scale: z
      .number()
      .gte(TRANSFORM_KEYFRAME_SCALE_MIN)
      .lte(TRANSFORM_KEYFRAME_SCALE_MAX)
      .optional(),
    rotationDeg: z.number().gte(-360).lte(360).optional(),
    opacity: UnitIntervalSchema.optional(),
  })
  .strict()
  .superRefine((keyframe, ctx) => {
    if (
      keyframe.offsetX === undefined &&
      keyframe.offsetY === undefined &&
      keyframe.scale === undefined &&
      keyframe.rotationDeg === undefined &&
      keyframe.opacity === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a transform keyframe must animate at least one property',
      });
    }
  });

export const ClipGainKeyframeSchema = z
  .object({
    frame: FrameSchema,
    gainDb: DecibelSchema,
  })
  .strict();

export const ClipTransformSchema = z
  .object({
    offsetX: z.number().int().gte(-100_000).lte(100_000).optional(),
    offsetY: z.number().int().gte(-100_000).lte(100_000).optional(),
    scaleX: z.number().gt(0).lte(100).optional(),
    scaleY: z.number().gt(0).lte(100).optional(),
    rotationDeg: z.number().gte(-360).lte(360).optional(),
    opacity: UnitIntervalSchema.optional(),
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
    keyframes: z.array(ClipTransformKeyframeSchema).min(1).max(MAX_TRANSFORM_KEYFRAMES).optional(),
  })
  .strict();

export const ClipAudioSchema = z
  .object({
    gainDb: DecibelSchema.optional(),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
    highPassHz: z.number().gte(20).lte(2_000).optional(),
    lowPassHz: z.number().gte(1_000).lte(20_000).optional(),
    eqLowDb: z.number().gte(-12).lte(12).optional(),
    eqMidDb: z.number().gte(-12).lte(12).optional(),
    eqHighDb: z.number().gte(-12).lte(12).optional(),
    compressor: z.boolean().optional(),
    deesser: z.boolean().optional(),
    gateDb: z.number().gte(-60).lte(-10).optional(),
    denoise: z.number().gte(0).lte(1).optional(),
    gainKeyframes: z.array(ClipGainKeyframeSchema).min(1).max(MAX_GAIN_KEYFRAMES).optional(),
  })
  .strict();

const WindowedAssetSourceSchema = z
  .object({
    type: z.literal('asset'),
    assetId: EntityIdSchema,
    inFrame: FrameSchema,
    outFrame: FrameSchema,
  })
  .strict();

const StillAssetSourceSchema = z
  .object({
    type: z.literal('asset'),
    assetId: EntityIdSchema,
  })
  .strict();

const GraphicSourceSchema = z
  .object({
    type: z.literal('graphic'),
    motionId: EntityIdSchema,
  })
  .strict();

export const ClipEffectsSchema = z
  .object({
    brightness: z.number().gte(-1).lte(1).optional(),
    contrast: z.number().gte(0).lte(3).optional(),
    saturation: z.number().gte(0).lte(3).optional(),
    temperature: z.number().gte(-1).lte(1).optional(),
    vignette: z.number().gte(0).lte(1).optional(),
    sharpen: z.number().gte(0).lte(5).optional(),
    blur: z.number().gte(0).lte(50).optional(),
    grayscale: z.boolean().optional(),
    sepia: z.boolean().optional(),
    hueRotateDeg: z.number().gte(-180).lte(180).optional(),
    curvePreset: z
      .enum([
        'contrast-soft',
        'contrast-medium',
        'contrast-strong',
        'vintage',
        'cross-process',
        'darker',
        'lighter',
      ])
      .optional(),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
  })
  .strict();

export const ClipMotionSchema = z
  .object({
    type: z.enum(['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']),
    intensity: z.number().gte(0.02).lte(0.5).optional(),
  })
  .strict();

export const ChromaKeySchema = z
  .object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    similarity: z.number().gte(0.01).lte(1),
    blend: z.number().gte(0).lte(1),
  })
  .strict();

const clipCommon = {
  id: EntityIdSchema,
  trackId: EntityIdSchema,
  label: z.string().min(1).max(200).optional(),
  startFrame: FrameSchema,
  durationFrames: DurationSchema,
  transform: ClipTransformSchema.optional(),
  audio: ClipAudioSchema.optional(),
};

const VideoClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('video'),
    source: WindowedAssetSourceSchema,
    speed: FrameRateSchema.optional(),
    effects: ClipEffectsSchema.optional(),
    motion: ClipMotionSchema.optional(),
    chromaKey: ChromaKeySchema.optional(),
  })
  .strict();

const AudioClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('audio'),
    source: WindowedAssetSourceSchema,
    speed: FrameRateSchema.optional(),
  })
  .strict();

const ImageIconSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('image'),
    source: StillAssetSourceSchema,
    effects: ClipEffectsSchema.optional(),
    motion: ClipMotionSchema.optional(),
    chromaKey: ChromaKeySchema.optional(),
  })
  .strict();

const GraphicClipSchema = z
  .object({ ...clipCommon, kind: z.literal('graphic'), source: GraphicSourceSchema })
  .strict();

/** Which track kinds are allowed to host each clip kind. */
const TRACK_KINDS_FOR_CLIP: Record<z.infer<typeof ClipKindSchema>, readonly string[]> = {
  video: ['video'],
  image: ['image'],
  audio: ['audio', 'narration'],
  graphic: ['graphic'],
};

export const ClipSchema = z
  .discriminatedUnion('kind', [
    VideoClipSchema,
    AudioClipSchema,
    ImageIconSchema,
    GraphicClipSchema,
  ])
  .superRefine((clip, ctx) => {
    if (clip.kind === 'video' || clip.kind === 'audio') {
      const sourceFrames = clip.source.outFrame - clip.source.inFrame;
      if (sourceFrames <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source', 'outFrame'],
          message: 'a clip source window must end after it starts',
        });
      } else {
        const speed = clip.speed ?? { num: 1, den: 1 };
        if (clip.durationFrames * speed.num !== sourceFrames * speed.den) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['durationFrames'],
            message:
              'the clip duration must match its source window divided by its speed, in whole frames',
          });
        }
      }
    }

    const transformKeyframes = clip.transform?.keyframes;
    if (transformKeyframes !== undefined) {
      if (clip.kind !== 'video' && clip.kind !== 'image') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transform', 'keyframes'],
          message: 'only video and image clips can animate their transform',
        });
      }
      let previous = -1;
      for (const [index, keyframe] of transformKeyframes.entries()) {
        if (keyframe.frame >= clip.durationFrames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transform', 'keyframes', index, 'frame'],
            message: 'a keyframe must fall inside the clip duration',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transform', 'keyframes', index, 'frame'],
            message: 'keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }

    const gainKeyframes = clip.audio?.gainKeyframes;
    if (gainKeyframes !== undefined) {
      if (clip.kind !== 'video' && clip.kind !== 'audio') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audio', 'gainKeyframes'],
          message: 'only clips with audio can automate their gain',
        });
      }
      let previous = -1;
      for (const [index, keyframe] of gainKeyframes.entries()) {
        if (keyframe.frame >= clip.durationFrames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audio', 'gainKeyframes', index, 'frame'],
            message: 'a keyframe must fall inside the clip duration',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audio', 'gainKeyframes', index, 'frame'],
            message: 'keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }
  });

export const TimelineSchema = z
  .object({
    tracks: z.array(TrackSchema),
    clips: z.array(ClipSchema),
  })
  .strict()
  .superRefine((timeline, ctx) => {
    const trackById = new Map<string, z.infer<typeof TrackSchema>>();

    for (const [index, track] of timeline.tracks.entries()) {
      const existing = trackById.get(track.id);
      if (existing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', index, 'id'],
          message: 'track ids must be unique inside a project',
        });
        continue;
      }
      trackById.set(track.id, track);
    }

    const orders = new Map<number, string>();
    for (const [index, track] of timeline.tracks.entries()) {
      const holder = orders.get(track.order);
      if (holder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', index, 'order'],
          message: `layer order ${track.order} is already used by track ${holder}`,
        });
      }
      orders.set(track.order, track.id);
    }

    const clipIds = new Set<string>();
    const intervalsByTrack = new Map<string, { start: number; end: number; id: string }[]>();

    for (const [index, clip] of timeline.clips.entries()) {
      if (clipIds.has(clip.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'id'],
          message: 'clip ids must be unique inside a project',
        });
      }
      clipIds.add(clip.id);

      const track = trackById.get(clip.trackId);
      if (!track) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'trackId'],
          message: 'the clip references a track that is not part of the project',
        });
        continue;
      }

      if (!TRACK_KINDS_FOR_CLIP[clip.kind].includes(track.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'trackId'],
          message: `a ${clip.kind} clip cannot live on a ${track.kind} track`,
        });
      }

      const intervals = intervalsByTrack.get(clip.trackId) ?? [];
      intervals.push({ start: clip.startFrame, end: clip.startFrame + clip.durationFrames, id: clip.id });
      intervalsByTrack.set(clip.trackId, intervals);
    }

    for (const [trackId, intervals] of intervalsByTrack) {
      const sorted = [...intervals].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (previous && current && current.start < previous.end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['clips'],
            message: `clips ${previous.id} and ${current.id} overlap on track ${trackId}`,
          });
        }
      }
    }
  });

export type Track = z.infer<typeof TrackSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipEffects = z.infer<typeof ClipEffectsSchema>;
export type ClipMotion = z.infer<typeof ClipMotionSchema>;
export type ClipTransformKeyframe = z.infer<typeof ClipTransformKeyframeSchema>;
export type ClipGainKeyframe = z.infer<typeof ClipGainKeyframeSchema>;
export type ChromaKey = z.infer<typeof ChromaKeySchema>;
