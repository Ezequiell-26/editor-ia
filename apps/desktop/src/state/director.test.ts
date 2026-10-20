import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type {
  MediaAnalysis,
  TranscriptionResult,
  TranscriptionSegment,
} from '../services/project-service';
import {
  applyDirectorPlan,
  buildDirectorPlan,
  type DirectorOptions,
} from './director';
import {
  createPendingRun,
  defaultDirectorProfile,
  emptyDirectorMemory,
  learnFromTimeline,
  measureTimeline,
  normalizeDirectorMemory,
} from './editor-memory';
import { addAsset, ensureDelivery, newId } from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function videoAsset(durationFrames = 300): Extract<Asset, { kind: 'video' }> {
  return {
    id: newId(),
    label: 'Toma principal',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Extract<Asset, { kind: 'video' }>;
}

function baseProject(asset: Asset): ProjectDocument {
  const project = validated(ensureDelivery(createEmptyProject('Director', NOW)));
  return validated(addAsset(project, asset));
}

function analysis(assetId: string): MediaAnalysis {
  return {
    assetId,
    kind: 'video',
    durationSeconds: 10,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [4],
    silences: [
      { startSeconds: 0, endSeconds: 0.4 },
      { startSeconds: 3, endSeconds: 3.8 },
      { startSeconds: 7, endSeconds: 7.8 },
      { startSeconds: 9.4, endSeconds: 10 },
    ],
    blacks: [],
    freezes: [],
    loudness: {
      integratedLufs: -22,
      truePeakDb: -2,
      lraDb: 4,
      noiseFloorDb: -58,
    },
    lumaAverage: 112,
    saturationAverage: 54,
    warnings: [],
  };
}

function segment(text: string, start: number, end: number): TranscriptionSegment {
  const tokens = text.split(' ');
  const step = (end - start) / tokens.length;
  return {
    start,
    end,
    text,
    words: tokens.map((word, index) => ({
      start: start + step * index,
      end: start + step * (index + 1),
      word,
      probability: 0.9,
    })),
  };
}

function transcript(): TranscriptionResult {
  return {
    language: 'es',
    languageProbability: 0.98,
    durationSeconds: 10,
    model: 'small',
    segments: [
      segment('Hola, hoy probamos el director automático.', 0.4, 3),
      segment('Primero revisamos los cortes y el audio.', 3.8, 7),
      segment('Y exportamos el resultado.', 7.8, 9.4),
    ],
  };
}

const OPTIONS: DirectorOptions = {
  removeSilences: true,
  removeRetakes: true,
  removeFillers: true,
  removeBadFrames: true,
  splitScenes: false,
  enhanceAudio: true,
  normalizeLoudness: true,
  autoCaptions: true,
  autoColor: true,
};

describe('director automático', () => {
  it('recorta silencios, conserva la voz y genera un plan aplicable', () => {
    const asset = videoAsset();
    const project = baseProject(asset);
    const profile = defaultDirectorProfile('youtube');
    const plan = buildDirectorPlan(
      project,
      asset,
      analysis(asset.id),
      transcript(),
      profile,
      'youtube',
      OPTIONS,
    );
    expect(plan.cuts.length).toBeGreaterThan(0);
    expect(plan.stats.outputFrames).toBeLessThan(300);
    expect(plan.stats.silenceRemovedSeconds).toBeGreaterThan(1);
    expect(plan.captions.length).toBeGreaterThan(0);
    expect(plan.audio.highPassHz).toBe(85);
    expect(plan.audio.compressor).toBe(true);
    expect(plan.loudnessTarget?.integratedLufs).toBe(-14);
    expect(plan.quality.some((item) => item.severity === 'error')).toBe(false);

    const applied = applyDirectorPlan(project, asset, plan);
    const parsed = validated(applied.project);
    expect(parsed.timeline.clips).toHaveLength(plan.cuts.length);
    expect(parsed.captions.cues.length).toBe(applied.captionCount);
    expect(parsed.timeline.clips[0]?.source).toMatchObject({
      type: 'asset',
      inFrame: plan.cuts[0]?.sourceInFrame,
      outFrame: plan.cuts[0]?.sourceOutFrame,
    });
    expect(parsed.audio.loudnessTarget?.integratedLufs).toBe(-14);
    expect(parsed.provenance.operations.at(-1)?.summary).toContain('Director automático');
  });

  it('elimina la toma anterior cuando el texto se repite', () => {
    const asset = videoAsset();
    const project = baseProject(asset);
    const repeated: TranscriptionResult = {
      language: 'es',
      languageProbability: 0.9,
      durationSeconds: 10,
      model: 'small',
      segments: [
        segment('esta es la toma que quiero descartar', 0.5, 2.2),
        segment('esta es la toma que quiero descartar', 2.4, 4.2),
        segment('ahora sigue otra idea completamente distinta', 4.5, 7),
      ],
    };
    const plan = buildDirectorPlan(
      project,
      asset,
      { ...analysis(asset.id), silences: [] },
      repeated,
      defaultDirectorProfile('youtube'),
      'youtube',
      { ...OPTIONS, removeSilences: false, removeFillers: false, splitScenes: false },
    );
    expect(plan.stats.retakesRemoved).toBe(1);
    expect(plan.stats.removedFrames).toBeGreaterThan(30);
  });

  it('quita muletillas no léxicas sin tocar palabras con contenido', () => {
    const asset = videoAsset();
    const project = baseProject(asset);
    const withFiller: TranscriptionResult = {
      language: 'es',
      languageProbability: 0.9,
      durationSeconds: 10,
      model: 'small',
      segments: [
        segment('eh hoy probamos el director', 0.5, 3),
        segment('y revisamos todo', 3.4, 6),
      ],
    };
    const plan = buildDirectorPlan(
      project,
      asset,
      { ...analysis(asset.id), silences: [] },
      withFiller,
      defaultDirectorProfile('youtube'),
      'youtube',
      { ...OPTIONS, removeSilences: false, removeRetakes: false, splitScenes: false },
    );
    expect(plan.stats.fillersRemoved).toBe(1);
  });

  it('aprende del timeline final y limpia el run pendiente', () => {
    const asset = videoAsset();
    const project = baseProject(asset);
    const profile = defaultDirectorProfile('shorts');
    const plan = buildDirectorPlan(
      project,
      asset,
      analysis(asset.id),
      transcript(),
      profile,
      'shorts',
      OPTIONS,
    );
    const applied = applyDirectorPlan(project, asset, plan);
    const memory = {
      ...emptyDirectorMemory(),
      profiles: { ...emptyDirectorMemory().profiles, shorts: profile },
      pendingRun: createPendingRun(project.id, project, 'shorts', profile, plan.summary),
    };
    const measured = measureTimeline(applied.project);
    const learned = learnFromTimeline(memory, project.id, applied.project, true);
    expect(learned.pendingRun?.lastLearnedRevision).toBe(applied.project.revision);
    expect(learned.runs).toHaveLength(1);
    expect(learned.runs[0]?.outcome.finalFrames).toBe(measured.finalFrames);
    expect(learned.profiles.shorts.samples).toBe(1);
    expect(learned.profiles.shorts.minShotSeconds).toBeGreaterThan(0.8);
    expect(learned.profiles.shorts.captionCps).toBeGreaterThanOrEqual(10);
    const unchanged = learnFromTimeline(learned, project.id, applied.project, true);
    expect(unchanged).toBe(learned);
    const edited = { ...applied.project, revision: applied.project.revision + 1 };
    const second = learnFromTimeline(learned, project.id, edited, true);
    expect(second.runs).toHaveLength(2);
    expect(second.profiles.shorts.samples).toBe(2);
  });

  it('sanea memoria dañada sin romper el perfil por defecto', () => {
    const memory = normalizeDirectorMemory({
      version: 99,
      profiles: { youtube: { samples: 'x', minShotSeconds: 999 } },
      runs: 'no',
      pendingRun: { projectPath: 4 },
    });
    expect(memory.version).toBe(1);
    expect(memory.profiles.youtube.minShotSeconds).toBeLessThanOrEqual(8);
    expect(memory.runs).toEqual([]);
    expect(memory.pendingRun).toBeNull();
  });

  it('rechaza aplicar un plan vacío', () => {
    const asset = videoAsset();
    const project = baseProject(asset);
    const plan = buildDirectorPlan(
      project,
      asset,
      analysis(asset.id),
      transcript(),
      defaultDirectorProfile('youtube'),
      'youtube',
      OPTIONS,
    );
    expect(() => applyDirectorPlan(project, asset, { ...plan, cuts: [] })).toThrow(
      /no tiene tomas/i,
    );
  });
});
