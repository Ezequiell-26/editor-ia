import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  createEmptyProductionPlan,
  ProductionPlanSchema,
  STUDIO_PLAN_VERSION,
} from './studio.ts';

const NOW = '2026-02-20T12:00:00.000Z';

function validPlan(): z.input<typeof ProductionPlanSchema> {
  return {
    schemaVersion: STUDIO_PLAN_VERSION,
    id: 'plan-1',
    createdAt: NOW,
    updatedAt: NOW,
    brief: { objective: 'Explicar el producto en 60 s', keyPoints: ['barato', 'rápido'] },
    target: {
      platform: 'youtube',
      aspectRatio: '16:9',
      targetDurationFrames: 1800,
    },
    requirements: [
      {
        id: 'req-broll',
        kind: 'video',
        query: 'oficina moderna',
        maxCount: 5,
        minCommercialUse: 'allowed',
        preferLocal: true,
        optional: false,
      },
    ],
    scenes: [
      {
        id: 'scene-hook',
        order: 0,
        title: 'Hook',
        intent: 'hook',
        targetDurationFrames: 180,
        narrationText: '¿Sabías que…?',
        requirementIds: ['req-broll'],
      },
    ],
    subtitles: { enabled: true, language: 'es' },
    music: { enabled: true, query: 'lofi suave' },
    quality: {
      requiredChecks: ['missing-resources', 'clip-range', 'render-verify'],
      minVmaf: 90,
    },
    stage: 'plan',
  };
}

describe('ProductionPlanSchema', () => {
  it('accepts a complete plan', () => {
    const plan = ProductionPlanSchema.parse(validPlan());
    expect(plan.schemaVersion).toBe(STUDIO_PLAN_VERSION);
    expect(plan.scenes[0]?.requirementIds).toEqual(['req-broll']);
  });

  it('applies defaults for optional collections', () => {
    const plan = ProductionPlanSchema.parse({
      ...validPlan(),
      requirements: [],
      scenes: [],
      subtitles: { enabled: false },
      music: { enabled: false },
    });
    expect(plan.requirements).toEqual([]);
    expect(plan.subtitles.enabled).toBe(false);
  });

  it('rejects duplicate requirement ids', () => {
    const plan = validPlan();
    plan.requirements!.push({ ...plan.requirements![0]! });
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('rejects a scene citing an undeclared requirement', () => {
    const plan = validPlan();
    plan.scenes![0]!.requirementIds = ['req-inexistente'];
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('req-inexistente');
    }
  });

  it('rejects duplicate scene orders', () => {
    const plan = validPlan();
    plan.scenes!.push({ ...plan.scenes![0]!, id: 'scene-2' });
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('requires a language when subtitles are enabled', () => {
    const plan = validPlan();
    plan.subtitles = { enabled: true };
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('requires a music query or requirements when music is enabled', () => {
    const plan = validPlan();
    plan.requirements = []; // eslint ok: input type allows clearing
    plan.music = { enabled: true };
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('rejects duplicated quality checks', () => {
    const plan = validPlan();
    plan.quality.requiredChecks.push('clip-range');
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('forbids unknown keys', () => {
    const plan = { ...validPlan(), surprise: true };
    const result = ProductionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});

describe('createEmptyProductionPlan', () => {
  it('produces a schema-valid draft', () => {
    const plan = createEmptyProductionPlan('plan-x', NOW, 'Probar el flujo completo');
    expect(plan.stage).toBe('brief');
    expect(plan.quality.requiredChecks.length).toBeGreaterThan(0);
  });
});
