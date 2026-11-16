import { describe, expect, it } from 'vitest';
import {
  spectrumPropsFromRegion,
  spectrumRegion,
} from './PreviewSpectrumRegion';
import type { ClipEffects } from '@editor-ia/project-schema';

type Spectrum = NonNullable<ClipEffects['spectrum']>;

const base: Spectrum = {};

describe('spectrumRegion', () => {
  it('anchors bottom-center by default', () => {
    const region = spectrumRegion(base);
    expect(region.l).toBeCloseTo(0);
    expect(region.t).toBeCloseTo(0.72);
    expect(region.r).toBeCloseTo(1);
    expect(region.b).toBeCloseTo(1);
  });

  it('applies x offset, width and y lift', () => {
    const region = spectrumRegion({ width: 0.5, height: 0.2, x: 1, y: 0.3 });
    // span = 0.5 → l = 0.25 + 0.25 = 0.5, r = 1.0 (mitad derecha del frame)
    expect(region.l).toBeCloseTo(0.5);
    expect(region.r).toBeCloseTo(1);
    expect(region.t).toBeCloseTo(0.5);
    expect(region.b).toBeCloseTo(0.7);
  });
});

describe('spectrumPropsFromRegion', () => {
  it('round-trips the default region', () => {
    const props = spectrumPropsFromRegion(spectrumRegion(base));
    expect(props.width).toBeCloseTo(1);
    expect(props.height).toBeCloseTo(0.28);
    expect(props.x).toBeCloseTo(0);
    expect(props.y).toBeCloseTo(0);
  });

  it('round-trips a moved and resized region', () => {
    const spec: Spectrum = { width: 0.6, height: 0.3, x: -0.4, y: 0.2 };
    const props = spectrumPropsFromRegion(spectrumRegion(spec));
    expect(props.width).toBeCloseTo(0.6);
    expect(props.height).toBeCloseTo(0.3);
    expect(props.x).toBeCloseTo(-0.4);
    expect(props.y).toBeCloseTo(0.2);
  });

  it('keeps width inside schema bounds', () => {
    const props = spectrumPropsFromRegion({ l: 0, t: 0.5, r: 2, b: 0.9 });
    expect(props.width).toBe(1);
    expect(props.height).toBeCloseTo(0.4);
  });
});
