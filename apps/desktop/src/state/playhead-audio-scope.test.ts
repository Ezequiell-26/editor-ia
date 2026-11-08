import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
  setClipSpeed,
  updateClip,
} from './project-actions';
import { readyAsset } from '../test/fake-service';
import {
  audioScopeAtPlayhead,
  audioScopeCandidatesAtPlayhead,
  SCOPE_WINDOW_SECONDS,
} from './playhead-audio-scope';

const NOW = '2026-10-24T00:00:00.000Z';

function projectWithClip(options: {
  kind?: 'audio';
  atFrame?: number;
  durationFrames?: number;
  inFrame?: number;
  mediaDurationFrames?: number;
} = {}) {
  let project = ensureDelivery(createEmptyProject('Scopes', NOW));
  const track = addTrack(project, options.kind ?? 'audio', 'Pista');
  const asset = readyAsset({
    label: 'Material',
    kind: 'audio',
    source: { type: 'local', path: 'media/material.wav' },
    media: {
      sampleRate: 48_000,
      channels: 1,
      durationFrames: options.mediaDurationFrames ?? 300,
    },
  });
  project = addAsset(track.project, asset);
  const added = addClipFromAsset(project, asset, {
    trackId: track.trackId,
    atFrame: options.atFrame ?? 0,
    durationFrames: options.durationFrames ?? 300,
    inFrame: options.inFrame ?? 0,
  });
  return { project: added.project, clipId: added.clipId, assetId: asset.id };
}

describe('audioScopeAtPlayhead', () => {
  it('devuelve null cuando el playhead no cae sobre ningún clip', () => {
    const { project } = projectWithClip({ durationFrames: 90 });
    expect(audioScopeAtPlayhead(project, 500)).toBeNull();
    expect(audioScopeCandidatesAtPlayhead(project, 500)).toEqual([]);
  });

  it('mapea el frame del playhead al segundo del asset (fps 30)', () => {
    const { project } = projectWithClip({ durationFrames: 300 });
    const target = audioScopeAtPlayhead(project, 150);
    expect(target).not.toBeNull();
    // Frame local 150 → frame de asset 150 → 5 s al centro de la ventana.
    expect(target!.centerSeconds).toBeCloseTo(5, 5);
    expect(target!.startSeconds).toBeCloseTo(2.5, 5);
    expect(target!.durationSeconds).toBeCloseTo(SCOPE_WINDOW_SECONDS, 5);
  });

  it('respeta inFrame del clip y el inicio del asset', () => {
    const { project } = projectWithClip({ durationFrames: 90, inFrame: 60 });
    const target = audioScopeAtPlayhead(project, 0);
    expect(target!.centerSeconds).toBeCloseTo(2, 5);
    // Ventana [max(0, 2-2.5), 2+2.5] → start 0, duration 4.5.
    expect(target!.startSeconds).toBe(0);
    expect(target!.durationSeconds).toBeCloseTo(4.5, 5);
  });

  it('acota la ventana al final medido del asset', () => {
    // Asset de 300 frames a 30 fps = 10 s; playhead en el último frame →
    // centro 9.97 s, la ventana no puede pasar de 10 s.
    const { project } = projectWithClip({ durationFrames: 300 });
    const target = audioScopeAtPlayhead(project, 299);
    expect(target!.centerSeconds).toBeCloseTo(299 / 30, 5);
    expect(target!.startSeconds + target!.durationSeconds).toBeLessThanOrEqual(10.0001);
  });

  it('ordena los clips solapados de arriba hacia abajo por orden de pista', () => {
    let project = ensureDelivery(createEmptyProject('Overlap', NOW));
    const lower = addTrack(project, 'audio', 'Bajo');
    const upper = addTrack(lower.project, 'audio', 'Alto');
    const assetA = readyAsset({
      label: 'A',
      kind: 'audio',
      source: { type: 'local', path: 'media/a.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 600 },
    });
    const assetB = readyAsset({
      label: 'B',
      kind: 'audio',
      source: { type: 'local', path: 'media/b.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 600 },
    });
    project = addAsset(upper.project, assetA);
    project = addAsset(project, assetB);
    const low = addClipFromAsset(project, assetA, {
      trackId: lower.trackId,
      atFrame: 0,
      durationFrames: 300,
    });
    const high = addClipFromAsset(low.project, assetB, {
      trackId: upper.trackId,
      atFrame: 0,
      durationFrames: 300,
    });
    const candidates = audioScopeCandidatesAtPlayhead(high.project, 100);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.clipId).toBe(high.clipId);
    expect(candidates[1]!.clipId).toBe(low.clipId);
    expect(candidates[0]!.assetId).toBe(assetB.id);
  });

  it('duplica el paso al fuente con speed 2x', () => {
    const { project, clipId } = projectWithClip({ durationFrames: 150 });
    // 2x: la ventana de 150 frames de asset queda en 75 frames de timeline.
    const sped = setClipSpeed(project, clipId, 2);
    const target = audioScopeAtPlayhead(sped, 50);
    // local 50 → sourceFrame 100 → 100/30 ≈ 3,333 s.
    expect(target!.centerSeconds).toBeCloseTo(100 / 30, 3);
  });

  it('ignora clips deshabilitados y fuentes sin ventana', () => {
    const { project, clipId } = projectWithClip({ durationFrames: 90 });
    const disabled = updateClip(project, clipId, { enabled: false });
    expect(audioScopeAtPlayhead(disabled, 10)).toBeNull();
  });
});
