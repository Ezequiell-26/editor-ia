import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, addTrack, ensureDelivery, updateTrack } from './project-actions';
import { readyAsset } from '../test/fake-service';
import { applyMorphCutsToAll, morphCutCandidates } from './morph-cuts';

const FPS = 30;
const NOW = '2026-11-23T00:00:00.000Z';

function projectWithCuts(): { project: ProjectDocument; clipIds: string[] } {
  const asset = readyAsset({
    kind: 'video',
    label: 'Toma',
    source: { type: 'local', path: 'media/toma.mp4' },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 900,
      frameRate: { num: FPS, den: 1 },
    },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Morph', NOW)), asset);
  const clipIds: string[] = [];
  // Tres clips contiguos de 90 frames cada uno (3 s), ventanas distintas
  // del mismo asset para que haya handles de audio en los cortes.
  const windows: [number, number][] = [
    [30, 120],
    [300, 390],
    [600, 690],
  ];
  windows.forEach(([inFrame, outFrame], index) => {
    const added = addClipFromAsset(project, asset, {
      atFrame: index * 90,
      inFrame,
      outFrame,
    });
    project = added.project;
    clipIds.push(added.clipId);
  });
  return { project, clipIds };
}

describe('morphCutCandidates', () => {
  it('encuentra los dos cortes entre tres clips contiguos', () => {
    const { project } = projectWithCuts();
    const candidates = morphCutCandidates(project);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.outgoingClipId).not.toBe(candidates[0]!.incomingClipId);
  });

  it('ignora pistas bloqueadas', () => {
    const { project } = projectWithCuts();
    const trackId = project.timeline.clips[0]!.trackId;
    const locked = updateTrack(project, trackId, { locked: true });
    expect(morphCutCandidates(locked)).toHaveLength(0);
  });
});

describe('applyMorphCutsToAll', () => {
  it('aplica morph cut en los dos cortes y el proyecto sigue válido', () => {
    const { project } = projectWithCuts();
    const result = applyMorphCutsToAll(project, { frames: 8 });
    expect(result.applied.length).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(parseProject(result.project).ok).toBe(true);
    // Cada morph cut agrega hasta 2 clips de audio (J + L del par).
    const audioClips = result.project.timeline.clips.filter((c) => c.kind === 'audio');
    expect(audioClips.length).toBeGreaterThanOrEqual(2);
  });

  it('acota por clipIds cuando se pide', () => {
    const { project, clipIds } = projectWithCuts();
    const result = applyMorphCutsToAll(project, { frames: 8, clipIds: [clipIds[2]!] });
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.incomingClipId).toBe(clipIds[2]);
  });

  it('reporta failed cuando ningún lado tiene handle de audio', () => {
    // Sin handles en ningún lado: el saliente llega al fin del material
    // (outFrame=200) y el entrante arranca en inFrame=0 → applyMorphCut
    // lanza y el lote lo reporta en `failed` sin frenar el resto.
    const asset = readyAsset({
      kind: 'video',
      label: 'Toma',
      source: { type: 'local', path: 'media/toma.mp4' },
      media: {
        width: 1920,
        height: 1080,
        durationFrames: 200,
        frameRate: { num: FPS, den: 1 },
      },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Morph', NOW)), asset);
    const first = addClipFromAsset(project, asset, {
      atFrame: 0,
      inFrame: 100,
      outFrame: 200,
    });
    project = first.project;
    const second = addClipFromAsset(project, asset, {
      atFrame: 100,
      inFrame: 0,
      outFrame: 100,
    });
    project = second.project;
    const result = applyMorphCutsToAll(project, { frames: 8 });
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain('fotogramas de audio');
  });

  it('funciona en clips de audio puros (música/narración)', () => {
    const asset = readyAsset({
      kind: 'audio',
      label: 'Música',
      source: { type: 'local', path: 'media/musica.wav' },
      media: { sampleRate: 48_000, channels: 2, durationFrames: 900 },
    });
    let project = addAsset(ensureDelivery(createEmptyProject('Morph', NOW)), asset);
    const audioTrack = addTrack(project, 'audio', 'Música').project;
    project = audioTrack;
    const first = addClipFromAsset(project, asset, {
      atFrame: 0,
      inFrame: 60,
      outFrame: 300,
    });
    project = first.project;
    const second = addClipFromAsset(project, asset, {
      atFrame: 240,
      inFrame: 400,
      outFrame: 700,
    });
    project = second.project;
    const result = applyMorphCutsToAll(project, { frames: 8 });
    expect(result.applied).toHaveLength(1);
    expect(parseProject(result.project).ok).toBe(true);
    const jCut = result.applied[0]!.jCutFrames;
    const lCut = result.applied[0]!.lCutFrames;
    expect(jCut + lCut).toBeGreaterThan(0);
  });
});
