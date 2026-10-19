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

export const ClipTransformSchema = z
  .object({
    offsetX: z.number().int().gte(-100_000).lte(100_000).optional(),
    offsetY: z.number().int().gte(-100_000).lte(100_000).optional(),
    scaleX: z.number().gt(0).lte(100).optional(),
    scaleY: z.number().gt(0).lte(100).optional(),
    rotationDeg: z.number().gte(-360).lte(360).optional(),
    opacity: UnitIntervalSchema.optional(),
  })
  .strict();

export const ClipAudioSchema = z
  .object({
    gainDb: DecibelSchema.optional(),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
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
  .object({ ...clipCommon, kind: z.literal('image'), source: StillAssetSourceSchema })
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
    if (clip.kind !== 'video' && clip.kind !== 'audio') {
      return;
    }

    const sourceFrames = clip.source.outFrame - clip.source.inFrame;
    if (sourceFrames <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'outFrame'],
        message: 'a clip source window must end after it starts',
      });
      return;
    }

    const speed = clip.speed ?? { num: 1, den: 1 };
    if (clip.durationFrames * speed.num !== sourceFrames * speed.den) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationFrames'],
        message:
          'the clip duration must match its source window divided by its speed, in whole frames',
      });
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
