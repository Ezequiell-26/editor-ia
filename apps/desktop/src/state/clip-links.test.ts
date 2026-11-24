import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, addTrack, deleteClip, ensureDelivery, newId, ProjectActionError, rippleDeleteClip } from './project-actions';
import { expandWithLinked, linkClips, linkedClipIds, unlinkClips } from './clip-links';

const NOW = '2026-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): { project: ProjectDocument; videoTrack: string; audioTrack: string } {
  let project = validated(ensureDelivery(createEmptyProject('Links', NOW)));
  const v = addTrack(project, 'video', 'Video');
  project = v.project;
  const a = addTrack(project, 'audio', 'Audio');
  project = a.project;
  return { project, videoTrack: v.trackId, audioTrack: a.trackId };
}

function videoAsset(): Asset {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function audioAsset(): Asset {
  return {
    id: newId(),
    label: 'Voz',
    kind: 'audio',
    source: { type: 'local', path: 'media/voz.wav' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 150 },
  } as Asset;
}

describe('clip links', () => {
  it('links clips under a shared group and expands selections', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;

    const linked = linkClips(next, [v.clipId, a.clipId]);
    const linkedProject = validated(linked.project);
    expect(linked.linkGroup).toBeTruthy();
    expect(linkedClipIds(linkedProject, v.clipId).sort()).toEqual(
      [a.clipId, v.clipId].sort(),
    );
    expect(linkedClipIds(linkedProject, a.clipId).sort()).toEqual(
      [a.clipId, v.clipId].sort(),
    );
    expect(expandWithLinked(linkedProject, [v.clipId])).toEqual(
      expect.arrayContaining([v.clipId, a.clipId]),
    );
  });

  it('unlink removes only the listed clips from the group', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;
    const bAsset = audioAsset();
    next = validated(addAsset(next, bAsset));
    const b = addClipFromAsset(next, bAsset, { trackId: audioTrack, atFrame: 60 });
    next = b.project;

    const linked = linkClips(next, [v.clipId, a.clipId, b.clipId]);
    const unlinked = unlinkClips(linked.project, [a.clipId]);
    const unlinkedProject = validated(unlinked.project);
    expect(unlinked.unlinked).toBe(1);
    expect(linkedClipIds(unlinkedProject, v.clipId).sort()).toEqual(
      [b.clipId, v.clipId].sort(),
    );
    expect(linkedClipIds(unlinkedProject, a.clipId)).toEqual([a.clipId]);
  });

  it('unlink disuelve el grupo cuando queda un solo miembro', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;
    const bAsset = audioAsset();
    next = validated(addAsset(next, bAsset));
    const b = addClipFromAsset(next, bAsset, { trackId: audioTrack, atFrame: 60 });
    next = b.project;

    // Grupo de 3: desvincular 2 deja 1 → el vínculo se disuelve solo.
    const linked = linkClips(next, [v.clipId, a.clipId, b.clipId]);
    const unlinked = unlinkClips(linked.project, [v.clipId, a.clipId]);
    const result = validated(unlinked.project);
    const survivor = result.timeline.clips.find((clip) => clip.id === b.clipId);
    expect(survivor?.linkGroup).toBeUndefined();
    expect(linkedClipIds(result, b.clipId)).toEqual([b.clipId]);
  });

  it('deleteClip disuelve el grupo cuando queda un solo superviviente', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;

    const linked = linkClips(next, [v.clipId, a.clipId]);
    // Borrar un miembro del grupo de 2 deja al otro sin vínculo.
    const result = validated(deleteClip(linked.project, v.clipId));
    const survivor = result.timeline.clips.find((clip) => clip.id === a.clipId);
    expect(survivor?.linkGroup).toBeUndefined();
    expect(linkedClipIds(result, a.clipId)).toEqual([a.clipId]);
    // Borrar un clip sin grupo no toca a nadie.
    const solo = validated(deleteClip(result, a.clipId));
    expect(solo.timeline.clips).toHaveLength(0);
  });

  it('rippleDeleteClip también disuelve el grupo degenerado', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;

    const linked = linkClips(next, [v.clipId, a.clipId]);
    // Simula el ripple de grupo: primero se borra el video; el audio
    // aún existe y NO debe quedar con linkGroup fantasma.
    const afterVideo = validated(rippleDeleteClip(linked.project, v.clipId));
    const survivor = afterVideo.timeline.clips.find((clip) => clip.id === a.clipId);
    expect(survivor?.linkGroup).toBeUndefined();
  });

  it('linkClips es idempotente y disuelve grupos viejos degenerados', () => {
    const { project, videoTrack, audioTrack } = base();
    const vAsset = videoAsset();
    const aAsset = audioAsset();
    let next = validated(addAsset(project, vAsset));
    next = validated(addAsset(next, aAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const a = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 0 });
    next = a.project;
    // Segundo par en la misma pista de audio, más adelante.
    const a2 = addClipFromAsset(next, aAsset, { trackId: audioTrack, atFrame: 100 });
    next = a2.project;

    const first = linkClips(next, [v.clipId, a.clipId]);
    // Re-vincular el mismo grupo no muta el documento.
    const again = linkClips(first.project, [v.clipId, a.clipId]);
    expect(again.project).toBe(first.project);
    expect(again.linkGroup).toBe(first.linkGroup);

    // Sacar `a` del grupo hacia un clip suelto deja a `v` solo en el grupo
    // viejo: su vínculo debe disolverse.
    const moved = linkClips(first.project, [a.clipId, a2.clipId]);
    const orphan = moved.project.timeline.clips.find((clip) => clip.id === v.clipId);
    expect(orphan?.linkGroup).toBeUndefined();
    const pair = moved.project.timeline.clips.filter((clip) =>
      [a.clipId, a2.clipId].includes(clip.id),
    );
    expect(pair.every((clip) => clip.linkGroup === moved.linkGroup)).toBe(true);
  });

  it('rejects linking fewer than two clips and unknown ids', () => {
    const { project, videoTrack } = base();
    const vAsset = videoAsset();
    let next = validated(addAsset(project, vAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    expect(() => linkClips(next, [v.clipId])).toThrow(ProjectActionError);
    expect(() => linkClips(next, [v.clipId, 'no-existe'])).toThrow(ProjectActionError);
  });

  it('unlink on unlinked clips is a no-op', () => {
    const { project, videoTrack } = base();
    const vAsset = videoAsset();
    let next = validated(addAsset(project, vAsset));
    const v = addClipFromAsset(next, vAsset, { trackId: videoTrack, atFrame: 0 });
    next = v.project;
    const result = unlinkClips(next, [v.clipId]);
    expect(result.unlinked).toBe(0);
    expect(result.project).toBe(next);
  });
});
