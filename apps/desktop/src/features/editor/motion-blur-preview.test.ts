import { describe, expect, it } from 'vitest';
import {
  motionBlurWeights,
  newestMotionBlurWeight,
  normalizedMotionBlur,
} from './motion-blur-preview';

describe('motion blur preview', () => {
  it('normaliza frames e intensidad con defaults seguros', () => {
    expect(normalizedMotionBlur(undefined)).toBeNull();
    expect(normalizedMotionBlur({ frames: 20, intensity: 2 })).toEqual({
      frames: 12,
      intensity: 1,
    });
    expect(normalizedMotionBlur({ frames: 1, intensity: -3 })).toBeNull();
    expect(normalizedMotionBlur({ frames: Number.NaN, intensity: Number.NaN })).toEqual({
      frames: 4,
      intensity: 0.5,
    });
  });

  it('reproduce los pesos de tmix (oldest→newest)', () => {
    const weights = motionBlurWeights(4, 0.6);
    expect(weights).toHaveLength(4);
    const total = weights.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 8);
    // 0.6^3, 0.6^2, 0.6, 1 normalizados.
    expect(weights[3]).toBeCloseTo(1 / (0.216 + 0.36 + 0.6 + 1), 8);
    expect(weights[0]).toBeCloseTo(0.216 / 2.176, 8);
    expect(weights[3]).toBeCloseTo(newestMotionBlurWeight(4, 0.6), 8);
  });

  it('el peso nuevo coincide con la fórmula cerrada y los extremos', () => {
    expect(newestMotionBlurWeight(4, 0)).toBe(1);
    expect(newestMotionBlurWeight(4, 1)).toBe(0.25);
    expect(newestMotionBlurWeight(2, 0.5)).toBeCloseTo(2 / 3, 8);
    expect(newestMotionBlurWeight(12, 0.8)).toBeCloseTo(
      motionBlurWeights(12, 0.8)[11]!,
      8,
    );
  });
});
