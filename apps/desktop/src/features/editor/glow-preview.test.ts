import { describe, expect, it } from 'vitest';
import {
  appendGlowFilter,
  glowFilterId,
  glowStdDeviation,
  glowThresholdCurve,
  normalizeGlow,
} from './glow-preview';

describe('preview de glow', () => {
  it('normaliza los parámetros y usa defaults seguros', () => {
    expect(normalizeGlow({})).toEqual({ intensity: 0.35, radius: 20, threshold: 0.5 });
    expect(normalizeGlow({ intensity: 2, radius: 0, threshold: -1 })).toEqual({
      intensity: 1,
      radius: 1,
      threshold: 0,
    });
  });

  it('convierte el radio a un desenfoque acotado', () => {
    expect(glowStdDeviation(1)).toBe(0.5);
    expect(glowStdDeviation(60)).toBe(20);
    expect(glowStdDeviation(1000)).toBe(24);
  });

  it('la curva de umbral resta el fondo sin apagar el halo', () => {
    const low = glowThresholdCurve(0.2);
    const high = glowThresholdCurve(0.8);
    expect(low.slope).toBe(1);
    expect(low.intercept).toBeGreaterThan(high.intercept);
    expect(high.intercept).toBeCloseTo(-0.24, 5);
  });

  it('referencia el filtro sólo cuando hay intensidad', () => {
    const glow = normalizeGlow({ intensity: 0.6, radius: 20, threshold: 0.5 });
    expect(appendGlowFilter('brightness(1.2)', 'c1', glow)).toBe(
      'brightness(1.2) url(#olyvia-glow-c1)',
    );
    expect(appendGlowFilter('', 'c1', glow)).toBe('url(#olyvia-glow-c1)');
    expect(appendGlowFilter('brightness(1.2)', 'c1', normalizeGlow({ intensity: 0 }))).toBe(
      'brightness(1.2)',
    );
    expect(glowFilterId('c1')).toBe('olyvia-glow-c1');
  });
});
