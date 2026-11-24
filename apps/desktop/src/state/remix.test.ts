import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type Clip, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import { addAsset, addClipFromAsset, ensureDelivery } from './project-actions';
import { readyAsset } from '../test/fake-service';
import { applyRemix, planRemix, planRemixForProject } from './remix';

const FPS = 30;
const NOW = '2026-11-23T00:00:00.000Z';

function clipFixture(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    kind: 'video',
    label: 'Clip',
    startFrame: 0,
    durationFrames: 10 * FPS,
    source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 10 * FPS },
    ...overrides,
  } as unknown as Clip;
}

function peaksWithPattern(
  pattern: readonly ('voz' | 'silencio')[],
  secondsPerBucket = 0.1,
): AudioPeaks {
  return {
    assetId: 'asset-1',
    durationSeconds: pattern.length * secondsPerBucket,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.6, max: 0.6 } : { min: -0.001, max: 0.001 },
    ),
  };
}

// Habla 0–3 s y 5–8 s del asset; silencio 3–5 y 8–10.
const SPEECH = [
  { start: 0, end: 3 },
  { start: 5, end: 8 },
];

describe('planRemix', () => {
  it('conserva los tramos con más habla y elimina el complemento', () => {
    const plan = planRemix(clipFixture(), FPS, {
      targetSeconds: 6,
      speech: SPEECH,
    });
    expect(plan).not.toBeNull();
    // Primero y último siempre quedan; se agrega el de mayor cobertura.
    expect(plan!.keptChunks).toBeGreaterThanOrEqual(3);
    expect(plan!.keptSeconds).toBeGreaterThanOrEqual(4);
    expect(plan!.removedSeconds).toBeGreaterThan(0);
    // Los keep spans están ordenados y dentro de la ventana del clip.
    const sorted = [...plan!.keepSpans].sort((a, b) => a.startFrame - b.startFrame);
    expect(plan!.keepSpans.map((s) => s.startFrame)).toEqual(
      sorted.map((s) => s.startFrame),
    );
    expect(plan!.keepSpans[0]!.startFrame).toBe(0);
    expect(plan!.keepSpans[plan!.keepSpans.length - 1]!.endFrame).toBe(10 * FPS);
    expect(plan!.removePlan.excessive).toBe(false);
  });

  it('sin transcripción usa los picos de audio como señal', () => {
    const pattern: readonly ('voz' | 'silencio')[] = [
      ...Array.from({ length: 30 }, () => 'voz' as const), // 0–3 s
      ...Array.from({ length: 20 }, () => 'silencio' as const), // 3–5 s
      ...Array.from({ length: 30 }, () => 'voz' as const), // 5–8 s
      ...Array.from({ length: 20 }, () => 'silencio' as const), // 8–10 s
    ];
    const plan = planRemix(clipFixture(), FPS, {
      targetSeconds: 6,
      peaks: peaksWithPattern(pattern),
    });
    expect(plan).not.toBeNull();
    expect(plan!.removedSeconds).toBeGreaterThan(0);
  });

  it('devuelve null sin señal (ni habla ni picos)', () => {
    expect(planRemix(clipFixture(), FPS, { targetSeconds: 5 })).toBeNull();
  });

  it('devuelve null si el objetivo no es menor que el clip', () => {
    expect(
      planRemix(clipFixture(), FPS, { targetSeconds: 12, speech: SPEECH }),
    ).toBeNull();
  });

  it('rechaza clips no candidatos: imagen, speed≠1, sin asset', () => {
    expect(
      planRemix(clipFixture({ kind: 'image' as Clip['kind'] }), FPS, {
        targetSeconds: 5,
        speech: SPEECH,
      }),
    ).toBeNull();
    expect(
      planRemix(
        clipFixture({ speed: { num: 2, den: 1 } } as Partial<Clip>),
        FPS,
        { targetSeconds: 5, speech: SPEECH },
      ),
    ).toBeNull();
    expect(
      planRemix(
        clipFixture({
          source: { type: 'compound', compoundId: 'x' },
        } as Partial<Clip>),
        FPS,
        { targetSeconds: 5, speech: SPEECH },
      ),
    ).toBeNull();
  });

  it('conserva el primer y último chunk aunque el objetivo sea mínimo', () => {
    // Piso honesto del algoritmo: first+last siempre quedan (~4 s de 10 s),
    // así que un objetivo irreal no puede dejar menos del ~15% del clip.
    const plan = planRemix(clipFixture(), FPS, {
      targetSeconds: 0.5,
      speech: SPEECH,
    });
    expect(plan).not.toBeNull();
    expect(plan!.keptSeconds).toBeGreaterThanOrEqual(3);
    expect(plan!.keepSpans[0]!.startFrame).toBe(0);
    expect(plan!.keepSpans[plan!.keepSpans.length - 1]!.endFrame).toBe(10 * FPS);
  });
});

describe('applyRemix', () => {
  function projectWithClip(): { project: ProjectDocument; clipId: string } {
    const asset = readyAsset({
      kind: 'video',
      label: 'Toma',
      source: { type: 'local', path: 'media/toma.mp4' },
      media: { width: 1920, height: 1080, durationFrames: 10 * FPS, frameRate: { num: FPS, den: 1 } },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Remix', NOW)), asset);
    const added = addClipFromAsset(project, asset, {
      atFrame: 0,
      durationFrames: 10 * FPS,
    });
    project = added.project;
    return { project, clipId: added.clipId };
  }

  it('acorta el clip con ripple y el proyecto sigue válido', () => {
    const { project, clipId } = projectWithClip();
    const plan = planRemixForProject(project, clipId, {
      targetSeconds: 6,
      speech: SPEECH,
    });
    expect(plan).not.toBeNull();
    const after = applyRemix(project, clipId, plan!);
    const parsed = parseProject(after);
    expect(parsed.ok).toBe(true);
    const pieces = after.timeline.clips.filter((clip) => clip.kind === 'video');
    const totalFrames = pieces.reduce((sum, clip) => sum + clip.durationFrames, 0);
    // Quedan ~7 s de material (first+last+mejor chunk), no los 10 s originales.
    expect(totalFrames).toBeLessThan(10 * FPS);
    expect(totalFrames).toBeGreaterThan(4 * FPS);
  });

  it('un objetivo mínimo recorta sólo lo prescindible y el proyecto valida', () => {
    const { project, clipId } = projectWithClip();
    const plan = planRemixForProject(project, clipId, {
      targetSeconds: 0.5,
      speech: SPEECH,
    });
    expect(plan).not.toBeNull();
    const after = applyRemix(project, clipId, plan!);
    expect(parseProject(after).ok).toBe(true);
    // First+last quedan: no puede eliminar más de ~60% del clip.
    const totalFrames = after.timeline.clips.reduce(
      (sum, clip) => sum + clip.durationFrames,
      0,
    );
    expect(totalFrames).toBeGreaterThan(3 * FPS);
  });
});
