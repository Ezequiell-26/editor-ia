import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument, Scene } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { TITLE_TEMPLATES } from './title-templates';
import {
  ProjectActionError,
  addAdjustmentLayer,
  addAsset,
  addCaptionCue,
  addTitleCue,
  addTitleFromTemplate,
  applyCompression,
  applySpeedCurve,
  applySpeedRamp,
  applyProfileFit,
  compressionPresetOf,
  addTranscriptionCues,
  addClipFromAsset,
  addGeneratedNarration,
  addScene,
  applyScenePlan,
  captionsFromScenes,
  captureTransformKeyframe,
  clipTransformAtFrame,
  deleteClip,
  duplicateClip,
  ensureDelivery,
  markAssetReady,
  moveClip,
  newId,
  removeAsset,
  setClipSpeed,
  setClipStabilization,
  setAssetProxy,
  pasteClip,
  rippleDeleteClip,
  setMaskKeyframe,
  setTransformKeyframe,
  splitClip,
  splitClipAtFrames,
  splitTrackAtFrames,
  removeMaskKeyframe,
  clearMaskKeyframes,
  totalFrames,
  trimClip,
  updateCaptionCue,
  updateClip,
  updateAudioMix,
  updateProjectLook,
  setProjectLook,
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

function imageAsset(width = 1024, height = 1024): Asset {
  return {
    id: newId(),
    label: 'Imagen',
    kind: 'image',
    source: { type: 'local', path: 'media/imagen.png' },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 8_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width, height },
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
  it('agrega perfiles 16:9, 9:16 y 1:1, variantes y valida', () => {
    const project = base();
    expect(project.renderProfiles.map((profile) => profile.aspectRatio).sort()).toEqual([
      '16:9',
      '1:1',
      '9:16',
    ]);
    expect(project.exportVariants.map((variant) => variant.platform).sort()).toEqual([
      'other',
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

describe('proxy de video', () => {
  it('asigna y quita un proxy solo en videos', () => {
    const asset = videoAsset();
    const project = addAsset(base(), asset);
    const proxy = {
      path: 'media/proxies/proxy-1.mp4',
      width: 854,
      height: 480,
      bytes: 120_000,
    };

    const withProxy = validated(setAssetProxy(project, asset.id, proxy));
    expect(
      (withProxy.assets.find((item) => item.id === asset.id) as { proxy?: typeof proxy } | undefined)
        ?.proxy,
    ).toEqual(proxy);

    const without = validated(setAssetProxy(withProxy, asset.id, undefined));
    expect(
      (without.assets.find((item) => item.id === asset.id) as { proxy?: unknown } | undefined)
        ?.proxy,
    ).toBeUndefined();

    const image = imageAsset();
    const imageProject = addAsset(base(), image);
    expect(() => setAssetProxy(imageProject, image.id, proxy)).toThrow(ProjectActionError);
  });
});

describe('rampa de velocidad', () => {
  it('divide en tres tramos contiguos y conserva duración y ventana de origen', () => {
    const asset = videoAsset(300);
    const project = addAsset(base(), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 300 });

    const result = applySpeedRamp(added.project, added.clipId, { from: 2, to: 0.5 });
    const next = validated(result.project);
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === added.trackId)
      .sort((a, b) => a.startFrame - b.startFrame);

    expect(clips).toHaveLength(3);
    expect(result.clipIds).toHaveLength(3);
    expect(clips.map((clip) => clip.id)).toEqual(result.clipIds);
    expect(clips.reduce((sum, clip) => sum + clip.durationFrames, 0)).toBe(300);
    expect(
      clips.reduce(
        (sum, clip) =>
          sum +
          (clip.kind === 'video' || clip.kind === 'audio'
            ? clip.source.outFrame - clip.source.inFrame
            : 0),
        0,
      ),
    ).toBe(300);
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      expect(clips[index]!.startFrame).toBe(previous.startFrame + previous.durationFrames);
    }
    const speedOf = (clip: (typeof clips)[number]) =>
      clip.kind === 'video' || clip.kind === 'audio'
        ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1)
        : 1;
    expect(speedOf(clips[0]!)).toBeGreaterThan(speedOf(clips[2]!));
    expect(result.speeds).toHaveLength(3);
  });

  it('rechaza rampas con keyframes, Ken Burns o un rango inválido', () => {
    const asset = videoAsset(300);
    let project = addAsset(base(), asset);
    const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 300 });
    const animated = setTransformKeyframe(added.project, added.clipId, 0, { scale: 1.2 });
    expect(() => applySpeedRamp(animated, added.clipId, { from: 2, to: 0.5 })).toThrow(
      ProjectActionError,
    );

    const withMotion = updateClip(added.project, added.clipId, {
      motion: { type: 'zoom-in', intensity: 0.1 },
    });
    expect(() => applySpeedRamp(withMotion, added.clipId, { from: 2, to: 0.5 })).toThrow(
      ProjectActionError,
    );
    expect(() => applySpeedRamp(added.project, added.clipId, { from: 9, to: 0.5 })).toThrow(
      ProjectActionError,
    );
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

  it('crea una pista de títulos separada con estilo centrado', () => {
    const project = base();
    const caption = addCaptionCue(project, { text: 'Subtítulo', startFrame: 0, durationFrames: 90 });
    const title = addTitleCue(caption.project, {
      text: 'Título grande',
      startFrame: 0,
      durationFrames: 60,
    });
    const next = validated(title.project);
    const titleTrack = next.timeline.tracks.find((track) => track.id === title.trackId);
    const style = next.captions.styles.find((item) => item.id === title.styleId);
    const titleCue = next.captions.cues.find((cue) => cue.id === title.cueId);

    expect(titleTrack?.label).toBe('Títulos');
    expect(titleTrack?.kind).toBe('caption');
    expect(style?.position).toBe('center');
    expect(style?.fontSizePx).toBe(92);
    expect(titleCue?.trackId).toBe(title.trackId);
    expect(titleCue?.trackId).not.toBe(caption.trackId);
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

describe('velocidad y efectos de clip', () => {
  it('cambia la velocidad conservando la identidad de timing y hace ripple', () => {
    const project = base();
    const asset = videoAsset(300);
    const withAsset = addAsset(project, asset);
    const first = addClipFromAsset(withAsset, asset, { atFrame: 0 });
    const second = addClipFromAsset(first.project, asset, { atFrame: 300 });

    const fast = setClipSpeed(second.project, first.clipId, 2);
    const fastClip = fast.timeline.clips.find((clip) => clip.id === first.clipId);
    const shifted = fast.timeline.clips.find((clip) => clip.id === second.clipId);

    expect(fastClip?.durationFrames).toBe(150);
    if (fastClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(fastClip.source.outFrame - fastClip.source.inFrame).toBe(300);
    expect(fastClip.speed).toEqual({ num: 2, den: 1 });
    expect(shifted?.startFrame).toBe(150);
    validated(fast);

    const slow = setClipSpeed(fast, first.clipId, 0.5);
    const slowClip = slow.timeline.clips.find((clip) => clip.id === first.clipId);
    expect(slowClip?.durationFrames).toBe(600);
    if (slowClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(slowClip.speed).toEqual({ num: 1, den: 2 });
    validated(slow);
  });

  it('aplica y limpia efectos de color en un clip de imagen', () => {
    const project = base();
    const asset = imageAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0, durationFrames: 90 });

    const colored = updateClip(added.project, added.clipId, {
      effects: { brightness: 0.2, contrast: 1.1, vignette: 0.3, sepia: true },
    });
    const clip = colored.timeline.clips.find((item) => item.id === added.clipId);
    expect(clip?.kind).toBe('image');
    if (clip?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(clip.effects?.brightness).toBe(0.2);
    expect(clip.effects?.sepia).toBe(true);
    validated(colored);

    const cleared = updateClip(colored, added.clipId, { effects: {} });
    const clean = cleared.timeline.clips.find((item) => item.id === added.clipId);
    if (clean?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(clean.effects).toBeUndefined();
    validated(cleared);
  });

  it('mezcla, reemplaza y limpia el look global del proyecto', () => {
    const project = base();
    const merged = updateProjectLook(project, { brightness: 0.1, vignette: 0.2 });
    expect(merged.look).toEqual({ brightness: 0.1, vignette: 0.2 });
    expect(merged.revision).toBeGreaterThan(project.revision);
    validated(merged);

    const tweaked = updateProjectLook(merged, { vignette: undefined, contrast: 1.1 });
    expect(tweaked.look).toEqual({ brightness: 0.1, contrast: 1.1 });
    validated(tweaked);

    const preset = setProjectLook(tweaked, { sepia: true, temperature: 0.2 });
    expect(preset.look).toEqual({ sepia: true, temperature: 0.2 });
    validated(preset);

    const cleared = setProjectLook(preset, null);
    expect(cleared.look).toBeUndefined();
    validated(cleared);

    const empty = updateProjectLook(cleared, {});
    expect(empty.look).toBeUndefined();
    validated(empty);
  });

  it('aplica y limpia movimiento Ken Burns en un clip de imagen', () => {
    const project = base();
    const asset = imageAsset();
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0, durationFrames: 90 });

    const moving = updateClip(added.project, added.clipId, {
      motion: { type: 'zoom-in', intensity: 0.18 },
    });
    const clip = moving.timeline.clips.find((item) => item.id === added.clipId);
    if (clip?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(clip.motion).toEqual({ type: 'zoom-in', intensity: 0.18 });
    validated(moving);

    const cleared = updateClip(moving, added.clipId, { motion: undefined });
    const clean = cleared.timeline.clips.find((item) => item.id === added.clipId);
    if (clean?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(clean.motion).toBeUndefined();
    validated(cleared);
  });

  it('rechaza movimiento en audio y en clips gráficos', () => {
    const project = base();
    const audio = audioAsset(120);
    const audioClip = addClipFromAsset(addAsset(project, audio), audio, { atFrame: 0, durationFrames: 120 });
    expect(() =>
      updateClip(audioClip.project, audioClip.clipId, { motion: { type: 'zoom-in' } }),
    ).toThrow(ProjectActionError);
  });

  it('aplica chroma key y suite de audio en clips compatibles', () => {
    const project = base();
    const image = imageAsset();
    const added = addClipFromAsset(addAsset(project, image), image, { atFrame: 0, durationFrames: 90 });
    const keyed = updateClip(added.project, added.clipId, {
      chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 },
    });
    const imageClip = keyed.timeline.clips.find((clip) => clip.id === added.clipId);
    if (imageClip?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(imageClip.chromaKey?.color).toBe('#00ff00');
    validated(keyed);

    const audio = audioAsset(120);
    const addedAudio = addClipFromAsset(addAsset(project, audio), audio, {
      atFrame: 0,
      durationFrames: 120,
    });
    const processed = updateClip(addedAudio.project, addedAudio.clipId, {
      audio: {
        gainDb: -3,
        highPassHz: 80,
        lowPassHz: 12_000,
        eqLowDb: -2,
        eqMidDb: 3,
        eqHighDb: 2,
        compressor: true,
        denoise: 0.2,
      },
    });
    const audioClip = processed.timeline.clips.find((clip) => clip.id === addedAudio.clipId);
    if (audioClip?.kind !== 'audio') throw new Error('se esperaba audio');
    expect(audioClip.audio?.eqMidDb).toBe(3);
    expect(audioClip.audio?.compressor).toBe(true);
    validated(processed);
  });

  it('anima la máscara con keyframes y los quita sin tocar la forma base', () => {
    const project = base();
    const image = imageAsset();
    const added = addClipFromAsset(addAsset(project, image), image, {
      atFrame: 0,
      durationFrames: 90,
    });
    const masked = updateClip(added.project, added.clipId, {
      mask: {
        shape: 'ellipse',
        x: 0,
        y: 0,
        width: 0.8,
        height: 0.6,
        rotationDeg: 0,
        feather: 0.1,
        invert: false,
      },
    });
    let next = setMaskKeyframe(masked, added.clipId, 0, { x: -0.2, width: 0.6 });
    next = setMaskKeyframe(next, added.clipId, 45, { x: 0.2 });
    const animated = next.timeline.clips.find((clip) => clip.id === added.clipId);
    if (animated?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(animated.mask?.keyframes?.map((keyframe) => keyframe.frame)).toEqual([0, 45]);
    expect(animated.mask?.keyframes?.[0]?.x).toBe(-0.2);
    validated(next);

    const removed = removeMaskKeyframe(next, added.clipId, 45);
    const stillAnimated = removed.timeline.clips.find((clip) => clip.id === added.clipId);
    if (stillAnimated?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(stillAnimated.mask?.keyframes).toHaveLength(1);
    const cleared = clearMaskKeyframes(removed, added.clipId);
    const plain = cleared.timeline.clips[0];
    if (plain?.kind !== 'image') throw new Error('se esperaba imagen');
    expect(plain.mask?.keyframes).toBeUndefined();
    expect(plain.mask?.shape).toBe('ellipse');
    validated(cleared);
  });

  it('pega clips en el primer hueco libre y cierra huecos con ripple', () => {
    const project = base();
    const image = imageAsset();
    const first = addClipFromAsset(addAsset(project, image), image, {
      atFrame: 0,
      durationFrames: 30,
    });
    const second = addClipFromAsset(first.project, image, {
      atFrame: 30,
      durationFrames: 30,
    });
    const source = second.project.timeline.clips.find((clip) => clip.id === first.clipId);
    if (!source) throw new Error('se esperaba el clip original');

    const pasted = pasteClip(second.project, source, { startFrame: 10 });
    expect(pasted.startFrame).toBe(60);
    expect(pasted.clipId).not.toBe(source.id);
    const copy = pasted.project.timeline.clips.find((clip) => clip.id === pasted.clipId);
    expect(copy?.startFrame).toBe(60);
    validated(pasted.project);

    const ripped = rippleDeleteClip(pasted.project, first.clipId);
    const remaining = ripped.timeline.clips
      .map((clip) => clip.startFrame)
      .sort((a, b) => a - b);
    expect(remaining).toEqual([0, 30]);
    validated(ripped);
  });

  it('agrega títulos con plantillas y reutiliza el estilo', () => {
    const template = TITLE_TEMPLATES.find((item) => item.id === 'caja');
    if (!template) throw new Error('falta la plantilla Caja');
    const first = addTitleFromTemplate(base(), {
      text: 'Hola',
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    const style = first.project.captions.styles.find(
      (item) => item.name === 'Plantilla · Caja',
    );
    expect(style?.backgroundColor).toBe('#f7f7f2');
    const cue = first.project.captions.cues.find((item) => item.id === first.cueId);
    expect(cue?.styleId).toBe(style?.id);
    expect(cue?.animation).toBe('slide-up');
    validated(first.project);

    const second = addTitleFromTemplate(first.project, {
      text: 'Otra',
      startFrame: 90,
      durationFrames: 60,
      template,
    });
    expect(
      second.project.captions.styles.filter((item) => item.name === 'Plantilla · Caja'),
    ).toHaveLength(1);
    validated(second.project);
  });

  it('normaliza el loudness del proyecto y lo limpia', () => {
    const normalized = updateAudioMix(base(), {
      loudnessTarget: {
        platform: 'youtube',
        integratedLufs: -14,
        truePeakDb: -1.5,
        toleranceDb: 1.5,
      },
    });
    expect(normalized.audio.loudnessTarget?.platform).toBe('youtube');
    validated(normalized);

    const cleared = updateAudioMix(normalized, { loudnessTarget: undefined, masterLimiter: true });
    expect(cleared.audio.loudnessTarget).toBeUndefined();
    expect(cleared.audio.master.limiter).toBe(true);
    validated(cleared);
  });

  it('inserta subtítulos transcritos en la posición del clip', () => {
    const project = base();
    const audio = audioAsset(120);
    const added = addClipFromAsset(addAsset(project, audio), audio, {
      atFrame: 30,
      durationFrames: 90,
    });
    const result = addTranscriptionCues(added.project, added.clipId, [
      { start: 0, end: 1, text: 'Hola' },
      { start: 1, end: 2, text: 'Mundo' },
    ]);
    const cues = result.project.captions.cues.filter((cue) =>
      cue.text === 'Hola' || cue.text === 'Mundo',
    );
    expect(result.added).toBe(2);
    expect(cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([
      [30, 60],
      [60, 90],
    ]);
    validated(result.project);
  });

  it('divide un clip en varios cortes de escena', () => {
    const project = base();
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const result = splitClipAtFrames(added.project, added.clipId, [90, 180, 260]);

    expect(result).not.toBeNull();
    const clips = result!.project.timeline.clips
      .filter((clip) => clip.kind === 'video')
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips.map((clip) => clip.startFrame)).toEqual([0, 90, 180, 260]);
    expect(clips.map((clip) => clip.durationFrames)).toEqual([90, 90, 80, 40]);
    expect(result!.clipIds).toHaveLength(4);
    validated(result!.project);
  });

  it('duplica un clip después de sí mismo conservando efectos', () => {
    const project = base();
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    });
    const styled = updateClip(added.project, added.clipId, {
      effects: { brightness: 0.1, contrast: 1.1 },
    });
    const result = duplicateClip(styled, added.clipId);

    expect(result).not.toBeNull();
    const clips = result!.project.timeline.clips;
    expect(clips).toHaveLength(2);
    const copy = clips.find((clip) => clip.id === result!.clipId);
    expect(copy?.startFrame).toBe(90);
    expect(copy?.durationFrames).toBe(90);
    if (copy?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(copy.effects).toEqual({ brightness: 0.1, contrast: 1.1 });
    validated(result!.project);
  });

  it('agrega un perfil nativo para formatos personalizados', () => {
    const project = updateProjectSettings(base(), { width: 1440, height: 1080 });
    const native = project.renderProfiles.find((profile) =>
      profile.name.startsWith('Formato del proyecto'),
    );
    expect(native?.resolution).toEqual({ width: 1440, height: 1080 });
    expect(native?.aspectRatio).toBe('4:3');
    expect(native?.videoPreset).toBe('veryfast');
    expect(native?.audioBitsPerSecond).toBe(128_000);
    validated(project);
  });

  it('retimea clips, assets, subtítulos y perfiles al cambiar fps', () => {
    const asset = videoAsset(300);
    let project = addAsset(base(), asset);
    const first = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 });
    project = first.project;
    const second = addClipFromAsset(project, asset, { atFrame: 90, durationFrames: 60 });
    project = addCaptionCue(second.project, {
      text: 'Hola',
      startFrame: 30,
      durationFrames: 60,
    }).project;

    const retimed = updateProjectSettings(project, { fpsNum: 24, fpsDen: 1 });
    expect(retimed.video.frameRate).toEqual({ num: 24, den: 1 });
    const clips = retimed.timeline.clips.sort((a, b) => a.startFrame - b.startFrame);
    expect(clips.map((clip) => [clip.startFrame, clip.durationFrames])).toEqual([
      [0, 72],
      [72, 48],
    ]);
    expect(clips[0]?.kind).toBe('video');
    if (clips[0]?.kind === 'video') {
      expect(clips[0].source).toMatchObject({ inFrame: 0, outFrame: 72 });
    }
    const audio = retimed.assets.find((item) => item.id === asset.id);
    expect(audio && 'media' in audio && audio.media && 'durationFrames' in audio.media
      ? audio.media.durationFrames
      : null).toBe(240);
    expect(retimed.captions.cues[0]).toMatchObject({ startFrame: 24, endFrame: 72 });
    expect(retimed.renderProfiles.every((profile) => profile.frameRate.num === 24)).toBe(true);
    validated(retimed);
  });

  it('rechaza cambiar fps con clips a velocidad distinta de 1x', () => {
    const project = base();
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const fast = setClipSpeed(added.project, added.clipId, 2);
    expect(() => updateProjectSettings(fast, { fpsNum: 24 })).toThrow(/velocidad distinta de 1×/);
  });

  it('aplica encuadre cover a todos los perfiles', () => {
    const covered = applyProfileFit(base(), 'cover');
    expect(covered.renderProfiles.every((profile) => profile.fit === 'cover')).toBe(true);
    validated(covered);
  });

  it('aplica compresión y códec a todos los perfiles', () => {
    const compressed = applyCompression(base(), 'compacto', 'h265');
    for (const profile of compressed.renderProfiles) {
      expect(profile.bitrate).toEqual({ mode: 'crf', crf: 27 });
      expect(profile.videoPreset).toBe('faster');
      expect(profile.audioBitsPerSecond).toBe(96_000);
      expect(profile.videoCodec).toBe('h265');
      expect(compressionPresetOf(profile)).toBe('compacto');
    }
    validated(compressed);
  });

  it('rechaza velocidad en imágenes y limita el rango', () => {
    const project = base();
    const image = imageAsset();
    const added = addClipFromAsset(addAsset(project, image), image, { atFrame: 0, durationFrames: 90 });
    expect(() => setClipSpeed(added.project, added.clipId, 2)).toThrow(ProjectActionError);

    const video = videoAsset(300);
    const withVideo = addAsset(base(), video);
    const addedVideo = addClipFromAsset(withVideo, video, { atFrame: 0 });
    const fast = setClipSpeed(addedVideo.project, addedVideo.clipId, 99);
    const clip = fast.timeline.clips[0];
    if (clip?.kind !== 'video') throw new Error('se esperaba video');
    expect(clip.speed).toEqual({ num: 4, den: 1 });
    validated(fast);
  });
});

describe('estabilización', () => {
  it('guarda y quita la ventana analizada en un clip de video', () => {
    const video = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), video), video, { atFrame: 0 });
    const applied = setClipStabilization(added.project, added.clipId, {
      smoothing: 12,
      transformFile: 'media/stabilizers/a.trf',
      inFrame: 0,
      outFrame: 300,
    });
    const clip = applied.timeline.clips.find((item) => item.id === added.clipId);
    if (clip?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(clip.stabilization).toEqual({
      smoothing: 12,
      transformFile: 'media/stabilizers/a.trf',
      inFrame: 0,
      outFrame: 300,
    });
    validated(applied);

    const removed = setClipStabilization(applied, added.clipId, undefined);
    const cleared = removed.timeline.clips.find((item) => item.id === added.clipId);
    if (cleared?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(cleared.stabilization).toBeUndefined();
    validated(removed);
  });

  it('limita el suavizado al rango del esquema', () => {
    const video = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), video), video, { atFrame: 0 });
    const low = setClipStabilization(added.project, added.clipId, {
      smoothing: 0,
      transformFile: 'media/stabilizers/a.trf',
      inFrame: 0,
      outFrame: 300,
    });
    const lowClip = low.timeline.clips.find((item) => item.id === added.clipId);
    if (lowClip?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(lowClip.stabilization?.smoothing).toBe(1);
    validated(low);

    const high = setClipStabilization(added.project, added.clipId, {
      smoothing: 999.6,
      transformFile: 'media/stabilizers/a.trf',
      inFrame: 0,
      outFrame: 300,
    });
    const highClip = high.timeline.clips.find((item) => item.id === added.clipId);
    if (highClip?.kind !== 'video') throw new Error('se esperaba un clip de video');
    expect(highClip.stabilization?.smoothing).toBe(60);
    validated(high);
  });

  it('rechaza imágenes y clips que no están en la timeline', () => {
    const image = imageAsset();
    const added = addClipFromAsset(addAsset(base(), image), image, {
      atFrame: 0,
      durationFrames: 90,
    });
    expect(() =>
      setClipStabilization(added.project, added.clipId, {
        smoothing: 10,
        transformFile: 'media/stabilizers/a.trf',
        inFrame: 0,
        outFrame: 90,
      }),
    ).toThrow(ProjectActionError);
    expect(() =>
      setClipStabilization(base(), newId(), {
        smoothing: 10,
        transformFile: 'media/stabilizers/a.trf',
        inFrame: 0,
        outFrame: 30,
      }),
    ).toThrow(/no está en la timeline/);
  });
});

describe('keyframes de opacidad', () => {
  function clipWithOpacity(project: ProjectDocument) {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const updated = updateClip(added.project, added.clipId, {
      transform: { scaleX: 1.4, scaleY: 1.4, opacity: 0.6 },
    });
    const clip = updated.timeline.clips.find((item) => item.id === added.clipId);
    if (!clip) throw new Error('falta el clip');
    return { project: updated, clipId: added.clipId, clip };
  }

  it('captura la escala uniforme y la opacidad vigentes sin tocar la escala estática', () => {
    const { project, clipId, clip } = clipWithOpacity(base());
    const captured = captureTransformKeyframe(clip, 0);
    expect(captured.scale).toBe(1);
    expect(captured.opacity).toBe(0.6);

    const pinned = validated(setTransformKeyframe(project, clipId, 0, captured));
    const pinnedClip = pinned.timeline.clips.find((item) => item.id === clipId);
    if (!pinnedClip) throw new Error('falta el clip');
    const sampled = clipTransformAtFrame(pinnedClip, 0);
    expect(sampled.scaleX).toBeCloseTo(1.4, 5);
    expect(sampled.opacity).toBeCloseTo(0.6, 5);
  });

  it('interpola opacidad y escala entre dos claves', () => {
    const { project, clipId, clip } = clipWithOpacity(base());
    const first = validated(setTransformKeyframe(project, clipId, 0, captureTransformKeyframe(clip, 0)));
    const second = validated(
      setTransformKeyframe(first, clipId, 30, { scale: 1.5, opacity: 1 }),
    );
    const animated = second.timeline.clips.find((item) => item.id === clipId);
    if (!animated) throw new Error('falta el clip');
    const middle = clipTransformAtFrame(animated, 15);
    expect(middle.opacity).toBeCloseTo(0.8, 5);
    expect(middle.scaleX).toBeCloseTo(1.4 * 1.25, 5);

    const captureMiddle = captureTransformKeyframe(animated, 15);
    expect(captureMiddle.scale).toBeCloseTo(1.25, 3);
    expect(captureMiddle.opacity).toBeCloseTo(0.8, 3);
  });

  it('persiste la opacidad en 0 en vez de descartarla', () => {
    const { project, clipId, clip } = clipWithOpacity(base());
    const pinned = setTransformKeyframe(project, clipId, 0, captureTransformKeyframe(clip, 0));
    const dark = validated(setTransformKeyframe(pinned, clipId, 12, { opacity: 0 }));
    const saved = dark.timeline.clips
      .find((item) => item.id === clipId)
      ?.transform?.keyframes?.find((keyframe) => keyframe.frame === 12);
    expect(saved?.opacity).toBe(0);
  });

  it('rechaza una opacidad fuera de 0..1', () => {
    const { project, clipId } = clipWithOpacity(base());
    expect(() => setTransformKeyframe(project, clipId, 0, { opacity: 1.5 })).toThrow(
      ProjectActionError,
    );
  });
});

describe('cortes al ritmo sobre una pista', () => {
  it('divide todos los clips que cruzan los frames y conserva la duración total', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const trackId = added.project.timeline.tracks[0]?.id;
    if (!trackId) throw new Error('falta la pista');
    const split = splitTrackAtFrames(added.project, trackId, [90, 180]);
    expect(split).not.toBeNull();
    const next = validated(split ?? added.project);
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips).toHaveLength(3);
    expect(totalFrames(next)).toBe(300);
    const windows = clips.map((clip) =>
      'inFrame' in clip.source ? `${clip.source.inFrame}-${clip.source.outFrame}` : 'sin ventana',
    );
    expect(windows).toEqual(['0-90', '90-180', '180-300']);
  });

  it('no toca una pista bloqueada ni frames fuera de los clips', () => {
    const asset = videoAsset(120);
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const trackId = added.project.timeline.tracks[0]?.id;
    if (!trackId) throw new Error('falta la pista');
    expect(splitTrackAtFrames(added.project, trackId, [500])).toBeNull();
    const locked = updateTrack(added.project, trackId, { locked: true });
    expect(splitTrackAtFrames(locked, trackId, [30])).toBeNull();
  });
});

describe('curva de velocidad', () => {
  it('reparte el clip en tramos contiguos y conserva duración y ventana', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const result = applySpeedCurve(added.project, added.clipId, {
      from: 1,
      to: 0.25,
      segments: 6,
    });
    expect(result.clipIds).toHaveLength(6);
    const next = validated(result.project);
    const clips = next.timeline.clips
      .filter((clip) => result.clipIds.includes(clip.id))
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips).toHaveLength(6);
    expect(clips.reduce((sum, clip) => sum + clip.durationFrames, 0)).toBe(300);
    const windows = clips.map((clip) =>
      'inFrame' in clip.source ? clip.source.outFrame - clip.source.inFrame : 0,
    );
    expect(windows.reduce((sum, value) => sum + value, 0)).toBe(300);
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      const current = clips[index]!;
      expect(current.startFrame).toBe(previous.startFrame + previous.durationFrames);
      expect('inFrame' in current.source && 'inFrame' in previous.source).toBe(true);
      if ('inFrame' in current.source && 'inFrame' in previous.source) {
        expect(current.source.inFrame).toBe(previous.source.outFrame);
      }
    }
    const firstSpeed = windows[0]! / clips[0]!.durationFrames;
    const lastSpeed = windows[5]! / clips[5]!.durationFrames;
    expect(firstSpeed).toBeCloseTo(1, 2);
    expect(lastSpeed).toBeCloseTo(0.25, 1);
  });

  it('rechaza extremos iguales, pocos tramos y clips animados', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    expect(() =>
      applySpeedCurve(added.project, added.clipId, { from: 1, to: 1, segments: 8 }),
    ).toThrow(ProjectActionError);
    expect(() =>
      applySpeedCurve(added.project, added.clipId, { from: 1, to: 0.5, segments: 2 }),
    ).toThrow(ProjectActionError);
    const animated = setTransformKeyframe(added.project, added.clipId, 0, { scale: 1.2 });
    expect(() =>
      applySpeedCurve(animated, added.clipId, { from: 1, to: 0.5, segments: 8 }),
    ).toThrow(ProjectActionError);
  });
});

