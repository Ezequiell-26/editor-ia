import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument, Scene } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { captionMotionPreset } from './caption-motion';
import { addMarker, markersFromScenes } from './markers';
import { TITLE_TEMPLATES } from './title-templates';
import {
  ProjectActionError,
  addAdjustmentLayer,
  addAsset,
  addCaptionCue,
  addTitleCue,
  addTitleFromTemplate,
  addTrack,
  applyCompression,
  applyAudioPresetToAll,
  applySpeedCurve,
  applyFaceCenter,
  applySpeedRamp,
  applyTransitionToCuts,
  applyProfileFit,
  compressionPresetOf,
  createCompound,
  expandCompound,
  addTranscriptionCues,
  addClipFromAsset,
  addGeneratedNarration,
  addMotionGraphic,
  addScene,
  applyScenePlan,
  captionsFromScenes,
  captureTransformKeyframe,
  clipTransformAtFrame,
  closeGaps,
  deleteClip,
  detachAudio,
  duplicateClip,
  ensureDelivery,
  freezeFrameInPlace,
  markAssetReady,
  markAssetReadyFrom,
  moveClip,
  magneticMoveClip,
  moveTrack,
  newId,
  removeAsset,
  relinkAsset,
  replaceClipWithDerivedAsset,
  setClipSpeed,
  setClipStabilization,
  setSlowMotionSmoothing,
  setAssetProxy,
  pasteClip,
  rippleDeleteClip,
  setMaskKeyframe,
  setTransformKeyframe,
  splitClip,
  splitClipAtFrames,
  splitClipsAtMarkers,
  splitTrackAtFrames,
  removeMaskKeyframe,
  clearMaskKeyframes,
  totalFrames,
  trimClip,
  updateAssetMetadata,
  updateCaptionCue,
  updateClip,
  updateMotionProps,
  updateAudioMix,
  toggleAssetFavorite,
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

  it('reconecta un material conservando identidad, licencia y clips', () => {
    const asset = videoAsset(300);
    asset.label = 'Toma original';
    asset.tags = ['entrevista'];
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const replacement = videoAsset(420, {
      id: newId(),
      label: 'Toma nueva',
      source: { type: 'local', path: 'media/toma-nueva.mp4' },
      integrity: { sha256: 'c'.repeat(64), bytes: 20_000 },
    });
    const next = validated(relinkAsset(added.project, asset.id, replacement));
    const linked = next.assets.find((item) => item.id === asset.id);
    if (linked?.kind !== 'video') throw new Error('se esperaba video');
    expect(linked.label).toBe('Toma original');
    expect(linked.tags).toEqual(['entrevista']);
    expect(linked.rights.license.id).toBe('owned');
    expect(linked.source).toEqual({ type: 'local', path: 'media/toma-nueva.mp4' });
    expect(linked.integrity?.sha256).toBe('c'.repeat(64));
    expect(linked.media?.durationFrames).toBe(420);
    expect(next.timeline.clips).toHaveLength(1);
  });

  it('rechaza reconectar con un archivo más corto que un clip o de otro tipo', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const short = videoAsset(120, { id: newId() });
    expect(() => relinkAsset(added.project, asset.id, short)).toThrow(/más largo/);
    const image = imageAsset();
    expect(() => relinkAsset(added.project, asset.id, image)).toThrow(/material es video/);
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

  it('reparte los keyframes al dividir y no los reinicia en el clip derecho', () => {
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
    });
    let project = setTransformKeyframe(added.project, added.clipId, 0, { scale: 1 });
    project = setTransformKeyframe(project, added.clipId, 200, { scale: 2 });
    const split = splitClip(project, added.clipId, 100);
    expect(split).not.toBeNull();
    const after = validated(split!.project);
    const left = after.timeline.clips.find((clip) => clip.id === added.clipId);
    const right = after.timeline.clips.find((clip) => clip.id === split!.rightClipId);
    expect(left?.transform?.keyframes?.some((keyframe) => keyframe.frame === 0)).toBe(true);
    expect(left?.transform?.keyframes?.every((keyframe) => keyframe.frame < 100)).toBe(true);
    expect(right?.transform?.keyframes?.[0]?.frame).toBe(0);
    expect(
      right?.transform?.keyframes?.some(
        (keyframe) => keyframe.frame === 100 && keyframe.scale === 2,
      ),
    ).toBe(true);
  });

  it('no permite recortar el inicio sobre otro clip de la misma pista', () => {
    const asset = videoAsset();
    const first = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const second = addClipFromAsset(first.project, asset, { atFrame: 100 });
    expect(
      trimClip(second.project, second.clipId, 'start', 0),
    ).toBeNull();
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

describe('freeze dentro del clip', () => {
  function freezeSetup() {
    const asset = videoAsset(300);
    const still = imageAsset();
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 300,
    });
    const styled = updateClip(added.project, added.clipId, {
      effects: { saturation: 1.2 },
      transform: { scaleX: 1.1, scaleY: 1.1, offsetX: 20 },
      blendMode: 'screen',
    });
    const withAssets = addAsset(styled, still);
    return { project: withAssets, clipId: added.clipId, still };
  }

  it('divide el video, inserta el congelado y corre el resto de la pista', () => {
    const { project, clipId, still } = freezeSetup();
    const result = freezeFrameInPlace(project, clipId, 120, still.id, 60);
    const next = validated(result.project);
    expect(next.timeline.clips).toHaveLength(3);
    const left = next.timeline.clips.find((clip) => clip.id === clipId);
    const freeze = next.timeline.clips.find((clip) => clip.id === result.freezeClipId);
    const right = next.timeline.clips.find(
      (clip) => clip.kind === 'video' && clip.id !== clipId,
    );
    expect(left?.kind).toBe('video');
    expect(left?.startFrame).toBe(0);
    expect(left?.durationFrames).toBe(120);
    expect(freeze?.kind).toBe('freeze');
    expect(freeze?.startFrame).toBe(120);
    expect(freeze?.durationFrames).toBe(60);
    expect(freeze?.source).toEqual({ type: 'asset', assetId: still.id });
    expect(right?.startFrame).toBe(180);
    expect(right?.durationFrames).toBe(180);
    if (!left || left.kind !== 'video') throw new Error('se esperaba video');
    if (!freeze || freeze.kind !== 'freeze') throw new Error('se esperaba freeze');
    expect(right?.kind === 'video' ? right.source.inFrame : null).toBe(120);
    expect(left.effects).toEqual({ saturation: 1.2 });
    expect(freeze.effects).toEqual({ saturation: 1.2 });
    expect(freeze?.transform).toEqual({ scaleX: 1.1, scaleY: 1.1, offsetX: 20 });
    expect(freeze?.blendMode).toBe('screen');
  });

  it('corre subtítulos y marcadores desde el playhead y deja los anteriores', () => {
    const { project, clipId, still } = freezeSetup();
    const first = addCaptionCue(project, {
      text: 'Antes',
      startFrame: 100,
      durationFrames: 10,
    });
    const second = addCaptionCue(first.project, {
      text: 'Después',
      startFrame: 120,
      durationFrames: 30,
    });
    const withWords: ProjectDocument = {
      ...second.project,
      captions: {
        ...second.project.captions,
        cues: second.project.captions.cues.map((cue) =>
          cue.id === second.cueId
            ? {
                ...cue,
                words: [
                  { text: 'Después', startFrame: 120, endFrame: 135 },
                  { text: 'ya', startFrame: 135, endFrame: 150 },
                ],
              }
            : cue,
        ),
      },
    };
    const before = addMarker(withWords, 90, { label: 'Antes' });
    const after = addMarker(before.project, 120, { label: 'Después' });
    const result = freezeFrameInPlace(after.project, clipId, 120, still.id, 60);
    const next = validated(result.project);
    const cues = [...next.captions.cues].sort((a, b) => a.startFrame - b.startFrame);
    expect(cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([
      [100, 110],
      [180, 210],
    ]);
    expect(cues[1]?.words?.map((word) => [word.startFrame, word.endFrame])).toEqual([
      [180, 195],
      [195, 210],
    ]);
    const markers = [...next.markers].sort((a, b) => a.frame - b.frame);
    expect(markers.map((marker) => marker.frame)).toEqual([90, 180]);
  });

  it('rechaza el playhead fuera del clip, la pista bloqueada y un asset sin confirmar', () => {
    const { project, clipId, still } = freezeSetup();
    expect(() => freezeFrameInPlace(project, clipId, 400, still.id, 60)).toThrow(
      ProjectActionError,
    );
    const locked = validated(
      updateTrack(project, project.timeline.clips[0]!.trackId, { locked: true }),
    );
    expect(() => freezeFrameInPlace(locked, clipId, 120, still.id, 60)).toThrow(
      ProjectActionError,
    );
    const unverified = validated({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === still.id ? { ...asset, status: 'unverified' as const } : asset,
      ),
    });
    expect(() => freezeFrameInPlace(unverified, clipId, 120, still.id, 60)).toThrow(
      ProjectActionError,
    );
  });
});

