import { describe, expect, it } from 'vitest';
import { createFakeService } from '../test/fake-service';
import {
  assembleVariant,
  generateVariant,
  planVariants,
  type FactoryBrief,
} from './batch-factory';

const BRIEF: FactoryBrief = {
  topic: 'Cómo ordenar una timeline',
  variants: 2,
  scenes: 3,
  language: 'es',
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
};

const IMAGE = {
  id: 'image-1',
  label: 'Card verde',
  path: 'media/card.png',
  hash: 'a'.repeat(64),
  bytes: 1000,
  width: 1920,
  height: 1080,
};

describe('fábrica de contenido', () => {
  it('planifica variantes con ángulos distintos', () => {
    const plans = planVariants(BRIEF);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.brief).not.toBe(plans[1]?.brief);
    expect(plans[0]?.name).toContain('v1');
    expect(plans[1]?.name).toContain('v2');
  });

  it('genera y ensambla una variante desde el brief', async () => {
    const service = createFakeService();
    const plans = planVariants(BRIEF);
    const plan = plans[0]!;
    const generated = await generateVariant(service, BRIEF, plan, [IMAGE], {
      photoMotion: 'auto',
      transitionFrames: 8,
      confirmRights: true,
      approveCost: false,
    });
    expect(generated.project.scenes).toHaveLength(3);
    expect(generated.narrations).toHaveLength(3);
    const assembled = assembleVariant(generated.project, generated.narrations, {
      photoMotion: 'auto',
      transitionFrames: 8,
      confirmRights: true,
    });
    expect(assembled.timeline.clips.length).toBeGreaterThan(0);
    expect(assembled.captions.cues.length).toBeGreaterThan(0);
    expect(assembled.assets.every((asset) => asset.status === 'ready')).toBe(true);
  });
});
