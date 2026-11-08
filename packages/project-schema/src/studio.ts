import { z } from 'zod';
import { IsoDateTimeSchema } from './primitives.ts';
import { DurationSchema } from './time.ts';
import { AspectRatioSchema, TargetPlatformSchema } from './delivery.ts';
import { SceneIntentSchema } from './production.ts';

/**
 * Production plan: the versioned contract an autonomous producer emits before
 * touching the project document.
 *
 * The plan is an *input* artifact, not the edit document: it describes the
 * brief, the target delivery, the scenes to build and the resources each scene
 * needs. The orchestrator turns a validated plan into project operations
 * (AgentOperation patches); nothing here duplicates `ProjectDocumentSchema`,
 * which remains the single source of truth for the persisted edit.
 */

export const STUDIO_PLAN_VERSION = 1;

/** Pipeline stages the orchestrator reports progress against. */
export const StudioStageSchema = z.enum([
  'brief',
  'plan',
  'acquire',
  'analyze',
  'scenes',
  'edit',
  'render',
  'review',
  'deliver',
]);
export type StudioStage = z.infer<typeof StudioStageSchema>;

export const ProductionBriefSchema = z
  .object({
    objective: z.string().min(1).max(500),
    audience: z.string().min(1).max(200).optional(),
    tone: z.string().min(1).max(120).optional(),
    keyPoints: z.array(z.string().min(1).max(200)).max(12).default([]),
  })
  .strict();
export type ProductionBrief = z.infer<typeof ProductionBriefSchema>;

/** Resource families the studio can acquire, analyze or generate. */
export const StudioResourceKindSchema = z.enum([
  'video',
  'image',
  'audio',
  'music',
  'sfx',
  'voice',
  'animation',
  'graphic',
]);
export type StudioResourceKind = z.infer<typeof StudioResourceKindSchema>;

const CommercialUseRequirementSchema = z.enum([
  'allowed',
  'requires-attribution',
  'not-for-redistribution',
  'unknown',
]);

/** One resource the production needs, described well enough to search for it. */
export const ResourceRequirementSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: StudioResourceKindSchema,
    query: z.string().min(1).max(300),
    maxCount: z.number().int().min(1).max(50).default(3),
    /** Rights ceiling: results must be usable at least this well. */
    minCommercialUse: CommercialUseRequirementSchema.default('allowed'),
    /** Prefer locally owned material before searching external sources. */
    preferLocal: z.boolean().default(true),
    optional: z.boolean().default(false),
    /** Voice name for `kind: 'voice'` generation (e.g. a SAPI voice); omitted
     *  means the provider default. Ignored by acquisition sources. */
    voice: z.string().min(1).max(120).optional(),
  })
  .strict();
export type ResourceRequirement = z.infer<typeof ResourceRequirementSchema>;

/** A scene as the plan specifies it, before any clip exists. */
export const PlanSceneSchema = z
  .object({
    id: z.string().min(1).max(80),
    order: z.number().int().min(0).max(999),
    title: z.string().min(1).max(200),
    intent: SceneIntentSchema,
    targetDurationFrames: DurationSchema.optional(),
    narrationText: z.string().max(4_000).optional(),
    /** Ids of `requirements` this scene draws its resources from. */
    requirementIds: z.array(z.string().min(1).max(80)).max(20).default([]),
    notes: z.string().max(2_000).optional(),
  })
  .strict();
export type PlanScene = z.infer<typeof PlanSceneSchema>;

export const ProductionTargetSchema = z
  .object({
    platform: TargetPlatformSchema,
    aspectRatio: AspectRatioSchema,
    targetDurationFrames: DurationSchema,
    /** Render profile inside the project the delivery must satisfy. */
    renderProfileId: z.string().min(1).max(80).optional(),
  })
  .strict();
export type ProductionTarget = z.infer<typeof ProductionTargetSchema>;

/** Checks the review stage must run before the production is delivered. */
export const QualityCheckKindSchema = z.enum([
  'missing-resources',
  'clip-range',
  'caption-sync',
  'loudness',
  'resolution',
  'color',
  'render-verify',
  'rights',
]);
export type QualityCheckKind = z.infer<typeof QualityCheckKindSchema>;

