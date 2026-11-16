import { beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  copyTransformKeyframesAt,
  getTransformKeyframeClipboard,
  hasTransformKeyframeClipboard,
  lastCopyWasKeyframes,
  markClipCopied,
  setTransformKeyframeClipboard,
} from './keyframe-clipboard';

function clipWithKeyframe(): Clip {
  return {
    id: 'clip-1',
    kind: 'video',
    trackId: 'v1',
    startFrame: 0,
    durationFrames: 100,
    label: 'Clip',
    transform: {
      keyframes: [
        { frame: 10, scale: 1.2, offsetX: 0.1 },
        { frame: 20, opacity: 0.5 },
      ],
    },
  } as unknown as Clip;
}

describe('keyframe-clipboard (ultimaCopia de AlaukCut)', () => {
  beforeEach(() => {
    setTransformKeyframeClipboard(null);
    markClipCopied();
  });

  it('copia keyframes y marca la última copia como keyframe', () => {
    const patch = copyTransformKeyframesAt(clipWithKeyframe(), 10);
    expect(patch).not.toBeNull();
    expect(hasTransformKeyframeClipboard()).toBe(true);
    expect(lastCopyWasKeyframes()).toBe(true);
    expect(getTransformKeyframeClipboard()?.scale).toBe(1.2);
  });

  it('copiar un clip después de keyframes habilita el paste de clip', () => {
    copyTransformKeyframesAt(clipWithKeyframe(), 10);
    expect(lastCopyWasKeyframes()).toBe(true);
    markClipCopied();
    expect(lastCopyWasKeyframes()).toBe(false);
    // El portapapeles de keyframes sigue disponible para el Inspector.
    expect(hasTransformKeyframeClipboard()).toBe(true);
  });

  it('copiar en un frame sin keyframes no cambia el último copy', () => {
    copyTransformKeyframesAt(clipWithKeyframe(), 10);
    const patch = copyTransformKeyframesAt(clipWithKeyframe(), 55);
    expect(patch).toBeNull();
    expect(hasTransformKeyframeClipboard()).toBe(false);
    expect(lastCopyWasKeyframes()).toBe(false);
  });

  it('limpiar el portapapeles invalida el último copy de keyframes', () => {
    copyTransformKeyframesAt(clipWithKeyframe(), 10);
    setTransformKeyframeClipboard(null);
    expect(lastCopyWasKeyframes()).toBe(false);
  });
});