describe('color de clip', () => {
  it('asigna y limpia la etiqueta de color', () => {
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(base(), asset), asset, { atFrame: 0 });
    const tagged = validated(
      updateClip(added.project, added.clipId, { colorTag: 'violet' }),
    );
    expect(tagged.timeline.clips[0]?.colorTag).toBe('violet');
    const cleared = validated(updateClip(tagged, added.clipId, { colorTag: undefined }));
    expect(cleared.timeline.clips[0]?.colorTag).toBeUndefined();
  });
});

describe('separar audio', () => {
  it('crea un clip de audio, silencia el video y copia ventana y ajustes', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 240,
    });
    const styled = updateClip(added.project, added.clipId, {
      audio: { gainDb: -4, highPassHz: 90 },
      colorTag: 'teal',
    });
    const result = detachAudio(styled, added.clipId);
    const next = validated(result.project);
    const video = next.timeline.clips.find((clip) => clip.id === added.clipId);
    const audio = next.timeline.clips.find((clip) => clip.id === result.clipId);
    expect(result.createdTrack).toBe(true);
    expect(audio?.kind).toBe('audio');
    expect(audio?.startFrame).toBe(0);
    expect(audio?.durationFrames).toBe(240);
    expect(audio?.source).toEqual({
      type: 'asset',
      assetId: asset.id,
      inFrame: 0,
      outFrame: 240,
    });
    if (audio?.kind !== 'audio') throw new Error('se esperaba audio');
    expect(audio.audio?.gainDb).toBe(-4);
    expect(audio.audio?.highPassHz).toBe(90);
    expect(audio.audio?.muted).toBeUndefined();
    expect(audio.colorTag).toBe('teal');
    expect(video?.audio?.muted).toBe(true);
  });

  it('reutiliza una pista libre y rechaza clips que no son video o pistas bloqueadas', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    });
    const withTrack = addTrack(added.project, 'audio', 'Música');
    const result = detachAudio(withTrack.project, added.clipId);
    expect(result.createdTrack).toBe(false);
    expect(result.trackId).toBe(withTrack.trackId);
    validated(result.project);
    const mutedTrack = addTrack(added.project, 'audio', 'Silenciada');
    const muted = validated(
      updateTrack(mutedTrack.project, mutedTrack.trackId, { muted: true }),
    );
    const fresh = detachAudio(muted, added.clipId);
    expect(fresh.createdTrack).toBe(true);
    validated(fresh.project);
    expect(() => detachAudio(result.project, result.clipId)).toThrow(ProjectActionError);
    const locked = validated(updateTrack(added.project, added.trackId, { locked: true }));
    expect(() => detachAudio(locked, added.clipId)).toThrow(ProjectActionError);
  });
});

