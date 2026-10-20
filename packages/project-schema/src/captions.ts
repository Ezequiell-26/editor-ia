import { z } from 'zod';
import { EntityIdSchema, LanguageTagSchema } from './primitives.ts';
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
