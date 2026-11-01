import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery, newId } from '../../state/project-actions';
import { applyFolderFilm } from './apply-folder-film';
import { planFolderFilm } from './folder-film';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

function imageAsset(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.jpg` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 20_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1600, height: 900 },
  } as Asset;
}

function audioAsset(): Asset {
  return {
    id: newId(),
    label: 'voz-narracion',
    kind: 'audio',
    source: { type: 'local', path: 'media/voz.wav' },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 30_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { durationFrames: 300, sampleRate: 48_000, channels: 2 },
  } as Asset;
}

describe('aplicar un video desde carpeta', () => {
  it('monta las imágenes con Ken Burns y la voz en la pista de narración', () => {
    const photos = [imageAsset('Playa'), imageAsset('Ciudad')];
    const voice = audioAsset();
    let project = validated(ensureDelivery(createEmptyProject('Desde carpeta', NOW)));
    project = photos.reduce((current, asset) => addAsset(current, asset), project);
    project = addAsset(project, voice);

    const plan = planFolderFilm({
      images: photos.map((asset) => ({ assetId: asset.id, label: asset.label })),
      audio: { assetId: voice.id, durationFrames: 300 },
      silences: [],
      fps: 30,
    });
    const assetsById = new Map(
      [...photos, voice].map((asset) => [asset.id, asset] as const),
    );
    const applied = applyFolderFilm(project, plan, assetsById);
    const result = validated(applied.project);

    expect(applied.clipIds).toHaveLength(2);
    const imageClips = result.timeline.clips.filter((clip) => clip.kind === 'image');
    expect(imageClips).toHaveLength(2);
    expect(imageClips[0]).toMatchObject({ startFrame: 0, durationFrames: 150 });
    expect(imageClips[1]).toMatchObject({ startFrame: 150, durationFrames: 150 });
    expect(imageClips[0]?.motion).toBeDefined();
    expect(imageClips[1]?.transitionIn).toMatchObject({ type: 'dissolve' });

    expect(applied.audioClipId).toBeTruthy();
    const audioClip = result.timeline.clips.find((clip) => clip.id === applied.audioClipId);
    expect(audioClip?.kind).toBe('audio');
    const track = result.timeline.tracks.find((item) => item.id === audioClip?.trackId);
    expect(track?.kind).toBe('narration');
    expect(audioClip).toMatchObject({ startFrame: 0, durationFrames: 300 });
  });
});
