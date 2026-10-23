import { z } from 'zod';
import { EntityIdSchema, LanguageTagSchema, UnitIntervalSchema } from './primitives.ts';
import { FrameSchema } from './time.ts';

/**
 * Caption cues and caption styles.
 *
 * Cues carry frame timecodes rather than wall-clock time so that a subtitle
 * block stays aligned when a renderer changes sample rate or when the project
 * is re-timed. Overlaps inside one caption track are refused: two cues on
 * screen at once is a production error, not a style choice.
 */

const HexColorSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

export const CaptionPositionSchema = z.enum(['top', 'center', 'bottom']);

export const CaptionStyleSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().min(1).max(80),
    fontFamily: z.string().min(1).max(120),
    fontSizePx: z.number().int().gte(1).lte(400),
    color: HexColorSchema,
    outlineColor: HexColorSchema.optional(),
    backgroundColor: HexColorSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    borderStyle: z.enum(['outline', 'box']).optional(),
    shadow: z.boolean().optional(),
    depth3d: z.number().int().gte(0).lte(12).optional(),
    depthColor: HexColorSchema.optional(),
    position: CaptionPositionSchema,
  })
  .strict();

const CaptionWordSchema = z
  .object({
    text: z.string().min(1).max(200),
    startFrame: FrameSchema,
    endFrame: FrameSchema,
  })
  .strict();

export const CaptionAnimationSchema = z.enum([
  'none',
  'fade',
  'pop',
  'slide-up',
]);
export type CaptionAnimation = z.infer<typeof CaptionAnimationSchema>;

export const CAPTION_MOTION_PRESETS = [
  'fade',
  'zoom',
  'slide-left',
  'slide-right',
  'zoom-out',
] as const;
export const CaptionMotionPresetSchema = z.enum(CAPTION_MOTION_PRESETS);
export type CaptionMotionPreset = z.infer<typeof CaptionMotionPresetSchema>;

/**
 * Two keyframes at the cue level: the first must sit at frame 0 and the second
 * inside the cue. Position is normalized to the frame; scale is uniform.
 */
export const CaptionMotionKeyframeSchema = z
  .object({
    frame: FrameSchema,
    x: z.number().gte(-1).lte(1).optional(),
    y: z.number().gte(-1).lte(1).optional(),
    scale: z.number().gte(0.2).lte(4).optional(),
    rotationDeg: z.number().gte(-180).lte(180).optional(),
    opacity: UnitIntervalSchema.optional(),
  })
  .strict();
export type CaptionMotionKeyframe = z.infer<typeof CaptionMotionKeyframeSchema>;

export const CaptionMotionSchema = z
  .object({
    preset: CaptionMotionPresetSchema.optional(),
    keyframes: z.array(CaptionMotionKeyframeSchema).length(2),
  })
  .strict();
export type CaptionMotion = z.infer<typeof CaptionMotionSchema>;

export const CaptionCueSchema = z
  .object({
    id: EntityIdSchema,
    trackId: EntityIdSchema,
    styleId: EntityIdSchema.optional(),
    text: z.string().trim().min(1).max(500),
    language: LanguageTagSchema,
    startFrame: FrameSchema,
    endFrame: FrameSchema,
    words: z.array(CaptionWordSchema).optional(),
    wordReveal: z.boolean().optional(),
    animation: CaptionAnimationSchema.optional(),
    motion: CaptionMotionSchema.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.endFrame <= item.startFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endFrame'],
        message: 'a caption cue must end after it starts',
      });
    }
    if (item.motion) {
      const from = item.motion.keyframes[0];
      const to = item.motion.keyframes[1];
      if (!from || !to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motion', 'keyframes'],
          message: 'a caption motion needs exactly two keyframes',
        });
        return;
      }
      if (from.frame !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motion', 'keyframes', 0, 'frame'],
          message: 'the first motion keyframe must sit at frame 0',
        });
      }
      if (to.frame <= from.frame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motion', 'keyframes', 1, 'frame'],
          message: 'motion keyframes must be strictly increasing',
        });
      }
      if (to.frame > item.endFrame - item.startFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motion', 'keyframes', 1, 'frame'],
          message: 'the last motion keyframe must fall inside the cue',
        });
      }
      const animatesSomething = item.motion.keyframes.some(
        (keyframe) =>
          keyframe.x !== undefined ||
          keyframe.y !== undefined ||
          keyframe.scale !== undefined ||
          keyframe.rotationDeg !== undefined ||
          keyframe.opacity !== undefined,
      );
      if (!animatesSomething) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motion'],
          message: 'a caption motion must animate at least one property',
        });
      }
    }
  });

export const CaptionsSchema = z
  .object({
    styles: z.array(CaptionStyleSchema),
    cues: z.array(CaptionCueSchema),
  })
  .strict()
  .superRefine((captions, ctx) => {
    const styleIds = new Set(captions.styles.map((style) => style.id));
    const cueIds = new Set<string>();
    const cuesByTrack = new Map<string, { start: number; end: number; id: string }[]>();

    for (const [index, item] of captions.cues.entries()) {
      if (cueIds.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cues', index, 'id'],
          message: 'caption cue ids must be unique inside a project',
        });
      }
      cueIds.add(item.id);

      if (item.styleId !== undefined && !styleIds.has(item.styleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cues', index, 'styleId'],
          message: 'the cue references a caption style that is not defined in the project',
        });
      }

      const bucket = cuesByTrack.get(item.trackId) ?? [];
      bucket.push({ start: item.startFrame, end: item.endFrame, id: item.id });
      cuesByTrack.set(item.trackId, bucket);
    }

    for (const [trackId, cues] of cuesByTrack) {
      const sorted = [...cues].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (previous && current && current.start < previous.end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['cues'],
            message: `caption cues ${previous.id} and ${current.id} overlap on track ${trackId}`,
          });
        }
      }
    }
  });

export type CaptionCue = z.infer<typeof CaptionCueSchema>;
export type CaptionWord = z.infer<typeof CaptionWordSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
