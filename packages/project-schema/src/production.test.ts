import { describe, expect, it } from 'vitest';
import { AudioMixSchema, MotionItemSchema, SceneListSchema, SceneSchema } from './production.ts';

const SCENE_A = '12121212-1212-4212-8212-121212121212';
const SCENE_B = '13131313-1313-4313-8313-131313131313';
const CLIP = '14141414-1414-4414-8414-141414141414';
const ASSET = '15151515-1515-4515-8515-151515151515';
const MOTION = '16161616-1616-4616-8616-161616161616';
const TRACK = '17171717-1717-4717-8717-171717171717';

function scene(overrides: Record<string, unknown> = {}) {
  return {
    id: SCENE_A,
    order: 0,
    title: 'Apertura',
    intent: 'hook',
    status: 'draft',
    narration: { text: 'Probá esto primero', estimatedDurationFrames: 120 },
    clipIds: [],
    ...overrides,
  };
}

function motionItem(overrides: Record<string, unknown> = {}) {
  return {
    id: MOTION,
    template: { id: 'lower-third', version: '1.2.0', source: 'bundled' },
    props: { label: 'Texto', size: 24 },
    ...overrides,
  };
}

describe('SceneSchema', () => {
  it('accepts a scene with narration and no clips yet', () => {
    expect(SceneSchema.safeParse(scene()).success).toBe(true);
  });

  it('accepts a scene that references clips by id', () => {
    expect(SceneSchema.safeParse(scene({ clipIds: [CLIP], status: 'approved' })).success).toBe(true);
  });

  it('rejects an unknown narrative intent', () => {
    expect(SceneSchema.safeParse(scene({ intent: 'vibes' })).success).toBe(false);
  });

  it('rejects a scene whose narration carries neither text nor a recorded asset', () => {
    expect(SceneSchema.safeParse(scene({ narration: {} })).success).toBe(false);
  });

  it('accepts a narration that only points at a recorded voice asset', () => {
    expect(SceneSchema.safeParse(scene({ narration: { assetId: ASSET } })).success).toBe(true);
  });

  it('rejects a zero length estimated narration duration', () => {
    expect(
      SceneSchema.safeParse(scene({ narration: { text: 'Hola', estimatedDurationFrames: 0 } }))
        .success,
    ).toBe(false);
  });

  it('rejects a negative scene order', () => {
    expect(SceneSchema.safeParse(scene({ order: -1 })).success).toBe(false);
  });

  it('rejects an unknown scene key', () => {
    expect(SceneSchema.safeParse(scene({ deleteFiles: true })).success).toBe(false);
  });

  it('keeps variant lineage through sourceSceneId', () => {
    expect(SceneSchema.safeParse(scene({ sourceSceneId: SCENE_B })).success).toBe(true);
    expect(SceneSchema.safeParse(scene({ sourceSceneId: 'escena-hermana' })).success).toBe(false);
  });
});

describe('SceneListSchema', () => {
  it('rejects duplicate scene ids', () => {
    expect(SceneListSchema.safeParse([scene(), scene()]).success).toBe(false);
  });

  it('rejects two scenes claiming the same order', () => {
    expect(
      SceneListSchema.safeParse([scene(), scene({ id: SCENE_B, order: 0 })]).success,
    ).toBe(false);
  });

  it('accepts scenes in any file order as long as orders differ', () => {
    expect(
      SceneListSchema.safeParse([
        scene({ id: SCENE_B, order: 1 }),
        scene({ order: 0 }),
      ]).success,
    ).toBe(true);
  });
});

describe('MotionItemSchema', () => {
  it('accepts a bundled template reference with plain props', () => {
    expect(MotionItemSchema.safeParse(motionItem()).success).toBe(true);
  });

  it('rejects props that are not JSON serializable', () => {
    expect(MotionItemSchema.safeParse(motionItem({ props: { at: new Date() } })).success).toBe(false);
  });

  it('accepts nested props', () => {
    expect(
      MotionItemSchema.safeParse(motionItem({ props: { layout: { rows: [1, 2], rtl: false } } }))
        .success,
    ).toBe(true);
  });

  it('rejects a template reference without a version', () => {
    expect(
      MotionItemSchema.safeParse(
        motionItem({ template: { id: 'lower-third', source: 'bundled' } }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown template source', () => {
    expect(
      MotionItemSchema.safeParse(
        motionItem({ template: { id: 'x', version: '1', source: 'scrapped' } }),
      ).success,
    ).toBe(false);
  });

  it('accepts a motion item bound to a track', () => {
    expect(MotionItemSchema.safeParse(motionItem({ targetTrackId: TRACK })).success).toBe(true);
  });

  it('rejects an unknown motion key', () => {
    expect(MotionItemSchema.safeParse(motionItem({ command: 'ffmpeg' })).success).toBe(false);
  });
});

describe('AudioMixSchema', () => {
  it('accepts an empty mix and fills the defaults', () => {
    const parsed = AudioMixSchema.parse({});
    expect(parsed.master.limiter).toBe(false);
    expect(parsed.ducking.enabled).toBe(false);
  });

  it('rejects a master gain outside the mixer range', () => {
    expect(AudioMixSchema.safeParse({ master: { gainDb: 40 } }).success).toBe(false);
  });

  it('rejects ducking that is enabled without any target track', () => {
    expect(
      AudioMixSchema.safeParse({
        ducking: { enabled: true, amountDb: -12, sourceTrackIds: [TRACK], targetTrackIds: [] },
      }).success,
    ).toBe(false);
  });

  it('accepts ducking aimed at a music bed under a narration track', () => {
    expect(
      AudioMixSchema.safeParse({
        ducking: {
          enabled: true,
          amountDb: -12,
          sourceTrackIds: [TRACK],
          targetTrackIds: [SCENE_A],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a loudness target that no platform uses', () => {
    expect(
      AudioMixSchema.safeParse({
        loudnessTarget: { platform: 'youtube', integratedLufs: 0, truePeakDb: -1, toleranceDb: 1 },
      }).success,
    ).toBe(false);
  });

  it('accepts the measured loudness target of the current render stack', () => {
    expect(
      AudioMixSchema.safeParse({
        loudnessTarget: {
          platform: 'youtube',
          integratedLufs: -13.8,
          truePeakDb: -1.5,
          toleranceDb: 1,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects music without a local asset', () => {
    expect(AudioMixSchema.safeParse({ music: { gainDb: -18 } }).success).toBe(false);
  });

  it('rejects an unknown mix key', () => {
    expect(AudioMixSchema.safeParse({ reverb: 3 }).success).toBe(false);
  });
});
