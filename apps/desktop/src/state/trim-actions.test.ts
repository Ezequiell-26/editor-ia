import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  newId,
  rollClip,
  setClipSpeed,
  setTransformKeyframe,
  slideClip,
  slipClip,
} from './project-actions';

const NOW = '2026-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function videoAsset(durationFrames = 300): Asset {
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
    media: {
      width: 1920,
      height: 1080,
      durationFrames,
      frameRate: { num: 30, den: 1 },
    },
  } as Asset;
}

function threeAdjacentClips(options: { followingAt?: number } = {}): {
  project: ProjectDocument;
  ids: [string, string, string];
} {
  const asset = videoAsset();
  let project = addAsset(ensureDelivery(createEmptyProject('Recorte', NOW)), asset);
  const previous = addClipFromAsset(project, asset, {
    atFrame: 0,
    inFrame: 0,
    outFrame: 30,
  });
  project = previous.project;
  const middle = addClipFromAsset(project, asset, {
    atFrame: 30,
    inFrame: 30,
    outFrame: 60,
  });
  project = middle.project;
  const following = addClipFromAsset(project, asset, {
    atFrame: options.followingAt ?? 60,
    inFrame: 60,
    outFrame: 90,
  });
  project = validated(following.project);
  return {
    project,
    ids: [previous.clipId, middle.clipId, following.clipId],
  };
}

function sourceOf(project: ProjectDocument, clipId: string) {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new Error('clip ventana ausente');
  }
  return clip.source;
}

describe('slip', () => {
  it('mueve la ventana de origen sin mover el clip ni a los vecinos', () => {
    const { project, ids } = threeAdjacentClips();
    const after = validated(slipClip(project, ids[1]!, 10));
    const clip = after.timeline.clips.find((item) => item.id === ids[1]);
    expect(clip?.startFrame).toBe(30);
    expect(clip?.durationFrames).toBe(30);
    expect(sourceOf(after, ids[1]!)).toMatchObject({ inFrame: 40, outFrame: 70 });
    expect(sourceOf(after, ids[0]!)).toMatchObject({ inFrame: 0, outFrame: 30 });
  });

  it('rechaza un slip fuera de la ventana del material', () => {
    const { project, ids } = threeAdjacentClips();
    expect(() => slipClip(project, ids[1]!, -40)).toThrow(ProjectActionError);
  });

  it('exige velocidad 1×', () => {
    const { project, ids } = threeAdjacentClips();
    const retimed = validated(setClipSpeed(project, ids[1]!, 2));
    expect(() => slipClip(retimed, ids[1]!, 1)).toThrow(ProjectActionError);
  });
});

describe('slide', () => {
  it('mueve el clip y reparte la diferencia entre los vecinos', () => {
    const { project, ids } = threeAdjacentClips();
    const after = validated(slideClip(project, ids[1]!, 10));
    const [previous, middle, following] = ids.map((id) =>
      after.timeline.clips.find((item) => item.id === id),
    );
    expect(previous?.durationFrames).toBe(40);
    expect(sourceOf(after, ids[0]!)).toMatchObject({ inFrame: 0, outFrame: 40 });
    expect(middle?.startFrame).toBe(40);
    expect(middle?.durationFrames).toBe(30);
    expect(sourceOf(after, ids[1]!)).toMatchObject({ inFrame: 30, outFrame: 60 });
    expect(following?.startFrame).toBe(70);
    expect(following?.durationFrames).toBe(20);
    expect(sourceOf(after, ids[2]!)).toMatchObject({ inFrame: 70, outFrame: 90 });
  });

  it('funciona hacia la izquierda y conserva el fin de la pista', () => {
    const { project, ids } = threeAdjacentClips();
    const after = validated(slideClip(project, ids[1]!, -10));
    const previous = after.timeline.clips.find((item) => item.id === ids[0]);
    const middle = after.timeline.clips.find((item) => item.id === ids[1]);
    const following = after.timeline.clips.find((item) => item.id === ids[2]);
    expect(previous?.durationFrames).toBe(20);
    expect(middle?.startFrame).toBe(20);
    expect(following?.startFrame).toBe(50);
    expect(following?.durationFrames).toBe(40);
    expect(sourceOf(after, ids[2]!)).toMatchObject({ inFrame: 50, outFrame: 90 });
    expect((following?.startFrame ?? 0) + (following?.durationFrames ?? 0)).toBe(90);
  });

  it('rechaza huecos entre los clips', () => {
    const { project, ids } = threeAdjacentClips({ followingAt: 100 });
    expect(() => slideClip(project, ids[1]!, 1)).toThrow(ProjectActionError);
  });

  it('rechaza keyframes en los clips afectados', () => {
    const { project, ids } = threeAdjacentClips();
    const animated = validated(
      setTransformKeyframe(project, ids[1]!, 0, { scale: 1.1 }),
    );
    expect(() => slideClip(animated, ids[1]!, 1)).toThrow(ProjectActionError);
  });
});

describe('roll', () => {
  it('mueve el corte de salida sin mover los bordes exteriores', () => {
    const { project, ids } = threeAdjacentClips();
    const after = validated(rollClip(project, ids[1]!, 'out', 10));
    const middle = after.timeline.clips.find((item) => item.id === ids[1]);
    const following = after.timeline.clips.find((item) => item.id === ids[2]);
    expect(middle?.startFrame).toBe(30);
    expect(middle?.durationFrames).toBe(40);
    expect(sourceOf(after, ids[1]!)).toMatchObject({ inFrame: 30, outFrame: 70 });
    expect(following?.startFrame).toBe(70);
    expect(following?.durationFrames).toBe(20);
    expect(sourceOf(after, ids[2]!)).toMatchObject({ inFrame: 70, outFrame: 90 });
  });

  it('mueve el corte de entrada con el clip anterior', () => {
    const { project, ids } = threeAdjacentClips();
    const after = validated(rollClip(project, ids[1]!, 'in', 10));
    const previous = after.timeline.clips.find((item) => item.id === ids[0]);
    const middle = after.timeline.clips.find((item) => item.id === ids[1]);
    expect(previous?.durationFrames).toBe(40);
    expect(sourceOf(after, ids[0]!)).toMatchObject({ inFrame: 0, outFrame: 40 });
    expect(middle?.startFrame).toBe(40);
    expect(middle?.durationFrames).toBe(20);
    expect(sourceOf(after, ids[1]!)).toMatchObject({ inFrame: 40, outFrame: 60 });
  });

  it('rechaza un roll fuera de la ventana del material', () => {
    const { project, ids } = threeAdjacentClips();
    expect(() => rollClip(project, ids[0]!, 'out', 300)).toThrow(ProjectActionError);
  });
});
