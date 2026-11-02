import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import { readyAsset } from '../test/fake-service';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery } from './project-actions';
import { applyReviewItems, buildReviewItems, reviewSummary } from './review-queue';

const NOW = '2026-11-02T00:00:00.000Z';

function peaks(pattern: readonly ('voz' | 'silencio')[]): AudioPeaks {
  return {
    assetId: 'asset',
    durationSeconds: pattern.length * 0.1,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.5, max: 0.5 } : { min: -0.002, max: 0.002 },
    ),
  };
}

const WITH_SILENCE = peaks([
  ...Array.from({ length: 30 }, () => 'voz' as const),
  ...Array.from({ length: 20 }, () => 'silencio' as const),
]);

function projectWithCues(): ProjectDocument {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Voz',
    source: { type: 'local', path: 'media/voz.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Revisión', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
  return {
    ...seeded.project,
    captions: {
      ...seeded.project.captions,
      cues: [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          trackId: seeded.trackId,
          text: 'Primera frase',
          language: 'es',
          startFrame: 0,
          endFrame: 30,
          words: [
            { text: 'Primera', startFrame: 0, endFrame: 15 },
            { text: 'frase', startFrame: 15, endFrame: 30 },
          ],
        },
        {
          id: '00000000-0000-4000-8000-00000000000d',
          trackId: seeded.trackId,
          text: 'Segunda frase',
          language: 'es',
          startFrame: 60,
          endFrame: 90,
          words: [
            { text: 'Segunda', startFrame: 60, endFrame: 75 },
            { text: 'frase', startFrame: 75, endFrame: 90 },
          ],
        },
      ],
    },
  } as ProjectDocument;
}

function build(project: ProjectDocument) {
  return buildReviewItems(project, async () => WITH_SILENCE);
}

describe('buildReviewItems', () => {
  it('arma ítems independientes para silencio, pausa, ruido y nivel', async () => {
    const items = await build(projectWithCues());
    const kinds = items.map((item) => item.kind);
    expect(kinds).toContain('silence');
    expect(kinds).toContain('pause');
    expect(kinds).toContain('denoise');
    expect(kinds).toContain('level');
    expect(items.filter((item) => item.kind === 'level')).toHaveLength(1);
    // Los tramos son relativos al clip: el clip arranca en 0, así que coinciden
    // con los frames absolutos del plan.
    const silence = items.find((item) => item.kind === 'silence')!;
    expect(silence.span!.startOffset).toBeGreaterThan(90);
    expect(silence.seconds).toBeGreaterThan(1);
  });

  it('no propone silencios si los picos no los muestran', async () => {
    const allVoice = peaks(Array.from({ length: 50 }, () => 'voz' as const));
    const items = await buildReviewItems(projectWithCues(), async () => allVoice);
    expect(items.some((item) => item.kind === 'silence')).toBe(false);
    expect(items.some((item) => item.kind === 'pause')).toBe(true);
  });
});

describe('applyReviewItems', () => {
  it('aplica sólo los cortes aceptados', async () => {
    const project = projectWithCues();
    const items = await build(project);
    const silence = items.find((item) => item.kind === 'silence')!;
    const next = applyReviewItems(project, items, new Set([silence.id]));
    expect(next).not.toBe(project);
    expect(next.timeline.clips.length).toBeGreaterThan(project.timeline.clips.length);
    // Sin el ítem de ruido aceptado, el clip no cambia de denoise.
    expect(next.audio.loudnessTarget).toBeUndefined();
    const clip = next.timeline.clips[0]!;
    expect(clip && 'audio' in clip ? clip.audio?.denoise : undefined).toBeUndefined();
  });

  it('aplica ruido y nivel sin cortar nada', async () => {
    const project = projectWithCues();
    const items = await build(project);
    const accepted = new Set(
      items.filter((item) => item.kind === 'denoise' || item.kind === 'level').map((item) => item.id),
    );
    const next = applyReviewItems(project, items, accepted);
    expect(next.timeline.clips).toHaveLength(project.timeline.clips.length);
    const clip = next.timeline.clips[0]!;
    expect(clip && 'audio' in clip ? clip.audio?.denoise : undefined).toBeGreaterThan(0);
    expect(next.audio.loudnessTarget?.integratedLufs).toBe(-14);
  });

  it('sin ítems aceptados devuelve el mismo proyecto', async () => {
    const project = projectWithCues();
    const items = await build(project);
    expect(applyReviewItems(project, items, new Set())).toBe(project);
  });

  it('resume lo aplicado', async () => {
    const project = projectWithCues();
    const items = await build(project);
    const accepted = new Set(items.map((item) => item.id));
    expect(reviewSummary(items, accepted)).toMatch(/cambio\(s\) aplicados/);
    expect(reviewSummary(items, new Set())).toBe('No aceptaste ningún cambio.');
  });
});
