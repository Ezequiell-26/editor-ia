import { z } from 'zod';

/**
 * Time and frame-rate primitives of the project format.
 *
 * All timeline positions and durations are integer frames. Floating-point
 * seconds are never persisted: a 29.97 fps project must round-trip without
 * drift, so frame rates are rational numbers (num/den) and every timestamp is
 * an integer frame count.
 */

/** A 24 hour project at 60 fps. Anything longer is treated as malformed. */
export const TOTAL_DURATION_MAX_FRAMES = 5_184_000;

const SafeIntegerSchema = z.number().int().finite();

export const FrameSchema = SafeIntegerSchema.min(0).max(TOTAL_DURATION_MAX_FRAMES);

/**
 * A positive duration. A zero-length clip is never meaningful on a timeline,
 * so durations use their own schema instead of `FrameSchema`.
 */
export const DurationSchema = SafeIntegerSchema.positive().max(TOTAL_DURATION_MAX_FRAMES);

export const FrameRateSchema = z
  .object({
    num: SafeIntegerSchema.positive(),
    den: SafeIntegerSchema.positive(),
  })
  .strict();

export type Frame = z.infer<typeof FrameSchema>;
export type Duration = z.infer<typeof DurationSchema>;
export type FrameRate = z.infer<typeof FrameRateSchema>;
