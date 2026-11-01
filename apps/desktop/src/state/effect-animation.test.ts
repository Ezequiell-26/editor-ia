import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import { effectsAtFrame } from './effect-animation';

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c',
    kind: 'video',
    trackId: 't',
    startFrame: 30,
    durationFrames: 60,
    source: { type: 'asset', assetId: 'a', inFrame: 0, outFrame: 60 },
    effects: { brightness: 0.1, blur: 3 },
    ...overrides,
  } as Clip;
}

describe('effectsAtFrame', () => {
  it('devuelve el look estático sin keyframes', () => {
    const value = clip();
    expect(effectsAtFrame(value, 40)).toBe('effects' in value ? value.effects : undefined);
  });

  it('mezcla el valor animado sobre el look y conserva el resto', () => {
    const value = clip({
      effectKeyframes: [
        { frame: 0, property: 'brightness', value: -0.4 },
        { frame: 20, property: 'brightness', value: 0.6 },
      ],
    });
    expect(effectsAtFrame(value, 30)).toEqual({ brightness: -0.4, blur: 3 });
    const middle = effectsAtFrame(value, 40);
    expect(middle?.brightness).toBeCloseTo(0.1);
    expect(middle?.blur).toBe(3);
    expect(effectsAtFrame(value, 70)).toEqual({ brightness: 0.6, blur: 3 });
  });

  it('clampea el frame relativo al clip', () => {
    const value = clip({
      effectKeyframes: [
        { frame: 10, property: 'contrast', value: 1.4 },
      ],
    });
    expect(effectsAtFrame(value, 0)?.contrast).toBe(1.4);
    expect(effectsAtFrame(value, 999)?.contrast).toBe(1.4);
  });

  it('anima la temperatura como propiedad plana', () => {
    const value = clip({
      effects: { temperature: 0.2 },
      effectKeyframes: [
        { frame: 0, property: 'temperature', value: -0.5 },
        { frame: 40, property: 'temperature', value: 0.5 },
      ],
    });
    expect(effectsAtFrame(value, 30)?.temperature).toBe(-0.5);
    expect(effectsAtFrame(value, 50)?.temperature).toBeCloseTo(0);
    expect(effectsAtFrame(value, 70)?.temperature).toBe(0.5);
  });

  it('anima la intensidad del LUT con el mismo muestreo', () => {
    const value = clip({
      effects: { lutFile: 'luts/invert.cube', lutIntensity: 1 },
      effectKeyframes: [
        { frame: 0, property: 'lutIntensity', value: 0 },
        { frame: 40, property: 'lutIntensity', value: 1 },
      ],
    });
    expect(effectsAtFrame(value, 30)?.lutIntensity).toBe(0);
    expect(effectsAtFrame(value, 50)?.lutIntensity).toBeCloseTo(0.5);
    expect(effectsAtFrame(value, 70)?.lutIntensity).toBe(1);
  });

  it('anima la intensidad de glow dentro del objeto glow', () => {
    const value = clip({
      effects: { glow: { intensity: 0.2, radius: 12, threshold: 0.4 } },
      effectKeyframes: [
        { frame: 0, property: 'glowIntensity', value: 0 },
        { frame: 20, property: 'glowIntensity', value: 0.8 },
      ],
    });
    expect(effectsAtFrame(value, 30)?.glow).toEqual({
      intensity: 0,
      radius: 12,
      threshold: 0.4,
    });
    expect(effectsAtFrame(value, 40)?.glow?.intensity).toBeCloseTo(0.4);
    expect(effectsAtFrame(value, 70)?.glow?.intensity).toBe(0.8);
  });

  it('anima el grano como propiedad plana', () => {
    const value = clip({
      effects: { grain: 0 },
      effectKeyframes: [
        { frame: 0, property: 'grain', value: 0 },
        { frame: 20, property: 'grain', value: 1 },
      ],
    });
    expect(effectsAtFrame(value, 30)?.grain).toBe(0);
    expect(effectsAtFrame(value, 40)?.grain).toBeCloseTo(0.5);
    expect(effectsAtFrame(value, 70)?.grain).toBe(1);
  });
});
