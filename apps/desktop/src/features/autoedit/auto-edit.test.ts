import { describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';
import { addAsset, totalFrames } from '../../state/project-actions';
import { applyAutoEditVariant } from './apply-auto-edit';
import { buildAutoEditVariants } from './auto-edit';

const NOW = '2026-10-27T00:00:00.000Z';

function analysis(): MediaAnalysis {
  return {
    assetId: '11111111-1111-4111-8111-111111111111',
    kind: 'video',
    durationSeconds: 60,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [10, 20, 30, 40, 50],
    silences: [
      { startSeconds: 12, endSeconds: 14 },
      { startSeconds: 32, endSeconds: 35 },
    ],
    blacks: [],
    freezes: [],
    loudness: {
      integratedLufs: -20,
      truePeakDb: -3,
      lraDb: 5,
      noiseFloorDb: -60,
    },
    lumaAverage: 0.5,
    saturationAverage: 0.4,
    warnings: [],
  };
}

function transcript(): TranscriptionResult {
  return {
    language: 'es',
    languageProbability: 0.9,
    durationSeconds: 60,
    model: 'local',
    segments: [
      { start: 1, end: 3, text: 'Primer momento', words: [] },
      { start: 21, end: 23, text: 'Segundo momento', words: [] },
      { start: 41, end: 43, text: 'Tercer momento', words: [] },
    ],
  };
}

function videoAsset(durationFrames = 1800): Asset {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Entrevista',
    kind: 'video',
    source: { type: 'local', path: 'media/entrevista.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

describe('editor automático determinista', () => {
  it('genera tres ritmos distintos y quita silencios', () => {
    const variants = buildAutoEditVariants(analysis(), transcript());
    expect(variants.map((variant) => variant.style)).toEqual(['pulse', 'story', 'impact']);
    const pulse = variants.find((variant) => variant.style === 'pulse')!;
    const story = variants.find((variant) => variant.style === 'story')!;
    const impact = variants.find((variant) => variant.style === 'impact')!;
    expect(pulse.cuts.length).toBeGreaterThan(story.cuts.length);
    expect(impact.durationSeconds).toBeGreaterThanOrEqual(15);
    expect(impact.durationSeconds).toBeLessThanOrEqual(30);
    for (const cut of pulse.cuts) {
      expect(cut.endSeconds).toBeGreaterThan(cut.startSeconds);
      const insideSilence =
        cut.startSeconds < 14 && cut.endSeconds > 12 ||
        cut.startSeconds < 35 && cut.endSeconds > 32;
      expect(insideSilence).toBe(false);
    }
  });

  it('remetea subtítulos al tiempo de salida sin inventar texto', () => {
    const variants = buildAutoEditVariants(analysis(), transcript());
    const pulse = variants.find((variant) => variant.style === 'pulse')!;
    expect(pulse.captions.length).toBeGreaterThan(0);
    for (const caption of pulse.captions) {
      expect(caption.text).toMatch(/momento/i);
      expect(caption.startSeconds).toBeGreaterThanOrEqual(0);
      expect(caption.endSeconds).toBeLessThanOrEqual(pulse.durationSeconds + 0.01);
    }
    const without = buildAutoEditVariants(analysis(), null);
    expect(without.every((variant) => variant.captions.length === 0)).toBe(true);
  });

  it('aplica la variante como clips editables con zoom, audio y subtítulos', () => {
    const project = addAsset(createEmptyProject('Auto', NOW), videoAsset());
    const variant = buildAutoEditVariants(analysis(), transcript()).find(
      (item) => item.style === 'story',
    )!;
    const result = applyAutoEditVariant(project, videoAsset(), variant, analysis(), {
      replace: true,
      improveAudio: true,
      addCaptions: true,
    });
    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);
    expect(result.clipCount).toBe(variant.cuts.length);
    expect(result.captionCount).toBeGreaterThan(0);
    expect(totalFrames(result.project)).toBeGreaterThan(0);
    const clips = result.project.timeline.clips;
    expect(clips.every((clip) => clip.kind === 'video')).toBe(true);
    expect(clips.some((clip) => clip.kind === 'video' && clip.transform?.keyframes?.length)).toBe(
      true,
    );
    const withAudio = clips.find(
      (clip) => clip.kind === 'video' && clip.audio && clip.audio.denoise !== undefined,
    );
    expect(withAudio).toBeTruthy();
    expect(result.project.captions.cues.length).toBe(result.captionCount);
    expect(result.project.timeline.tracks.some((track) => track.kind === 'caption')).toBe(true);
  });

  it('agrega la variante al final sin borrar los clips existentes', () => {
    const project = addAsset(createEmptyProject('Auto', NOW), videoAsset());
    const first = applyAutoEditVariant(project, videoAsset(), {
      ...buildAutoEditVariants(analysis(), null)[2]!,
      cuts: [{ startSeconds: 1, endSeconds: 3, zoom: false }],
    }, analysis(), { replace: true, improveAudio: false, addCaptions: false });
    const appended = applyAutoEditVariant(
      first.project,
      videoAsset(),
      {
        ...buildAutoEditVariants(analysis(), null)[2]!,
        cuts: [{ startSeconds: 5, endSeconds: 7, zoom: false }],
      },
      analysis(),
      { replace: false, improveAudio: false, addCaptions: false },
    );
    expect(appended.project.timeline.clips).toHaveLength(2);
    expect(totalFrames(appended.project)).toBeGreaterThan(totalFrames(first.project));
    expect(parseProject(JSON.parse(JSON.stringify(appended.project))).ok).toBe(true);
  });
});