describe('capas de ajuste', () => {
  it('crea la pista y coloca la capa en el playhead', () => {
    const result = addAdjustmentLayer(base(), 45);
    const project = validated(result.project);
    const track = project.timeline.tracks.find((item) => item.id === result.trackId);
    expect(track?.kind).toBe('adjustment');
    const clip = project.timeline.clips.find((item) => item.id === result.clipId);
    expect(clip?.kind).toBe('adjustment');
    expect(clip?.startFrame).toBe(45);
    expect(clip?.durationFrames).toBe(90);
    expect(clip?.source.type).toBe('adjustment');
  });

  it('reutiliza la pista y conserva los efectos al dividir', () => {
    const first = addAdjustmentLayer(base(), 0);
    const graded = updateClip(validated(first.project), first.clipId, {
      effects: { contrast: 1.3, curvePreset: 'vintage' },
    });
    const second = addAdjustmentLayer(graded, 120);
    const project = validated(second.project);
    expect(project.timeline.tracks.filter((item) => item.kind === 'adjustment')).toHaveLength(1);
    expect(project.timeline.clips).toHaveLength(2);

    const split = splitClip(project, first.clipId, 30);
    expect(split).not.toBeNull();
    const after = validated(split!.project);
    const left = after.timeline.clips.find((item) => item.id === first.clipId);
    const right = after.timeline.clips.find((item) => item.id === split!.rightClipId);
    expect(left?.durationFrames).toBe(30);
    expect(right?.startFrame).toBe(30);
    expect(right && 'effects' in right ? right.effects?.contrast : undefined).toBe(1.3);
  });

  it('rechaza una pista que no sea de ajustes', () => {
    expect(() => addAdjustmentLayer(base(), 0, { trackId: newId() })).toThrow(
      ProjectActionError,
    );
  });
});