export const QualityCriteriaSchema = z
  .object({
    requiredChecks: z.array(QualityCheckKindSchema).min(1).max(8),
    /** VMAF floor against the acquired source, when measurable. */
    minVmaf: z.number().min(0).max(100).optional(),
    /** Integrated loudness window the delivery must land in (LUFS). */
    loudnessTargetLufs: z.number().gte(-40).lte(0).optional(),
  })
  .strict()
  .superRefine((criteria, ctx) => {
    const seen = new Set<string>();
    for (const [index, check] of criteria.requiredChecks.entries()) {
      if (seen.has(check)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requiredChecks', index],
          message: `quality check ${check} is listed twice`,
        });
      }
      seen.add(check);
    }
  });
export type QualityCriteria = z.infer<typeof QualityCriteriaSchema>;

export const ProductionPlanSchema = z
  .object({
    schemaVersion: z.literal(STUDIO_PLAN_VERSION),
    id: z.string().min(1).max(80),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    brief: ProductionBriefSchema,
    target: ProductionTargetSchema,
    requirements: z.array(ResourceRequirementSchema).max(100).default([]),
    scenes: z.array(PlanSceneSchema).max(200).default([]),
    subtitles: z
      .object({
        enabled: z.boolean().default(false),
        language: z.string().min(2).max(20).optional(),
      })
      .strict()
      .default({ enabled: false }),
    music: z
      .object({
        enabled: z.boolean().default(false),
        query: z.string().min(1).max(200).optional(),
      })
      .strict()
      .default({ enabled: false }),
    /**
     * Transición de entrada aplicada por `edit` a cada clip visual de
     * producción después del primero en su pista. Subconjunto seguro del
     * `ClipTransitionSchema` (sin `luma-wipe`/`dip-color`, que exigen mate
     * o color extra).
     */
    transition: z
      .object({
        type: z.enum([
          'dissolve',
          'fade-black',
          'fade-white',
          'slide-left',
          'slide-right',
          'slide-up',
          'slide-down',
          'wipe-left',
          'wipe-right',
          'wipe-up',
          'wipe-down',
          'iris',
        ]),
        frames: z.number().int().min(1).max(120),
      })
      .strict()
      .optional(),
    quality: QualityCriteriaSchema,
    /** Ceiling for paid generation/acquisition, in USD cents. */
    maxCostCents: z.number().int().gte(0).optional(),
    stage: StudioStageSchema.default('plan'),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const requirementIds = new Set<string>();
    for (const [index, requirement] of plan.requirements.entries()) {
      if (requirementIds.has(requirement.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'id'],
          message: 'requirement ids must be unique inside a plan',
        });
      }
      requirementIds.add(requirement.id);
    }

    const sceneIds = new Set<string>();
    const orders = new Set<number>();
    plan.scenes.forEach((scene, index) => {
      if (sceneIds.has(scene.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'id'],
          message: 'scene ids must be unique inside a plan',
        });
      }
      sceneIds.add(scene.id);
      if (orders.has(scene.order)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'order'],
          message: `scene order ${scene.order} is already taken`,
        });
      }
      orders.add(scene.order);

      for (const [position, hint] of scene.requirementIds.entries()) {
        if (!requirementIds.has(hint)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['scenes', index, 'requirementIds', position],
            message: `scene cites requirement ${hint} which is not declared`,
          });
        }
      }
    });

    if (plan.subtitles.enabled && !plan.subtitles.language) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subtitles', 'language'],
        message: 'enabled subtitles need a language tag',
      });
    }
    if (plan.music.enabled && !plan.music.query && plan.requirements.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['music', 'query'],
        message: 'enabled music needs a search query or declared requirements',
      });
    }
  });
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

export function createEmptyProductionPlan(
  id: string,
  now: string,
  objective: string,
): ProductionPlan {
  return ProductionPlanSchema.parse({
    schemaVersion: STUDIO_PLAN_VERSION,
    id,
    createdAt: now,
    updatedAt: now,
    brief: { objective, keyPoints: [] },
    target: {
      platform: 'youtube',
      aspectRatio: '16:9',
      targetDurationFrames: 30 * 60,
    },
    requirements: [],
    scenes: [],
    subtitles: { enabled: false },
    music: { enabled: false },
    quality: { requiredChecks: ['missing-resources', 'clip-range', 'render-verify'] },
    stage: 'brief',
  });
}
