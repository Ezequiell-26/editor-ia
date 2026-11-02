import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { readyAsset } from '../test/fake-service';
import {
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  ensureDelivery,
  updateAudioMix,
} from './project-actions';
import { applyCriticFixes, critiqueTimeline } from './timeline-critic';

const NOW = '2026-11-02T00:00:00.000Z';

function videoAsset(durationFrames = 900) {
  return readyAsset({
    label: 'Toma',
    source: { type: 'local', path: 'media/toma.mp4' },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  });
}

function projectWithShots(shots: readonly { at: number; frames: number }[]): ProjectDocument {
  const asset = videoAsset();
  let project = addAsset(ensureDelivery(createEmptyProject('Crítica', NOW)), asset);
  for (const shot of shots) {
    project = addClipFromAsset(project, asset, {
      atFrame: shot.at,
      durationFrames: shot.frames,
    }).project;
  }
  return project;
}

describe('critiqueTimeline', () => {
  it('detecta el aire al inicio y lo puede cerrar', () => {
    const project = projectWithShots([{ at: 60, frames: 90 }]);
    const report = critiqueTimeline(project);
    const finding = report.findings.find((item) => item.rule === 'dead-air-start');
    expect(finding).toBeDefined();
    expect(finding!.fix?.kind).toBe('trim-start');
    const fixed = applyCriticFixes(project, report.findings, new Set([finding!.id]));
    const clip = fixed.timeline.clips.find((item) => item.kind === 'video');
    expect(clip?.startFrame).toBe(0);
  });

  it('detecta huecos entre clips de audio', () => {
    const asset = readyAsset({
      kind: 'audio',
      source: { type: 'local', path: 'media/voz.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 600 },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Audio', NOW)), asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 }).project;
    project = addClipFromAsset(project, asset, { atFrame: 150, durationFrames: 90 }).project;
    const report = critiqueTimeline(project);
    expect(report.findings.some((item) => item.rule === 'audio-gap')).toBe(true);
  });

  it('avisa de planos con duraciones muy distintas', () => {
    const project = projectWithShots([
      { at: 0, frames: 10 },
      { at: 10, frames: 200 },
      { at: 210, frames: 10 },
      { at: 220, frames: 200 },
    ]);
    const report = critiqueTimeline(project);
    expect(report.findings.some((item) => item.rule === 'shot-spread')).toBe(true);
  });

  it('marca subtítulos demasiado rápidos', () => {
    const base = projectWithShots([{ at: 0, frames: 120 }]);
    const seeded = addCaptionCue(base, { text: 'base', startFrame: 0, durationFrames: 1 });
    const project = {
      ...seeded.project,
      captions: {
        ...seeded.project.captions,
        cues: [
          {
            id: '00000000-0000-4000-8000-00000000000c',
            trackId: seeded.trackId,
            text: 'x'.repeat(80),
            language: 'es',
            startFrame: 0,
            endFrame: 30,
          },
        ],
      },
    } as ProjectDocument;
    const report = critiqueTimeline(project);
    expect(report.findings.some((item) => item.rule === 'caption-speed')).toBe(true);
  });

  it('detecta la falta de nivelado y lo aplica', () => {
    const project = projectWithShots([{ at: 0, frames: 90 }]);
    const report = critiqueTimeline(project);
    const finding = report.findings.find((item) => item.rule === 'loudness-missing');
    expect(finding?.fix).toEqual({ kind: 'set-loudness', lufs: -14 });
    const fixed = applyCriticFixes(project, report.findings, new Set([finding!.id]));
    expect(fixed.audio.loudnessTarget?.integratedLufs).toBe(-14);
  });

  it('avisa de planos largos y de flashes', () => {
    const long = projectWithShots([{ at: 0, frames: 600 }]);
    expect(critiqueTimeline(long).findings.some((item) => item.rule === 'long-take')).toBe(true);
    const flash = projectWithShots([{ at: 0, frames: 3 }]);
    expect(critiqueTimeline(flash).findings.some((item) => item.rule === 'flash-cut')).toBe(true);
  });

  it('una edición sana saca 100 y no tiene hallazgos', () => {
    let project = projectWithShots([
      { at: 0, frames: 90 },
      { at: 90, frames: 90 },
      { at: 180, frames: 90 },
      { at: 270, frames: 90 },
    ]);
    project = updateAudioMix(project, {
      loudnessTarget: {
        platform: 'youtube',
        integratedLufs: -14,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
    const report = critiqueTimeline(project);
    expect(report.findings).toEqual([]);
    expect(report.score).toBe(100);
  });

  it('sin hallazgos aceptados no toca el proyecto', () => {
    const project = projectWithShots([{ at: 60, frames: 90 }]);
    const report = critiqueTimeline(project);
    expect(applyCriticFixes(project, report.findings, new Set())).toBe(project);
  });
});
