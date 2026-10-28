import { z } from 'zod';
import { EntityIdSchema } from './primitives.ts';
import { FrameSchema } from './time.ts';

export const MAX_MARKERS = 200;
export const MAX_MARKER_NOTE = 500;

export const MARKER_COLORS = ['mint', 'amber', 'rose', 'blue', 'violet', 'slate'] as const;

export const MarkerColorSchema = z.enum(MARKER_COLORS);

/**
 * A named point on the timeline. Markers live at the project root so a chapter
 * export does not depend on which clip happens to be under the playhead.
 */
export const MarkerSchema = z
  .object({
    id: EntityIdSchema,
    frame: FrameSchema,
    endFrame: FrameSchema.optional(),
    label: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !/[\r\n]/.test(value), {
        message: 'a marker label must stay on one line',
      }),
    color: MarkerColorSchema.optional(),
    note: z.string().trim().max(MAX_MARKER_NOTE).optional(),
  })
  .strict()
  .superRefine((marker, ctx) => {
    if (marker.endFrame !== undefined && marker.endFrame <= marker.frame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endFrame'],
        message: 'a marker range must end after its start',
      });
    }
  });

/** Root collection with a default so projects written before markers still load. */
export const MarkerListSchema = z.array(MarkerSchema).max(MAX_MARKERS).default([]);

export type Marker = z.infer<typeof MarkerSchema>;
export type MarkerColor = z.infer<typeof MarkerColorSchema>;
