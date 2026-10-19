import { z } from 'zod';
import { DecibelSchema, EntityIdSchema, JsonValueSchema } from './primitives.ts';
import { DurationSchema } from './time.ts';

/**
 * Narrative layer: scenes, motion graphics and the audio mix.
 *
 * Scenes are the human facing unit of the project: they hold the intention and
 * the narration, and reference clips by id instead of embedding them, so an AI
 * operation can rewrite a scene without rewriting the whole timeline.
 */

export const SceneIntentSchema = z.enum([
  'hook',
  'context',
  'explainer',
  'demo',
  'proof',
  'cta',
  'outro',
]);

export const SceneStatusSchema = z.enum(['draft', 'reviewed', 'approved']);

export const NarrationSchema = z
  .object({
    text: z.string().min(1).max(4_000).optional(),
    voiceProfileId: EntityIdSchema.optional(),
    assetId: EntityIdSchema.optional(),
    estimatedDurationFrames: DurationSchema.optional(),
  })
  .strict()
  .superRefine((narration, ctx) => {
    if (narration.text === undefined && narration.assetId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'a scene needs either a written narration or a recorded voice asset',
      });
    }
  });

export const SceneSchema = z
  .object({
    id: EntityIdSchema,
    order: z.number().int().min(0).max(999),
    title: z.string().min(1).max(200),
    intent: SceneIntentSchema,
    status: SceneStatusSchema,
    narration: NarrationSchema,
    clipIds: z.array(EntityIdSchema).max(2_000),
    sourceSceneId: EntityIdSchema.optional(),
    notes: z.string().max(2_000).optional(),
  })
  .strict();

export const SceneListSchema = z.array(SceneSchema).superRefine((scenes, ctx) => {
  const ids = new Set<string>();
  const orders = new Set<number>();

  for (const [index, item] of scenes.entries()) {
    if (ids.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: 'scene ids must be unique inside a project',
      });
    }
    ids.add(item.id);

    if (orders.has(item.order)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'order'],
        message: `scene order ${item.order} is already taken`,
      });
    }
    orders.add(item.order);
  }
});

export const TemplateSourceSchema = z.enum(['bundled', 'user', 'downloaded']);

export const MotionItemSchema = z
  .object({
    id: EntityIdSchema,
    template: z
      .object({
        id: z.string().min(1).max(120),
        version: z.string().min(1).max(40),
        source: TemplateSourceSchema,
      })
      .strict(),
    props: z.record(JsonValueSchema),
    targetTrackId: EntityIdSchema.optional(),
  })
  .strict();

export const MotionListSchema = z.array(MotionItemSchema).superRefine((items, ctx) => {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: 'motion item ids must be unique inside a project',
      });
    }
    ids.add(item.id);
  }
});

export const LoudnessPlatformSchema = z.enum([
  'youtube',
  'shorts',
  'reels',
  'tiktok',
  'podcast',
  'broadcast',
]);

const MasterSchema = z
  .object({
    gainDb: DecibelSchema.default(0),
    limiter: z.boolean().default(false),
  })
  .strict();

const MusicBedSchema = z
  .object({
    assetId: EntityIdSchema,
    gainDb: DecibelSchema.default(-18),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
    loop: z.boolean().default(false),
  })
  .strict();

const DuckingSchema = z
  .object({
    enabled: z.boolean().default(false),
    amountDb: z.number().gte(-60).lte(0).default(-12),
    sourceTrackIds: z.array(EntityIdSchema).default([]),
    targetTrackIds: z.array(EntityIdSchema).default([]),
  })
  .strict();

const LoudnessTargetSchema = z
  .object({
    platform: LoudnessPlatformSchema,
    integratedLufs: z.number().gte(-33).lte(-9),
    truePeakDb: z.number().gte(-9).lte(0),
    toleranceDb: z.number().gte(0).lte(3),
  })
  .strict();

export const AudioMixSchema = z
  .object({
    master: MasterSchema.default({}),
    music: MusicBedSchema.optional(),
    ducking: DuckingSchema.default({}),
    loudnessTarget: LoudnessTargetSchema.optional(),
  })
  .strict()
  .superRefine((mix, ctx) => {
    if (!mix.ducking.enabled) {
      return;
    }
    if (mix.ducking.targetTrackIds.length === 0 || mix.ducking.sourceTrackIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ducking', 'targetTrackIds'],
        message: 'ducking needs at least one source track and one ducked track',
      });
    }
  });

export type Scene = z.infer<typeof SceneSchema>;
export type MotionItem = z.infer<typeof MotionItemSchema>;
export type AudioMix = z.infer<typeof AudioMixSchema>;
