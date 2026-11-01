import { describe, expect, it } from 'vitest';
import type { Clip, ClipTransition } from '@editor-ia/project-schema';
import { transitionLeadFrames, transitionSample } from './transition';

function clipWith(transition: ClipTransition | undefined, overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'incoming',
    kind: 'video',
    trackId: 'track-1',
    startFrame: 60,
    durationFrames: 90,
    source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 90 },
    ...overrides,
    ...(transition ? { transitionIn: transition } : {}),
  } as Clip;
}

describe('transitionLeadFrames', () => {
  it('uses the requested frames when there is room', () => {
    const clip = clipWith({ type: 'dissolve', frames: 12 });
    expect(transitionLeadFrames(clip, 30)).toBeCloseTo(12);
  });

  it('never eats more than the clip, its start or two seconds', () => {
    expect(transitionLeadFrames(clipWith({ type: 'dissolve', frames: 12 }, { durationFrames: 8 }), 30)).toBeCloseTo(8);
    expect(transitionLeadFrames(clipWith({ type: 'dissolve', frames: 12 }, { startFrame: 6 }), 30)).toBeCloseTo(6);
    expect(transitionLeadFrames(clipWith({ type: 'dissolve', frames: 240 }, { startFrame: 400, durationFrames: 400 }), 30)).toBeCloseTo(60);
  });

  it('is zero without a transition or for kinds that do not overlap', () => {
    expect(transitionLeadFrames(clipWith(undefined), 30)).toBe(0);
    expect(transitionLeadFrames(clipWith({ type: 'dissolve', frames: 12 }, { startFrame: 0 }), 30)).toBe(0);
  });
});

describe('transitionSample', () => {
  const fps = 30;

  it('is null outside the lead window', () => {
    const clip = clipWith({ type: 'dissolve', frames: 12 });
    expect(transitionSample(clip, 47, fps)).toBeNull();
    expect(transitionSample(clip, 60, fps)).toBeNull();
    expect(transitionSample(clip, 80, fps)).toBeNull();
  });

  it('aplica la easing al progreso y a los estilos', () => {
    const dissolve = transitionSample(
      clipWith({ type: 'dissolve', frames: 12, easing: 'ease-in' }),
      54,
      30,
    );
    expect(dissolve?.progress).toBeCloseTo(0.125);
    expect(dissolve?.opacity).toBeCloseTo(0.125);
    const slide = transitionSample(
      clipWith({ type: 'slide-left', frames: 12, easing: 'ease-out' }),
      54,
      30,
    );
    expect(slide?.progress).toBeCloseTo(0.875);
    expect(slide?.translateXPercent).toBeCloseTo(12.5);
    const wipe = transitionSample(
      clipWith({ type: 'wipe-left', frames: 12, easing: 'ease-in-out' }),
      54,
      30,
    );
    expect(wipe?.progress).toBeCloseTo(0.5);
  });

  it('reports progress from zero to one across the lead', () => {
    const clip = clipWith({ type: 'dissolve', frames: 12 });
    expect(transitionSample(clip, 48, fps)?.progress).toBeCloseTo(0);
    expect(transitionSample(clip, 54, fps)?.progress).toBeCloseTo(0.5);
    expect(transitionSample(clip, 59, fps)?.progress).toBeCloseTo(11 / 12);
  });

  it('fades the incoming clip for dissolve', () => {
    const sample = transitionSample(clipWith({ type: 'dissolve', frames: 12 }), 54, fps);
    expect(sample?.opacity).toBeCloseTo(0.5);
    expect(sample?.filter).toBeUndefined();
    expect(sample?.clipPath).toBeUndefined();
  });

  it('mixes to black and white without losing opacity', () => {
    const black = transitionSample(clipWith({ type: 'fade-black', frames: 12 }), 54, fps);
    expect(black?.opacity).toBe(1);
    expect(black?.filter).toBe('brightness(0.5)');
    const white = transitionSample(clipWith({ type: 'fade-white', frames: 12 }), 54, fps);
    expect(white?.opacity).toBe(1);
    expect(white?.filter).toBe('invert(1) brightness(0.5) invert(1)');
  });

  it('slides the incoming clip from the named edge', () => {
    expect(transitionSample(clipWith({ type: 'slide-left', frames: 12 }), 54, fps)?.translateXPercent).toBeCloseTo(50);
    expect(transitionSample(clipWith({ type: 'slide-right', frames: 12 }), 54, fps)?.translateXPercent).toBeCloseTo(-50);
    expect(transitionSample(clipWith({ type: 'slide-up', frames: 12 }), 54, fps)?.translateYPercent).toBeCloseTo(50);
    expect(transitionSample(clipWith({ type: 'slide-down', frames: 12 }), 54, fps)?.translateYPercent).toBeCloseTo(-50);
  });

  it('reveals wipes from the named edge', () => {
    expect(transitionSample(clipWith({ type: 'wipe-left', frames: 12 }), 54, fps)?.clipPath).toBe('inset(0% 50% 0% 0%)');
    expect(transitionSample(clipWith({ type: 'wipe-right', frames: 12 }), 54, fps)?.clipPath).toBe('inset(0% 0% 0% 50%)');
    expect(transitionSample(clipWith({ type: 'wipe-up', frames: 12 }), 54, fps)?.clipPath).toBe('inset(50% 0% 0% 0%)');
    expect(transitionSample(clipWith({ type: 'wipe-down', frames: 12 }), 54, fps)?.clipPath).toBe('inset(0% 0% 50% 0%)');
  });

  it('opens an iris circle from the center', () => {
    expect(transitionSample(clipWith({ type: 'iris', frames: 12 }), 54, fps)?.clipPath).toBe(
      'circle(35.4% at 50% 50%)',
    );
    expect(transitionSample(clipWith({ type: 'iris', frames: 12 }), 49, fps)?.clipPath).toBe(
      'circle(5.9% at 50% 50%)',
    );
  });
});
