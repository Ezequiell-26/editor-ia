import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument, Scene } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  addGeneratedNarration,
  addScene,
  applyScenePlan,
  captionsFromScenes,
  deleteClip,
  ensureDelivery,
  markAssetReady,
  moveClip,
  newId,
  removeAsset,
  splitClip,
  totalFrames,
  trimClip,
  updateCaptionCue,
  updateClip,
  updateProjectSettings,
  updateTrack,
} from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
}

function videoAsset(durationFrames = 300, overrides: Partial<Asset> = {}): Asset {
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
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
    ...overrides,
  } as Asset;
}

function audioAsset(durationFrames = 150): Asset {
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
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

describe('entrega por defecto', () => {
  it('agrega perfiles 16:9 y 9:16, variantes y valida', () => {
    const project = base();
    expect(project.renderProfiles.map((profile) => profile.aspectRatio).sort()).toEqual([
      '16:9',
      '9:16',
    ]);
    expect(project.exportVariants.map((variant) => variant.platform).sort()).toEqual([
      'shorts',
      'youtube',
    ]);
  });

  it('es idempotente y no duplica perfiles', () => {
    const once = base();
    const twice = ensureDelivery(once);
    expect(twice.renderProfiles).toHaveLength(once.renderProfiles.length);
    expect(twice.exportVariants).toHaveLength(once.exportVariants.length);
    validated(twice);
  });
});

describe('biblioteca y timeline', () => {
  it('monta un video listo en una pista nueva y mide en frames', () => {
    const project = base();
    const asset = videoAsset();
    const withAsset = validated(addAsset(project, asset));
    const result = addClipFromAsset(withAsset, asset, { atFrame: 0 });
    const next = validated(result.project);
    const clip = next.timeline.clips[0];
    expect(clip?.kind).toBe('video');
    expect(clip?.startFrame).toBe(0);
    expect(clip?.durationFrames).toBe(300);
    if (clip?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(clip.source.inFrame).toBe(0);
    expect(clip.source.outFrame).toBe(300);
    expect(next.timeline.tracks[0]?.kind).toBe('video');
    expect(totalFrames(next)).toBe(300);
  });

  it('no monta material sin derechos confirmados', () => {
    const project = base();
    const asset = audioAsset();
    const unverified = { ...asset, status: 'unverified' as const } as Asset;
    expect(() => addClipFromAsset(project, unverified, {})).toThrow(ProjectActionError);
  });

  it('empuja el segundo clip a un hueco y no permite superposición', () => {
    const project = base();
    const asset = videoAsset();
    const a = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const b = addClipFromAsset(a.project, asset, { atFrame: 0 });
    const clip = b.project.timeline.clips.find((item) => item.id === b.clipId);
    expect(clip?.startFrame).toBe(300);
    validated(b.project);
    expect(moveClip(b.project, b.clipId, 100)).toBeNull();
    const moved = moveClip(b.project, b.clipId, 400);
    expect(moved).not.toBeNull();
    validated(moved as ProjectDocument);
  });

  it('recorta el inicio y el final conservando la identidad de timing', () => {
    const project = base();
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const startTrimmed = trimClip(added.project, added.clipId, 'start', 30);
    expect(startTrimmed).not.toBeNull();
    const startClip = startTrimmed?.timeline.clips[0];
    if (startClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(startClip.startFrame).toBe(30);
    expect(startClip.durationFrames).toBe(270);
    expect(startClip.source.inFrame).toBe(30);
    expect(startClip.source.outFrame).toBe(300);
    validated(startTrimmed as ProjectDocument);

    const endTrimmed = trimClip(startTrimmed as ProjectDocument, added.clipId, 'end', 180);
    expect(endTrimmed).not.toBeNull();
    const endClip = endTrimmed?.timeline.clips[0];
    if (endClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(endClip.durationFrames).toBe(150);
    expect(endClip.source.outFrame).toBe(180);
    validated(endTrimmed as ProjectDocument);

    expect(trimClip(endTrimmed as ProjectDocument, added.clipId, 'end', 999)).toBeNull();
    const oneFrame = trimClip(endTrimmed as ProjectDocument, added.clipId, 'start', 500);
    expect(oneFrame?.timeline.clips[0]?.durationFrames).toBe(1);
    validated(oneFrame as ProjectDocument);
  });

  it('divide un clip en playhead con ventanas de origen exactas', () => {
    const project = base();
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const split = splitClip(added.project, added.clipId, 120);
    expect(split).not.toBeNull();
    const next = validated(split?.project as ProjectDocument);
    expect(next.timeline.clips).toHaveLength(2);
    const left = next.timeline.clips.find((clip) => clip.id === added.clipId);
    const right = next.timeline.clips.find((clip) => clip.id === split?.rightClipId);
    expect(left?.durationFrames).toBe(120);
    expect(right?.startFrame).toBe(120);
    expect(right?.durationFrames).toBe(180);
    if (left?.kind !== 'video' || right?.kind !== 'video') throw new Error('se esperaba video');
    expect(left.source.outFrame).toBe(120);
    expect(right.source.inFrame).toBe(120);
    expect(right.source.outFrame).toBe(300);
  });

  it('borra un clip y lo quita de las escenas', () => {
    const project = base();
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const scene: Scene = {
      id: newId(),
      order: 0,
      title: 'Escena',
      intent: 'hook',
      status: 'draft',
      narration: { text: 'Hola', estimatedDurationFrames: 30 },
      clipIds: [added.clipId],
    };
    const withScene = validated({ ...added.project, scenes: [scene] });
    const deleted = validated(deleteClip(withScene, added.clipId));
    expect(deleted.timeline.clips).toHaveLength(0);
    expect(deleted.scenes[0]?.clipIds).toEqual([]);
  });

  it('una pista bloqueada rechaza montar, mover, recortar, dividir, borrar y editar', () => {
    const project = base();
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const locked = validated(updateTrack(added.project, added.trackId, { locked: true }));
    expect(() => addClipFromAsset(locked, asset, { trackId: added.trackId })).toThrow(ProjectActionError);
    expect(moveClip(locked, added.clipId, 10)).toBeNull();
    expect(trimClip(locked, added.clipId, 'end', 200)).toBeNull();
    expect(splitClip(locked, added.clipId, 60)).toBeNull();
    expect(() => deleteClip(locked, added.clipId)).toThrow(ProjectActionError);
    expect(() => updateClip(locked, added.clipId, { label: 'otro' })).toThrow(ProjectActionError);
    const newTrack = addClipFromAsset(locked, asset, { atFrame: 400 });
    const next = validated(newTrack.project);
    expect(next.timeline.tracks.filter((track) => track.kind === 'video')).toHaveLength(2);
  });

  it('no quita un material en uso', () => {
    const project = base();
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    expect(() => removeAsset(added.project, asset.id)).toThrow(ProjectActionError);
  });
});

describe('subtítulos', () => {
  it('crea pista, estilo y cue; el segundo cue busca un hueco', () => {
    const project = base();
    const first = addCaptionCue(project, { text: 'Hola', startFrame: 0, durationFrames: 90 });
    const second = addCaptionCue(first.project, { text: 'Mundo', startFrame: 0, durationFrames: 90 });
    const next = validated(second.project);
    expect(next.timeline.tracks.filter((track) => track.kind === 'caption')).toHaveLength(1);
    expect(next.captions.styles).toHaveLength(1);
    expect(next.captions.cues).toHaveLength(2);
    const cueTwo = next.captions.cues.find((cue) => cue.id === second.cueId);
    expect(cueTwo?.startFrame).toBe(90);
    expect(next.captions.cues.every((cue) => cue.styleId)).toBe(true);
  });

  it('rechaza un subtítulo superpuesto', () => {
    const project = base();
    const first = addCaptionCue(project, { text: 'Hola', startFrame: 0, durationFrames: 90 });
    expect(() =>
      updateCaptionCue(first.project, first.cueId, { endFrame: 120 }),
    ).not.toThrow();
    const second = addCaptionCue(first.project, { text: 'Mundo', startFrame: 90, durationFrames: 90 });
    expect(() =>
      updateCaptionCue(second.project, first.cueId, { endFrame: 120 }),
    ).toThrow(ProjectActionError);
  });

  it('genera subtítulos desde las escenas y valida', () => {
    const project = base();
    const withScenes = validated(
      applyScenePlan(project, {
        title: 'Guion',
        providerId: 'mock',
        model: 'mock',
        simulated: true,
        costApproved: true,
        scenes: [
          {
            id: newId(),
            title: 'Uno',
            intent: 'hook' as const,
            narration: 'Primera frase de la escena.',
            visual: '',
            estimatedSeconds: 4,
          },
          {
            id: newId(),
            title: 'Dos',
            intent: 'outro' as const,
            narration: 'Segunda frase de la escena.',
            visual: '',
            estimatedSeconds: 5,
          },
        ],
      }),
    );
    const captions = validated(captionsFromScenes(withScenes));
    expect(captions.captions.cues).toHaveLength(2);
    expect(captions.captions.cues[0]?.text).toContain('Primera');
  });
});

describe('guion y ajustes', () => {
  it('aplica escenas y registra la operación en provenance', () => {
    const project = base();
    const next = validated(
      applyScenePlan(project, {
        title: 'Plan de prueba',
        providerId: 'mock',
        model: 'mock',
        simulated: true,
        costApproved: true,
        scenes: [
          {
            id: newId(),
            title: 'Gancho',
            intent: 'hook',
            narration: 'Una pregunta que engancha.',
            visual: 'Plano de la persona.',
            estimatedSeconds: 6,
          },
        ],
      }),
    );
    expect(next.scenes).toHaveLength(1);
    expect(next.scenes[0]?.status).toBe('draft');
    expect(next.provenance.operations).toHaveLength(1);
    expect(next.provenance.operations[0]?.role).toBe('scriptwriter');
    expect(next.provenance.operations[0]?.appliedStatus).toBe('applied');
  });

  it('agrega escenas manuales con orden único', () => {
    const project = base();
    const first = addScene(project, {
      title: 'Uno',
      intent: 'hook',
      narration: 'Narración uno',
    });
    const second = addScene(first.project, {
      title: 'Dos',
      intent: 'outro',
      narration: 'Narración dos',
    });
    const next = validated(second.project);
    expect(next.scenes.map((scene) => scene.order)).toEqual([0, 1]);
  });

  it('cambia el nombre y las dimensiones del proyecto', () => {
    const project = base();
    const next = validated(
      updateProjectSettings(project, { name: 'Nuevo nombre', width: 1080, height: 1920 }),
    );
    expect(next.name).toBe('Nuevo nombre');
    expect(next.video.width).toBe(1080);
    expect(next.video.height).toBe(1920);
  });

  it('marca derechos y valida el esquema', () => {
    const project = base();
    const asset = audioAsset();
    const unverified = {
      ...asset,
      status: 'unverified' as const,
      rights: {
        ...asset.rights,
        license: { id: 'unknown', commercialUse: 'unknown' as const },
      },
    } as Asset;
    const added = validated(addAsset(project, unverified));
    const ready = validated(markAssetReady(added, unverified.id, 'requires-attribution'));
    const stored = ready.assets.find((item) => item.id === unverified.id);
    expect(stored?.status).toBe('ready');
    expect(stored?.rights.license.commercialUse).toBe('requires-attribution');
    expect(stored?.rights.license.attributionText).toContain('Atribución');
  });

  it('monta una narración generada sólo cuando los derechos están confirmados', () => {
    const project = base();
    const scene = addScene(project, {
      title: 'Escena con voz',
      intent: 'explainer',
      narration: 'Texto que se narra.',
    });
    const withScene = validated(scene.project);
    const candidate = {
      ...audioAsset(90),
      status: 'unverified' as const,
      source: {
        type: 'generated' as const,
        provider: { id: 'windows-sapi', model: 'Microsoft Sabina' },
        path: 'media/narracion.wav',
        generatedAt: NOW,
      },
      rights: {
        license: { id: 'unknown', commercialUse: 'unknown' as const },
        provenance: { origin: 'generated-locally' as const, acquiredAt: NOW },
      },
    } as Asset;

    const mounted = addGeneratedNarration(withScene, candidate, scene.sceneId, {
      confirmRights: true,
      atFrame: 0,
      label: 'Narración — Escena con voz',
    });
    expect(mounted.clipId).not.toBeNull();
    const next = validated(mounted.project);
    const stored = next.assets.find((item) => item.id === candidate.id);
    expect(stored?.status).toBe('ready');
    expect(stored?.label).toBe('Narración — Escena con voz');
    expect(next.scenes[0]?.narration.assetId).toBe(candidate.id);
    expect(next.timeline.clips.some((clip) => clip.id === mounted.clipId)).toBe(true);
    expect(next.timeline.tracks.some((track) => track.kind === 'narration')).toBe(true);

    const noRights = addGeneratedNarration(withScene, { ...candidate, id: newId() }, scene.sceneId, {
      confirmRights: false,
      atFrame: 0,
    });
    expect(noRights.clipId).toBeNull();
    const noRightsProject = validated(noRights.project);
    expect(noRightsProject.assets.length).toBe(withScene.assets.length + 1);
    expect(noRightsProject.timeline.clips).toHaveLength(0);
  });
});