describe('cerrar huecos', () => {
  it('compacta los clips de una pista y conserva el inicio del primero', () => {
    const asset = videoAsset(300);
    const first = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 30,
      durationFrames: 30,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 120,
      durationFrames: 30,
    });
    expect(second.trackId).toBe(first.trackId);
    const audio = audioAsset(300);
    const source = addClipFromAsset(addAsset(second.project, audio), audio, {
      atFrame: 200,
      durationFrames: 60,
    });
    const result = closeGaps(source.project, first.trackId);
    const next = validated(result.project);
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === first.trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips.map((clip) => clip.startFrame)).toEqual([30, 60]);
    expect(result.moved).toBe(1);
    expect(result.removedFrames).toBe(60);
    expect(
      next.timeline.clips.find((clip) => clip.id === source.clipId)?.startFrame,
    ).toBe(200);
  });

  it('no mueve una pista sin huecos y rechaza una pista bloqueada', () => {
    const asset = videoAsset(300);
    const first = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 30,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 30,
      durationFrames: 30,
    });
    const contiguous = closeGaps(second.project, first.trackId);
    expect(contiguous.moved).toBe(0);
    expect(contiguous.project).toBe(second.project);
    const locked = validated(updateTrack(second.project, first.trackId, { locked: true }));
    expect(() => closeGaps(locked, first.trackId)).toThrow(ProjectActionError);
  });
});

describe('timeline magnética', () => {
  it('mueve el clip y cierra el hueco de la pista', () => {
    const asset = videoAsset(300);
    const first = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 30,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 120,
      durationFrames: 30,
    });
    const moved = magneticMoveClip(second.project, second.clipId, 200);
    expect(moved).not.toBeNull();
    const next = validated(moved!);
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === first.trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips.map((clip) => clip.startFrame)).toEqual([0, 30]);
    expect(clips[1]?.id).toBe(second.clipId);
  });

  it('rechaza un movimiento que se superpone', () => {
    const asset = videoAsset(300);
    const first = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 30,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 60,
      durationFrames: 30,
    });
    expect(magneticMoveClip(second.project, second.clipId, 0)).toBeNull();
  });
});

describe('cortar clips en marcadores', () => {
  it('divide el video en cada marcador sin cambiar duraciones', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 300,
    });
    const first = addMarker(added.project, 90, { label: 'Uno' });
    const second = addMarker(first.project, 180, { label: 'Dos' });
    const result = splitClipsAtMarkers(second.project);
    const next = validated(result.project);
    expect(result.cuts).toBe(2);
    expect(result.clips).toBe(1);
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === added.trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips.map((clip) => [clip.startFrame, clip.durationFrames])).toEqual([
      [0, 90],
      [90, 90],
      [180, 120],
    ]);
    expect(next.markers).toHaveLength(2);
  });

  it('ignora marcadores fuera del clip y no toca pistas bloqueadas', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    });
    const outside = addMarker(added.project, 180, { label: 'Fuera' });
    const noCross = splitClipsAtMarkers(outside.project);
    expect(noCross.cuts).toBe(0);
    expect(noCross.project).toBe(outside.project);

    const inside = addMarker(added.project, 45, { label: 'Dentro' });
    const locked = validated(
      updateTrack(inside.project, added.trackId, { locked: true }),
    );
    const blocked = splitClipsAtMarkers(locked);
    expect(blocked.cuts).toBe(0);
    expect(blocked.skippedTracks).toBe(1);
    expect(blocked.project).toBe(locked);
  });
});

