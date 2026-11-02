import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import { readyAsset } from '../test/fake-service';
import {
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  ensureDelivery,
  updateClip,
} from './project-actions';
import { autoCleanupSummary, runAutoCleanup } from './auto-cleanup';

const NOW = '2026-11-02T00:00:00.000Z';
const FPS = 30;

function peaks(pattern: readonly ('voz' | 'silencio')[]): AudioPeaks {
  return {
    assetId: 'asset',
    durationSeconds: pattern.length * 0.1,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.6, max: 0.6 } : { min: -0.001, max: 0.001 },
    ),
  };
}

const ALL_VOICE = peaks(Array.from({ length: 50 }, () => 'voz' as const));
const WITH_SILENCE = peaks([
  ...Array.from({ length: 30 }, () => 'voz' as const),
  ...Array.from({ length: 20 }, () => 'silencio' as const),
]);

function baseProject(): ProjectDocument {
  return ensureDelivery(createEmptyProject('Limpieza', NOW));
}

function withAudioClip(project: ProjectDocument, frames = 150) {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Voz',
    source: { type: 'local', path: 'media/voz.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  const added = addClipFromAsset(addAsset(project, asset), asset, {
    atFrame: 0,
    durationFrames: frames,
  });
  return { project: added.project, clipId: added.clipId, assetId: asset.id };
}

function withVideoClip(project: ProjectDocument) {
  const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
  const added = addClipFromAsset(addAsset(project, asset), asset, {
    atFrame: 0,
    durationFrames: 150,
  });
  return { project: added.project, clipId: added.clipId };
}

function withPauseCues(project: ProjectDocument, clipId: string): ProjectDocument {
  const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
  const trackId = seeded.trackId;
  return {
    ...seeded.project,
    captions: {
      ...seeded.project.captions,
      cues: [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          trackId,
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
          trackId,
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

describe('runAutoCleanup', () => {
  it('corta silencios medidos por amplitud', async () => {
    const { project } = withAudioClip(baseProject());
    const report = await runAutoCleanup(project, async () => WITH_SILENCE, {
      cutPauses: false,
      denoise: 'off',
      levelAudio: false,
      zoomCuts: false,
    });
    expect(report.silenceCuts).toBeGreaterThan(0);
    expect(report.removedSeconds).toBeGreaterThan(1);
    expect(report.denoised).toBe(0);
    expect(report.zoomed).toBe(0);
  });

  it('corta pausas entre frases usando los subtítulos', async () => {
    const built = withAudioClip(baseProject());
    const project = withPauseCues(built.project, built.clipId);
    const report = await runAutoCleanup(project, async () => ALL_VOICE, {
      cutSilences: false,
      denoise: 'off',
      levelAudio: false,
      zoomCuts: false,
    });
    expect(report.pauseCuts).toBe(1);
    expect(report.silenceCuts).toBe(0);
  });

  it('aplica denoise, nivelado y zoom en los cortes', async () => {
    const { project } = withVideoClip(baseProject());
    const report = await runAutoCleanup(project, async () => ALL_VOICE, {
      cutSilences: false,
      cutPauses: false,
      denoise: 'strong',
      levelAudio: true,
      targetLufs: -14,
      zoomCuts: true,
      zoomIntensity: 0.1,
    });
    expect(report.denoised).toBe(1);
    expect(report.leveled).toBe(true);
    expect(report.zoomed).toBe(1);
    const clip = report.project.timeline.clips.find((item) => item.kind === 'video');
    expect(clip && 'audio' in clip ? clip.audio?.denoise : undefined).toBe(0.6);
    expect(clip && 'motion' in clip ? clip.motion : undefined).toEqual({
      type: 'zoom-in',
      intensity: 0.1,
    });
    expect(report.project.audio.loudnessTarget).toMatchObject({
      platform: 'youtube',
      integratedLufs: -14,
      truePeakDb: -1,
    });
    expect(report.project.audio.master.limiter).toBe(true);
  });

  it('no pisa un movimiento que ya puso el usuario', async () => {
    const built = withVideoClip(baseProject());
    const withMotion = updateClip(built.project, built.clipId, {
      motion: { type: 'pan-left', intensity: 0.2 },
    });
    const report = await runAutoCleanup(withMotion, async () => ALL_VOICE, {
      cutSilences: false,
      cutPauses: false,
      denoise: 'off',
      levelAudio: false,
      zoomCuts: true,
    });
    expect(report.zoomed).toBe(0);
    const clip = report.project.timeline.clips.find((item) => item.kind === 'video');
    expect(clip && 'motion' in clip ? clip.motion?.type : undefined).toBe('pan-left');
  });

  it('respeta las pistas bloqueadas', async () => {
    const { project, clipId } = withVideoClip(baseProject());
    const trackId = project.timeline.clips.find((clip) => clip.id === clipId)!.trackId;
    const locked: ProjectDocument = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) =>
          track.id === trackId ? { ...track, locked: true } : track,
        ),
      },
    };
    const report = await runAutoCleanup(locked, async () => ALL_VOICE, {
      cutSilences: false,
      cutPauses: false,
      denoise: 'medium',
      levelAudio: false,
      zoomCuts: true,
    });
    expect(report.denoised).toBe(0);
    expect(report.zoomed).toBe(0);
    expect(report.project).toEqual(locked);
  });

  it('sin opciones no toca nada y lo resume', async () => {
    const { project } = withAudioClip(baseProject());
    const report = await runAutoCleanup(project, async () => ALL_VOICE, {
      cutSilences: false,
      cutPauses: false,
      denoise: 'off',
      levelAudio: false,
      zoomCuts: false,
    });
    expect(report.project).toBe(project);
    expect(autoCleanupSummary(report)).toBe('No había nada que limpiar.');
  });

  it('resume lo que hizo, con segundos removidos', async () => {
    const { project } = withAudioClip(baseProject());
    const report = await runAutoCleanup(project, async () => WITH_SILENCE, {
      cutPauses: false,
      denoise: 'light',
      levelAudio: true,
      zoomCuts: false,
    });
    const summary = autoCleanupSummary(report);
    expect(summary).toContain('silencio(s)');
    expect(summary).toContain('sin ruido');
    expect(summary).toContain('volumen nivelado');
    expect(summary).toMatch(/s menos/);
  });
});
