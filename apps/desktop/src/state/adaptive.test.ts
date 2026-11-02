import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import {
  adaptiveSummary,
  defaultAdaptiveProfile,
  measureAdaptiveProfile,
} from './adaptive';

function peaksAt(floor: number, speech: number): AudioPeaks {
  const buckets = [
    ...Array.from({ length: 20 }, () => floor),
    ...Array.from({ length: 80 }, () => speech),
  ];
  return {
    assetId: 'a',
    durationSeconds: buckets.length * 0.1,
    buckets: buckets.length,
    peaks: buckets.map((amplitude) => ({ min: -amplitude, max: amplitude })),
  };
}

function projectWithShots(seconds: readonly number[]): ProjectDocument {
  const project = createEmptyProject('Adaptativo');
  const fps = 30;
  project.timeline.clips = seconds.map((duration, index) => ({
    id: `clip-${index}`,
    trackId: 'track',
    kind: 'video',
    source: { type: 'asset', assetId: 'asset', inFrame: 0, outFrame: duration * fps },
    startFrame: index * duration * fps,
    durationFrames: Math.round(duration * fps),
  })) as ProjectDocument['timeline']['clips'];
  return project;
}

describe('measureAdaptiveProfile', () => {
  it('en un estudio silencioso pide poca reducción y un umbral bajo', () => {
    const profile = measureAdaptiveProfile(projectWithShots([3]), peaksAt(0.003, 0.5));
    expect(profile.noiseFloorDb).toBeCloseTo(-50.5, 0);
    expect(profile.snrDb).toBeGreaterThan(30);
    expect(profile.denoise).toBe('light');
    expect(profile.silenceThresholdDb).toBeCloseTo(-44.5, 0);
  });

  it('con ruido moderado sube a medio y acerca el umbral al piso', () => {
    const profile = measureAdaptiveProfile(projectWithShots([3]), peaksAt(0.03, 0.25));
    expect(profile.snrDb).toBeGreaterThanOrEqual(18);
    expect(profile.snrDb).toBeLessThan(30);
    expect(profile.denoise).toBe('medium');
    expect(profile.silenceThresholdDb).toBeCloseTo(-24.5, 0);
  });

  it('con mucho ruido pide reducción fuerte y no deja el umbral arriba de -22', () => {
    const profile = measureAdaptiveProfile(projectWithShots([3]), peaksAt(0.1, 0.25));
    expect(profile.denoise).toBe('strong');
    expect(profile.silenceThresholdDb).toBe(-22);
  });

  it('sin picos medibles declara valores conservadores', () => {
    const profile = measureAdaptiveProfile(projectWithShots([3]), null);
    expect(profile).toEqual(defaultAdaptiveProfile());
    expect(profile.reason).toContain('sin picos');
  });

  it('ajusta el zoom a la duración mediana del plano', () => {
    expect(measureAdaptiveProfile(projectWithShots([1, 1, 1]), peaksAt(0.01, 0.5)).zoomIntensity).toBe(0.05);
    expect(measureAdaptiveProfile(projectWithShots([3, 3, 3]), peaksAt(0.01, 0.5)).zoomIntensity).toBe(0.08);
    expect(measureAdaptiveProfile(projectWithShots([8, 8, 8]), peaksAt(0.01, 0.5)).zoomIntensity).toBe(0.12);
  });

  it('resume el perfil para el aviso', () => {
    const profile = measureAdaptiveProfile(projectWithShots([3]), peaksAt(0.01, 0.5));
    expect(adaptiveSummary(profile)).toContain('umbral');
    expect(adaptiveSummary(profile)).toContain('denoise');
    expect(adaptiveSummary(profile)).toContain('LUFS');
  });
});