describe('orden de pistas', () => {
  it('sube y baja una pista intercambiando el orden con la vecina', () => {
    let project = addTrack(base(), 'video', 'V1').project;
    project = addTrack(project, 'video', 'V2').project;
    project = addTrack(project, 'audio', 'A1').project;
    const sorted = [...project.timeline.tracks].sort((a, b) => a.order - b.order);
    const middle = sorted[1]!;
    const moved = moveTrack(project, middle.id, 'up');
    const next = validated(moved);
    const nextMiddle = next.timeline.tracks.find((track) => track.id === middle.id)!;
    expect(nextMiddle.order).toBe(2);
    expect(
      next.timeline.tracks.find((track) => track.id === sorted[2]!.id)?.order,
    ).toBe(1);
    const top = [...next.timeline.tracks].sort((a, b) => a.order - b.order).at(-1)!;
    expect(moveTrack(next, top.id, 'up')).toBe(next);
    const bottom = [...next.timeline.tracks].sort((a, b) => a.order - b.order)[0]!;
    expect(moveTrack(next, bottom.id, 'down')).toBe(next);
    expect(() => moveTrack(next, '00000000-0000-4000-8000-000000000000', 'up')).toThrow(
      ProjectActionError,
    );
  });
});

describe('mezcla de pistas', () => {
  it('guarda ganancia y solo con validación', () => {
    const track = addTrack(base(), 'audio', 'Música');
    const updated = validated(
      updateTrack(track.project, track.trackId, { gainDb: -6.5, solo: true }),
    );
    const mixed = updated.timeline.tracks.find((item) => item.id === track.trackId);
    expect(mixed?.gainDb).toBe(-6.5);
    expect(mixed?.solo).toBe(true);
  });

  it('rechaza una ganancia fuera del rango de audio', () => {
    const track = addTrack(base(), 'audio', 'Música');
    expect(() =>
      updateTrack(track.project, track.trackId, { gainDb: 20 }),
    ).toThrow(ProjectActionError);
  });

  it('guarda paneo y EQ de 3 bandas por pista', () => {
    const track = addTrack(base(), 'audio', 'Música');
    const updated = validated(
      updateTrack(track.project, track.trackId, {
        pan: -0.4,
        eqLowDb: 3,
        eqMidDb: -2.5,
        eqHighDb: 6,
      }),
    );
    const mixed = updated.timeline.tracks.find((item) => item.id === track.trackId);
    expect(mixed?.pan).toBe(-0.4);
    expect(mixed?.eqLowDb).toBe(3);
    expect(mixed?.eqMidDb).toBe(-2.5);
    expect(mixed?.eqHighDb).toBe(6);
  });

  it('rechaza paneo y EQ fuera de rango', () => {
    const track = addTrack(base(), 'audio', 'Música');
    expect(() =>
      updateTrack(track.project, track.trackId, { pan: 1.5 }),
    ).toThrow(ProjectActionError);
    expect(() =>
      updateTrack(track.project, track.trackId, { eqLowDb: -13 }),
    ).toThrow(ProjectActionError);
  });
});

describe('transiciones en lote', () => {
  it('disuelve cortes contiguos y deja intactos el primero y los huecos', () => {
    const asset = videoAsset(300);
    let project = addAsset(base(), asset);
    for (const at of [0, 30, 60, 120]) {
      project = addClipFromAsset(project, asset, {
        atFrame: at,
        durationFrames: 30,
      }).project;
    }
    const result = applyTransitionToCuts(project, {
      type: 'dissolve',
      frames: 12,
    });
    const next = validated(result.project);
    expect(result.applied).toBe(2);
    const clips = next.timeline.clips
      .filter((clip) => clip.source.type === 'asset')
      .sort((a, b) => a.startFrame - b.startFrame);
    if (clips[0]?.kind !== 'video' || clips[1]?.kind !== 'video') {
      throw new Error('se esperaba video');
    }
    expect(clips[0].transitionIn).toBeUndefined();
    expect(clips[1].transitionIn).toEqual({ type: 'dissolve', frames: 12 });
    expect(clips[2]?.kind === 'video' ? clips[2].transitionIn : undefined).toEqual({
      type: 'dissolve',
      frames: 12,
    });
    expect(clips[3]?.kind === 'video' ? clips[3].transitionIn : undefined).toBeUndefined();
  });

  it('salta pistas bloqueadas', () => {
    const asset = videoAsset(300);
    let project = addAsset(base(), asset);
    for (const at of [0, 30]) {
      project = addClipFromAsset(project, asset, {
        atFrame: at,
        durationFrames: 30,
      }).project;
    }
    const locked = validated(updateTrack(project, project.timeline.tracks[0]!.id, { locked: true }));
    const result = applyTransitionToCuts(locked, { frames: 12 });
    expect(result.applied).toBe(0);
    expect(result.project).toBe(locked);
  });
});

