import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { buildFolderTimeline } from './folder-timeline';
import { addAsset, addClipFromAsset, newId } from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function base(): ProjectDocument {
  return createEmptyProject('Carpeta', NOW);
}

function imageAsset(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.jpg` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 2048, height: 1365 },
  } as Asset;
}

function audioAsset(label = 'Audio.wav'): Asset {
  return {
    id: newId(),
    label,
    kind: 'audio',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 2, durationFrames: 1800 },
  } as Asset;
}

function withAssets(assets: readonly Asset[]): ProjectDocument {
  return assets.reduce((project, asset) => addAsset(project, asset), base());
}

describe('montaje de una carpeta', () => {
  it('ordena las imágenes numéricamente y arma clips con movimiento y disolvencia', () => {
    const later = imageAsset('Escena 10.jpg');
    const earlier = imageAsset('Escena 2.jpg');
    const audio = audioAsset();
    const project = withAssets([later, earlier, audio]);
    const result = buildFolderTimeline(
      project,
      { images: [later, earlier], videos: [], audio: [audio] },
      { imageFrames: 60, fadeFrames: 8 },
    );
    const clips = result.project.timeline.clips;
    const imageClips = clips.filter((clip) => clip.kind === 'image');
    expect(imageClips.map((clip) => clip.label)).toEqual(['Escena 2', 'Escena 10']);
    expect(imageClips[0]?.durationFrames).toBe(60);
    expect(imageClips[1]?.startFrame).toBe(60);
    expect(imageClips[0]?.kind === 'image' && imageClips[0].motion?.type).toBe('zoom-in');
    expect(imageClips[1]?.kind === 'image' && imageClips[1].motion?.type).toBe('zoom-out');
    expect(imageClips[1]?.kind === 'image' && imageClips[1].transitionIn?.type).toBe(
      'dissolve',
    );
    const audioClips = clips.filter((clip) => clip.kind === 'audio');
    expect(audioClips).toHaveLength(1);
    expect(audioClips[0]?.startFrame).toBe(result.startFrame);
    expect(result.imageCount).toBe(2);
    expect(result.audioCount).toBe(1);
    expect(parseProject(result.project).ok).toBe(true);
  });

  it('agrega el montaje al final sin borrar la timeline existente', () => {
    const existing = imageAsset('Existente.jpg');
    const fresh = imageAsset('Nueva.jpg');
    let project = withAssets([existing, fresh]);
    const placed = addClipFromAsset(project, existing, {
      atFrame: 0,
      durationFrames: 30,
    });
    project = placed.project;
    const result = buildFolderTimeline(
      project,
      { images: [fresh], videos: [], audio: [] },
      { imageFrames: 45, fadeFrames: 0 },
    );
    expect(result.startFrame).toBe(30);
    expect(result.project.timeline.clips).toHaveLength(2);
    const added = result.project.timeline.clips.find((clip) => clip.id === result.firstClipId);
    expect(added?.startFrame).toBe(30);
  });

  it('usa solo el primer audio y avisa de los demás', () => {
    const first = audioAsset('a.wav');
    const second = audioAsset('b.wav');
    const image = imageAsset('A.jpg');
    const project = withAssets([first, second, image]);
    const result = buildFolderTimeline(project, {
      images: [image],
      videos: [],
      audio: [first, second],
    });
    expect(result.audioCount).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/primer audio/i);
  });

  it('rechaza una carpeta sin imágenes ni videos', () => {
    expect(() =>
      buildFolderTimeline(base(), { images: [], videos: [], audio: [audioAsset()] }),
    ).toThrow(/no tiene imágenes ni videos/i);
  });
});
