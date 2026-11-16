import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Clip } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateClip,
} from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import {
  clipKeyframeFrames,
  keyframePosition,
  nextKeyframe,
  previousKeyframe,
} from './keyframe-nav';

const NOW = '2026-11-11T00:00:00.000Z';

type ClipPatch = Parameters<typeof updateClip>[2];

function buildClip(patch: ClipPatch = {}, atFrame = 100): Clip {
  const base = ensureDelivery(createEmptyProject('Keyframes', NOW));
  const asset = readyAsset();
  const added = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame,
    durationFrames: 300,
  });
  const project = updateClip(added.project, added.clipId, patch);
  const clip = project.timeline.clips.find((item) => item.id === added.clipId);
  if (!clip) throw new Error('clip no encontrado');
  return clip;
}

describe('navegación por keyframes · recolección', () => {
  it('convierte los frames locales del clip a frames absolutos de timeline', () => {
    const clip = buildClip({
      transform: {
        keyframes: [
          { frame: 0, scale: 1 },
          { frame: 60, scale: 1.2 },
          { frame: 150, scale: 1 },
        ],
      },
    });
    expect(clipKeyframeFrames(clip)).toEqual([100, 160, 250]);
  });

  it('une transform y ganancia de audio sin duplicar la clave compartida', () => {
    const clip = buildClip({
      transform: { keyframes: [{ frame: 0, opacity: 1 }, { frame: 60, opacity: 0.5 }] },
      audio: { gainKeyframes: [{ frame: 60, gainDb: -3 }, { frame: 120, gainDb: 0 }] },
    });
    expect(clipKeyframeFrames(clip)).toEqual([100, 160, 220]);
  });

  it('incluye los stacks de video y de audio del clip', () => {
    const clip = buildClip({
      effects: {
        stack: [
          {
            id: 'fx-video',
            effectId: 'blur',
            enabled: true,
            params: {},
            keyframes: { radius: [{ frame: 10, value: 0 }, { frame: 40, value: 8 }] },
          },
        ],
        audioStack: [
          {
            id: 'fx-audio',
            effectId: 'eq',
            enabled: true,
            params: {},
            keyframes: { gain: [{ frame: 20, value: 0 }, { frame: 50, value: 6 }] },
          },
        ],
      },
    });
    expect(clipKeyframeFrames(clip)).toEqual([110, 120, 140, 150]);
  });

  it('descarta claves fuera del tramo del clip', () => {
    const clip = buildClip({
      transform: {
        keyframes: [
          { frame: 0, scale: 1 },
          { frame: 400, scale: 2 },
        ],
      },
    });
    // El clip dura 300 frames: la clave 400 quedaría fuera de su tramo.
    expect(clipKeyframeFrames(clip)).toEqual([100]);
  });

  it('sin keyframes devuelve una lista vacía', () => {
    expect(clipKeyframeFrames(buildClip())).toEqual([]);
  });
});

describe('navegación por keyframes · anterior / siguiente', () => {
  const frames = [100, 160, 250];

  it('busca estrictamente antes y después del playhead', () => {
    expect(previousKeyframe(frames, 200)).toBe(160);
    expect(nextKeyframe(frames, 200)).toBe(250);
  });

  it('estando sobre una clave, las flechas saltan a la vecina', () => {
    expect(previousKeyframe(frames, 160)).toBe(100);
    expect(nextKeyframe(frames, 160)).toBe(250);
  });

  it('devuelve null en los extremos', () => {
    expect(previousKeyframe(frames, 100)).toBeNull();
    expect(nextKeyframe(frames, 250)).toBeNull();
    expect(previousKeyframe([], 10)).toBeNull();
    expect(nextKeyframe([], 10)).toBeNull();
  });

  it('informa la posición 1-based de la clave', () => {
    expect(keyframePosition(frames, 100)).toBe(1);
    expect(keyframePosition(frames, 250)).toBe(3);
    expect(keyframePosition(frames, 999)).toBe(0);
  });
});