describe('presets de audio en lote', () => {
  it('aplica voz clara a los clips de audio desbloqueados y conserva ganancia', () => {
    const audio = audioAsset(300);
    let project = addAsset(base(), audio);
    const first = addClipFromAsset(project, audio, {
      atFrame: 0,
      durationFrames: 60,
    });
    const secondTrack = addTrack(first.project, 'audio', 'A2');
    const second = addClipFromAsset(secondTrack.project, audio, {
      atFrame: 0,
      durationFrames: 30,
      trackId: secondTrack.trackId,
    });
    project = updateClip(second.project, first.clipId, {
      audio: { gainDb: -5 },
    });
    project = updateTrack(project, secondTrack.trackId, { locked: true });
    const result = applyAudioPresetToAll(project, 'voice');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    const next = validated(result.project);
    const processed = next.timeline.clips.find((clip) => clip.id === first.clipId);
    const blocked = next.timeline.clips.find((clip) => clip.id === second.clipId);
    if (processed?.kind !== 'audio') throw new Error('se esperaba audio');
    expect(processed.audio).toMatchObject({
      gainDb: -5,
      highPassHz: 90,
      lowPassHz: 12_000,
      eqMidDb: 2,
      compressor: true,
      deesser: true,
      denoise: 0.12,
      gateDb: -40,
    });
    expect(blocked?.kind === 'audio' ? blocked.audio?.compressor : undefined).toBeUndefined();
  });
});

describe('marcadores desde escenas', () => {
  it('crea un marcador por escena en su primer clip y salta vacías o repetidas', () => {
    const asset = videoAsset(300);
    let project = addAsset(base(), asset);
    const first = addClipFromAsset(project, asset, {
      atFrame: 0,
      durationFrames: 60,
    });
    const second = addClipFromAsset(first.project, asset, {
      atFrame: 120,
      durationFrames: 60,
    });
    const scenes: Scene[] = [
      {
        id: newId(),
        order: 0,
        title: 'Intro',
        intent: 'hook',
        status: 'draft',
        narration: { text: 'Hola', estimatedDurationFrames: 30 },
        clipIds: [first.clipId],
      },
      {
        id: newId(),
        order: 1,
        title: 'Cierre',
        intent: 'cta',
        status: 'draft',
        narration: { text: 'Chau', estimatedDurationFrames: 30 },
        clipIds: [second.clipId],
      },
      {
        id: newId(),
        order: 2,
        title: 'Vacía',
        intent: 'context',
        status: 'draft',
        narration: { text: 'Sin clip', estimatedDurationFrames: 1 },
        clipIds: [],
      },
    ];
    const withScenes = validated({ ...second.project, scenes });
    const result = markersFromScenes(withScenes);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    const next = validated(result.project);
    expect(next.markers.map((marker) => [marker.frame, marker.label])).toEqual([
      [0, 'Intro'],
      [120, 'Cierre'],
    ]);
    const again = markersFromScenes(next);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(3);
    expect(again.project).toBe(next);
  });
});

describe('activar y desactivar clip', () => {
  it('marca enabled false y lo limpia al reactivar', () => {
    const asset = videoAsset();
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 30,
    });
    const disabled = validated(
      updateClip(added.project, added.clipId, { enabled: false }),
    );
    expect(disabled.timeline.clips[0]?.enabled).toBe(false);
    const enabled = validated(updateClip(disabled, added.clipId, { enabled: true }));
    expect(enabled.timeline.clips[0]?.enabled).toBeUndefined();
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

    for (const clip of clips) {
      if (clip.kind === 'video' && speedOf(clip) >= 0.999) {
        expect(clip.slowMotionSmoothing).toBeUndefined();
      }
    }
  });

  it('limpia la interpolación en los tramos que no son cámara lenta', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 300,
    });
    const flagged = structuredClone(added.project);
    const flaggedClip = flagged.timeline.clips.find((clip) => clip.id === added.clipId);
    if (flaggedClip?.kind !== 'video') throw new Error('se esperaba video');
    flaggedClip.slowMotionSmoothing = true;

    const result = applySpeedRamp(flagged, added.clipId, { from: 2, to: 0.5 });
    const clips = result.project.timeline.clips.filter(
      (clip) => clip.trackId === added.trackId,
    );
    const fast = clips.find((clip) => {
      if (clip.kind !== 'video') return false;
      return (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) >= 0.999;
    });
    expect(fast).toBeDefined();
    if (fast?.kind !== 'video') throw new Error('se esperaba video');
    expect(fast.slowMotionSmoothing).toBeUndefined();
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

