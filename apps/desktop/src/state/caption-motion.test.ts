import { describe, expect, it } from 'vitest';
import type { CaptionCue } from '@editor-ia/project-schema';
import { captionMotionAt, captionMotionPreset } from './caption-motion';

function cue(motion: CaptionCue['motion']): CaptionCue {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    trackId: '22222222-2222-4222-8222-222222222222',
    text: 'Título',
    language: 'es',
    startFrame: 0,
    endFrame: 30,
    motion,
  } as CaptionCue;
}

describe('caption motion', () => {
  it('interpolates a fade from the cue start to the last keyframe', () => {
    const value = cue(captionMotionPreset('fade', 30));
    expect(captionMotionAt(value, 0)?.opacity).toBe(0);
    expect(captionMotionAt(value, 15)?.opacity).toBeCloseTo(0.5, 5);
    expect(captionMotionAt(value, 30)?.opacity).toBe(1);
  });

  it('moves horizontally for a slide preset and keeps the scale', () => {
    const value = cue(captionMotionPreset('slide-left', 30));
    expect(captionMotionAt(value, 0)?.x).toBeCloseTo(-0.8, 5);
    expect(captionMotionAt(value, 15)?.x).toBeCloseTo(-0.4, 5);
    expect(captionMotionAt(value, 30)?.x).toBe(0);
    expect(captionMotionAt(value, 15)?.scale).toBe(1);
  });

  it('falls back to the first keyframe for a property only present in from', () => {
    const value = cue({
      keyframes: [
        { frame: 0, scale: 1.2 },
        { frame: 30, opacity: 0.5 },
      ],
    });
    expect(captionMotionAt(value, 15)?.scale).toBeCloseTo(1.2, 5);
    expect(captionMotionAt(value, 15)?.opacity).toBeCloseTo(0.75, 5);
  });

  it('returns null without motion', () => {
    expect(captionMotionAt(cue(undefined), 0)).toBeNull();
    expect(captionMotionPreset('zoom', 0).keyframes[1]?.frame).toBe(1);
  });
});
