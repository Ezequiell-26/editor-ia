import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
  newId,
  updateClip,
} from './project-actions';
import {
  applyClipAttributes,
  copyClipAttributes,
  pasteAttributesToColor,
} from './clip-attributes';

const NOW = '2025-01-01T00:00:00.000Z';

function base(): ProjectDocument {
  return ensureDelivery(createEmptyProject('Atributos', NOW));
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
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  } as Asset;
}

describe('atributos de clip', () => {
  it('copia estilo y audio sin mute ni keyframes de ganancia', () => {
    const video = videoAsset();
    const added = addClipFromAsset(addAsset(base(), video), video, {
      atFrame: 0,
      durationFrames: 90,
    });
    const styled = updateClip(added.project, added.clipId, {
      effects: { brightness: 0.2, fadeInFrames: 60 },
      motion: { type: 'zoom-in', intensity: 0.1 },
      colorTag: 'rose',
      audio: {
        gainDb: -4,
        highPassHz: 80,
        muted: true,
        gainKeyframes: [{ frame: 0, gainDb: -4 }],
      },
    });
    const source = styled.timeline.clips.find((clip) => clip.id === added.clipId)!;
    const attributes = copyClipAttributes(source);
    expect(attributes?.effects?.brightness).toBe(0.2);
    expect(attributes?.motion?.type).toBe('zoom-in');
    expect(attributes?.colorTag).toBe('rose');
    expect(attributes?.audio?.gainDb).toBe(-4);
    expect(attributes?.audio?.muted).toBeUndefined();
    expect(attributes?.audio?.gainKeyframes).toBeUndefined();
  });

  it('pega sobre un clip corto quitando fades, keyframes fuera de rango y acotando animación', () => {
    const video = videoAsset();
    const sourceAdded = addClipFromAsset(addAsset(base(), video), video, {
      atFrame: 0,
      durationFrames: 90,
    });
    const targetAdded = addClipFromAsset(sourceAdded.project, video, {
      atFrame: 120,
      durationFrames: 30,
    });
    const styled = updateClip(targetAdded.project, sourceAdded.clipId, {
      effects: { contrast: 1.2, fadeInFrames: 60 },
      motion: { type: 'pan-right', intensity: 0.12 },
      mask: {
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotationDeg: 0,
        feather: 0.1,
        invert: false,
        keyframes: [
          { frame: 10, x: 0 },
          { frame: 80, x: 0.5 },
        ],
      },
      animationIn: { type: 'fade', durationFrames: 40 },
      colorTag: 'teal',
      audio: { gainDb: -2 },
    });
    const source = styled.timeline.clips.find((clip) => clip.id === sourceAdded.clipId)!;
    const attributes = copyClipAttributes(source)!;
    const applied = applyClipAttributes(styled, targetAdded.clipId, attributes);
    const target = applied.timeline.clips.find((clip) => clip.id === targetAdded.clipId)!;
    if (target.kind !== 'video') throw new Error('se esperaba video');
    expect(target.effects?.contrast).toBe(1.2);
    expect(target.effects?.fadeInFrames).toBeUndefined();
    expect(target.mask?.keyframes?.map((keyframe) => keyframe.frame)).toEqual([10]);
    expect(target.animationIn?.durationFrames).toBe(30);
    expect(target.colorTag).toBe('teal');
    expect(target.motion?.type).toBe('pan-right');
    expect(target.audio?.gainDb).toBe(-2);
  });

  it('sobre audio sólo aplica audio y color, y un clip sin atributos no copia nada', () => {
    const video = videoAsset();
    const videoAdded = addClipFromAsset(addAsset(base(), video), video, {
      atFrame: 0,
      durationFrames: 60,
    });
    const audio = audioAsset();
    const audioAdded = addClipFromAsset(
      addAsset(videoAdded.project, audio),
      audio,
      { atFrame: 0, durationFrames: 60 },
    );
    const styled = updateClip(audioAdded.project, videoAdded.clipId, {
      effects: { saturation: 1.3 },
      colorTag: 'blue',
      audio: { gainDb: -3 },
    });
    const source = styled.timeline.clips.find((clip) => clip.id === videoAdded.clipId)!;
    const applied = applyClipAttributes(
      styled,
      audioAdded.clipId,
      copyClipAttributes(source)!,
    );
    const target = applied.timeline.clips.find((clip) => clip.id === audioAdded.clipId)!;
    if (target.kind !== 'audio') throw new Error('se esperaba audio');
    expect(target.audio?.gainDb).toBe(-3);
    expect(target.colorTag).toBe('blue');
    expect('effects' in target ? target.effects : undefined).toBeUndefined();
    expect('motion' in target).toBe(false);

    const plainProject = addClipFromAsset(addAsset(base(), video), video, {
      atFrame: 0,
      durationFrames: 30,
    }).project;
    const plain = plainProject.timeline.clips[0]!;
    expect(copyClipAttributes(plain)).toBeNull();
    expect(applyClipAttributes(plainProject, plain.id, {})).toBe(plainProject);
  });

  it('pega atributos en lote sobre un color y salta pistas bloqueadas', () => {
    const video = videoAsset();
    const source = addClipFromAsset(addAsset(base(), video), video, {
      atFrame: 0,
      durationFrames: 60,
    });
    const target = addClipFromAsset(source.project, video, {
      atFrame: 120,
      durationFrames: 60,
    });
    const other = addClipFromAsset(target.project, video, {
      atFrame: 240,
      durationFrames: 60,
    });
    const secondTrack = addTrack(other.project, 'video', 'V2');
    const locked = addClipFromAsset(secondTrack.project, video, {
      atFrame: 0,
      durationFrames: 30,
      trackId: secondTrack.trackId,
    });
    let project = updateClip(locked.project, source.clipId, {
      effects: { brightness: 0.25 },
      colorTag: 'rose',
    });
    project = updateClip(project, target.clipId, { colorTag: 'rose' });
    project = updateClip(project, other.clipId, { colorTag: 'green' });
    project = updateClip(project, locked.clipId, { colorTag: 'rose' });
    project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((item) =>
          item.id === secondTrack.trackId ? { ...item, locked: true } : item,
        ),
      },
    };
    const attributes = copyClipAttributes(
      project.timeline.clips.find((clip) => clip.id === source.clipId)!,
    )!;
    const batch = pasteAttributesToColor(project, 'rose', attributes);
    expect(batch.applied).toBe(2);
    expect(batch.skipped).toBe(1);
    const byId = (id: string) => batch.project.timeline.clips.find((clip) => clip.id === id)!;
    const tagged = byId(target.clipId);
    expect('effects' in tagged ? tagged.effects : undefined).toEqual({ brightness: 0.25 });
    const green = byId(other.clipId);
    expect('effects' in green ? green.effects : undefined).toBeUndefined();
    const lockedClip = byId(locked.clipId);
    expect('effects' in lockedClip ? lockedClip.effects : undefined).toBeUndefined();
  });
});