describe('clips compuestos', () => {
  it('agrupa clips solapados y los devuelve a sus pistas', () => {
    const video = videoAsset(90);
    const image = imageAsset();
    let project = base();
    const videoTrack = addTrack(project, 'video');
    project = videoTrack.project;
    const imageTrack = addTrack(project, 'image');
    project = imageTrack.project;
    const videoAdded = addClipFromAsset(addAsset(project, video), video, {
      atFrame: 0,
      durationFrames: 90,
      trackId: videoTrack.trackId,
    });
    const imageAdded = addClipFromAsset(
      addAsset(videoAdded.project, image),
      image,
      {
        atFrame: 30,
        durationFrames: 60,
        trackId: imageTrack.trackId,
      },
    );
    const grouped = createCompound(imageAdded.project, videoAdded.clipId);
    expect(grouped.grouped).toBe(2);
    const compoundClip = grouped.project.timeline.clips.find(
      (clip) => clip.id === grouped.compoundClipId,
    );
    expect(compoundClip?.kind).toBe('compound');
    expect(compoundClip?.startFrame).toBe(0);
    expect(compoundClip?.durationFrames).toBe(90);
    expect(grouped.project.timeline.clips).toHaveLength(1);
    expect(grouped.project.compounds).toHaveLength(1);
    expect(
      grouped.project.compounds![0]!.clips.map((clip) => ({
        kind: clip.kind,
        start: clip.startFrame,
        duration: clip.durationFrames,
      })),
    ).toEqual([
      { kind: 'video', start: 0, duration: 90 },
      { kind: 'image', start: 30, duration: 60 },
    ]);
    validated(grouped.project);

    const expanded = expandCompound(grouped.project, grouped.compoundClipId);
    expect(expanded.compounds).toHaveLength(0);
    expect(expanded.timeline.clips).toHaveLength(2);
    expect(
      expanded.timeline.clips.map((clip) => clip.startFrame).sort((a, b) => a - b),
    ).toEqual([0, 30]);
    validated(expanded);

    const deleted = deleteClip(grouped.project, grouped.compoundClipId);
    expect(deleted.compounds).toHaveLength(0);
    validated(deleted);
  });
});

