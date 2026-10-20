import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument, Scene } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addAsset,
  addCaptionCue,
  applyCompression,
  applyProfileFit,
  compressionPresetOf,
  addTranscriptionCues,
  addClipFromAsset,
  addGeneratedNarration,
  addScene,
  applyScenePlan,
  captionsFromScenes,
  deleteClip,
  duplicateClip,
  ensureDelivery,
  markAssetReady,
  moveClip,
  newId,
  removeAsset,
  setClipSpeed,
  splitClip,
  splitClipAtFrames,
  totalFrames,
  trimClip,
  updateCaptionCue,
  updateClip,
  updateAudioMix,
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