describe('seguimiento de rostro', () => {
  it('crea keyframes para centrar el rostro y escalar sin bordes', () => {
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(base(), asset), asset, {
      atFrame: 0,
      durationFrames: 150,
    });
    const width = added.project.video.width;
    const height = added.project.video.height;
    const next = applyFaceCenter(added.project, added.clipId, [
      { time: 0, centerX: 0.4, centerY: 0.45 },
      { time: 1, centerX: 0.6, centerY: 0.55 },
      { time: 2, centerX: 0.5, centerY: 0.5 },
    ]);
    const clip = next.timeline.clips.find((item) => item.id === added.clipId);
    if (clip?.kind !== 'video') throw new Error('se esperaba video');
    const keyframes = clip.transform?.keyframes ?? [];
    expect(keyframes.length).toBeGreaterThanOrEqual(4);
    expect(keyframes[0]).toMatchObject({
      frame: 0,
      offsetX: Math.round(0.1 * width),
      offsetY: Math.round(0.05 * height),
    });
    const opposite = keyframes.find((keyframe) => keyframe.frame === 30);
    expect(opposite?.offsetX).toBe(Math.round(-0.1 * width));
    const last = keyframes[keyframes.length - 1]!;
    expect(last.frame).toBe(149);
    expect(last.offsetX).toBe(0);
    expect(clip.transform?.scaleX).toBeGreaterThan(1.2);
    expect(clip.transform?.scaleY).toBe(clip.transform?.scaleX);
    validated(next);

    expect(() =>
      applyFaceCenter(next, added.clipId, [
        { time: 0, centerX: 0.5, centerY: 0.5 },
        { time: 1, centerX: 0.5, centerY: 0.5 },
      ]),
    ).toThrow(/keyframes/);

    const withMotion = updateClip(added.project, added.clipId, {
      motion: { type: 'zoom-in', intensity: 0.1 },
    });
    expect(() =>
      applyFaceCenter(withMotion, added.clipId, [
        { time: 0, centerX: 0.4, centerY: 0.5 },
        { time: 1, centerX: 0.6, centerY: 0.5 },
      ]),
    ).toThrow(/Ken Burns/);
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

  it('aplica y quita el movimiento de dos keyframes', () => {
    const project = base();
    const created = addCaptionCue(project, {
      text: 'Título animado',
      startFrame: 0,
      durationFrames: 90,
    });
    const updated = validated(
      updateCaptionCue(created.project, created.cueId, {
        motion: captionMotionPreset('zoom', 90),
      }),
    );
    expect(updated.captions.cues[0]?.motion?.preset).toBe('zoom');
    const cleared = validated(
      updateCaptionCue(updated, created.cueId, { motion: null }),
    );
    expect(cleared.captions.cues[0]?.motion).toBeUndefined();
  });

  it('activa y limpia el revelado por palabra', () => {
    const project = base();
    const created = addCaptionCue(project, {
      text: 'Buenas tardes',
      startFrame: 0,
      durationFrames: 90,
    });
    const enabled = validated(
      updateCaptionCue(created.project, created.cueId, { wordReveal: true }),
    );
    expect(enabled.captions.cues[0]?.wordReveal).toBe(true);
    const disabled = validated(
      updateCaptionCue(enabled, created.cueId, { wordReveal: false }),
    );
    expect(disabled.captions.cues[0]?.wordReveal).toBeUndefined();
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

  it('activa y limpia la interpolación de cámara lenta sólo en video < 1×', () => {
    const project = base();
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });

    const smooth = setClipSpeed(added.project, added.clipId, 0.25, {
      smoothSlowMotion: true,
    });
    const smoothClip = smooth.timeline.clips.find((clip) => clip.id === added.clipId);
    if (smoothClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(smoothClip.slowMotionSmoothing).toBe(true);
    validated(smooth);

    const smoothed = setSlowMotionSmoothing(smooth, added.clipId, false);
    const cleared = smoothed.timeline.clips.find((clip) => clip.id === added.clipId);
    if (cleared?.kind !== 'video') throw new Error('se esperaba video');
    expect(cleared.slowMotionSmoothing).toBeUndefined();

    const normal = setClipSpeed(smoothed, added.clipId, 1);
    const normalClip = normal.timeline.clips.find((clip) => clip.id === added.clipId);
    if (normalClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(normalClip.slowMotionSmoothing).toBeUndefined();

    expect(() => setSlowMotionSmoothing(added.project, added.clipId, true)).toThrow(
      /menor a 1×/,
    );
    expect(() => setSlowMotionSmoothing(added.project, added.clipId, false)).not.toThrow();
  });

  it('reemplaza el material de un clip por un recorte derivado', () => {
    const project = base();
    const asset = videoAsset(300);
    const added = addClipFromAsset(addAsset(project, asset), asset, { atFrame: 0 });
    const slow = setClipSpeed(added.project, added.clipId, 0.5);
    const derived = videoAsset(1_100, {
      label: 'Toma sin fondo',
      source: { type: 'local', path: 'media/toma-sin-fondo.webm' },
    });
    const stabilized = setClipStabilization(slow, added.clipId, {
      smoothing: 12,
      transformFile: 'media/stabilizers/toma.trf',
      inFrame: 0,
      outFrame: 300,
    });
    const next = replaceClipWithDerivedAsset(
      addAsset(stabilized, derived),
      added.clipId,
      derived.id,
    );
    const clip = next.timeline.clips.find((item) => item.id === added.clipId);
    if (clip?.kind !== 'video') throw new Error('se esperaba video');
    expect(clip.source).toEqual({
      type: 'asset',
      assetId: derived.id,
      inFrame: 0,
      outFrame: 300,
    });
    expect(clip.durationFrames).toBe(600);
    expect(clip.speed).toEqual({ num: 1, den: 2 });
    expect(clip.stabilization).toBeUndefined();
    validated(next);

    const withLead = replaceClipWithDerivedAsset(
      addAsset(stabilized, derived),
      added.clipId,
      derived.id,
      { sourceOffset: 20 },
    );
    const leadClip = withLead.timeline.clips.find((item) => item.id === added.clipId);
    if (leadClip?.kind !== 'video') throw new Error('se esperaba video');
    expect(leadClip.source).toEqual({
      type: 'asset',
      assetId: derived.id,
      inFrame: 20,
      outFrame: 320,
    });
    validated(withLead);

    const image = imageAsset();
    const imageAdded = addClipFromAsset(addAsset(base(), image), image, {
      atFrame: 0,
      durationFrames: 90,
    });
    const imageDerived = imageAsset(512, 512);
    const imageNext = replaceClipWithDerivedAsset(
      addAsset(imageAdded.project, imageDerived),
      imageAdded.clipId,
      imageDerived.id,
    );
    expect(imageNext.timeline.clips[0]?.source).toEqual({
      type: 'asset',
      assetId: imageDerived.id,
    });
    validated(imageNext);

    expect(() =>
      replaceClipWithDerivedAsset(addAsset(slow, imageDerived), added.clipId, imageDerived.id),
    ).toThrow(/asset de video/);
  });

  it('hereda la licencia del original al marcar un derivado listo', () => {
    const source = videoAsset(300, {
      rights: {
        license: {
          id: 'cc-by',
          commercialUse: 'requires-attribution',
          url: 'https://example.com/licencia',
          attributionText: 'Foto: Ana',
        },
        provenance: { origin: 'user-imported', acquiredAt: NOW },
      },
    });
    const derived = videoAsset(300, {
      label: 'Toma sin fondo',
      source: { type: 'local', path: 'media/toma-sin-fondo.webm' },
    });
    const next = markAssetReadyFrom(
      addAsset(addAsset(base(), source), derived),
      derived.id,
      source.id,
    );
    const ready = next.assets.find((asset) => asset.id === derived.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.rights.license).toMatchObject({
      id: 'cc-by',
      commercialUse: 'requires-attribution',
      url: 'https://example.com/licencia',
      attributionText: 'Foto: Ana',
    });
    expect(ready?.rights.license.notes).toContain('heredada');
    validated(next);
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

  it('conserva el LUT al elegir un look o volver a neutro', () => {
    const withLut = updateProjectLook(base(), {
      lutFile: 'luts/teal.cube',
      lutIntensity: 0.6,
    });
    const preset = setProjectLook(withLut, { sepia: true });
    expect(preset.look).toEqual({
      sepia: true,
      lutFile: 'luts/teal.cube',
      lutIntensity: 0.6,
    });
    const neutral = setProjectLook(withLut, null);
    expect(neutral.look).toEqual({
      lutFile: 'luts/teal.cube',
      lutIntensity: 0.6,
    });
    validated(preset);
    validated(neutral);
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

describe('metadatos de organización de medios', () => {
  it('guarda bin, etiquetas y favorito, y los limpia después', () => {
    const asset = videoAsset();
    const project = addAsset(base(), asset);
    const updated = validated(
      updateAssetMetadata(project, asset.id, {
        bin: '  Entrevistas  ',
        tags: ['  Voz  ', 'voz', 'Plaza', ''],
        favorite: true,
      }),
    );
    const saved = updated.assets.find((item) => item.id === asset.id);
    expect(saved?.bin).toBe('Entrevistas');
    expect(saved?.tags).toEqual(['Voz', 'Plaza']);
    expect(saved?.favorite).toBe(true);

    const cleared = validated(
      updateAssetMetadata(updated, asset.id, { bin: '', tags: [], favorite: false }),
    );
    const emptied = cleared.assets.find((item) => item.id === asset.id);
    expect(emptied?.bin).toBeUndefined();
    expect(emptied?.tags).toBeUndefined();
    expect(emptied?.favorite).toBeUndefined();
  });

  it('alterna el favorito sin tocar el resto del material', () => {
    const asset = videoAsset();
    const project = addAsset(base(), asset);
    const starred = validated(toggleAssetFavorite(project, asset.id));
    expect(starred.assets[0]?.favorite).toBe(true);
    const unstarred = validated(toggleAssetFavorite(starred, asset.id));
    expect(unstarred.assets[0]?.favorite).toBeUndefined();
    expect(unstarred.assets[0]?.integrity).toEqual(asset.integrity);
  });

  it('rechaza demasiadas etiquetas o una etiqueta demasiado larga', () => {
    const asset = videoAsset();
    const project = addAsset(base(), asset);
    expect(() =>
      updateAssetMetadata(project, asset.id, {
        tags: Array.from({ length: 9 }, (_, index) => `tag-${index}`),
      }),
    ).toThrow(ProjectActionError);
    expect(() =>
      updateAssetMetadata(project, asset.id, { tags: ['x'.repeat(25)] }),
    ).toThrow(ProjectActionError);
    expect(() =>
      updateAssetMetadata(project, asset.id, { bin: 'x'.repeat(41) }),
    ).toThrow(ProjectActionError);
  });
});

describe('motion graphics', () => {
  it('agrega un motion item y un clip graphic en una pista nueva', () => {
    const added = addMotionGraphic(base(), {
      templateId: 'lower-third',
      templateVersion: '1.0.0',
      props: {
        name: 'Ana',
        role: 'Editora',
        accent: '#7dd3c0',
        side: 'left',
        animation: 'fade',
      },
      durationFrames: 60,
      atFrame: 0,
    });
    const project = validated(added.project);
    const track = project.timeline.tracks.find((item) => item.id === added.trackId);
    const clip = project.timeline.clips.find((item) => item.id === added.clipId);
    expect(track?.kind).toBe('graphic');
    expect(clip).toMatchObject({
      kind: 'graphic',
      trackId: added.trackId,
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'graphic', motionId: added.motionId },
    });
    expect(project.motion.find((item) => item.id === added.motionId)?.props.name).toBe('Ana');
    expect(project.motion.find((item) => item.id === added.motionId)?.targetTrackId).toBe(
      added.trackId,
    );
  });

  it('actualiza props de un motion item y rechaza un id ausente', () => {
    const added = addMotionGraphic(base(), {
      templateId: 'title-card',
      templateVersion: '1.0.0',
      props: { title: 'Hola' },
      durationFrames: 30,
      atFrame: 0,
    });
    const updated = updateMotionProps(added.project, added.motionId, { title: 'Chau' });
    expect(updated.motion.find((item) => item.id === added.motionId)?.props.title).toBe('Chau');
    expect(() =>
      updateMotionProps(updated, '00000000-0000-4000-8000-000000000099', {}),
    ).toThrow(ProjectActionError);
  });

  it('reutiliza la pista gráfica y evita superponer clips', () => {
    const first = addMotionGraphic(base(), {
      templateId: 'title-card',
      templateVersion: '1.0.0',
      props: { title: 'Uno' },
      durationFrames: 30,
      atFrame: 0,
    });
    const second = addMotionGraphic(first.project, {
      templateId: 'title-card',
      templateVersion: '1.0.0',
      props: { title: 'Dos' },
      durationFrames: 30,
      atFrame: 0,
    });
    expect(second.trackId).toBe(first.trackId);
    expect(second.startFrame).toBe(30);
    expect(validated(second.project).timeline.clips).toHaveLength(2);
  });
});
