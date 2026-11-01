import { describe, expect, it } from 'vitest';
import {
  appendGrainFilter,
  clampGrain,
  grainFilterId,
  grainMatrix,
} from './grain-preview';

describe('preview de grano', () => {
  it('acota la intensidad y genera un id estable', () => {
    expect(clampGrain(undefined)).toBe(0);
    expect(clampGrain(-1)).toBe(0);
    expect(clampGrain(2)).toBe(1);
    expect(grainFilterId('c1')).toBe('olyvia-grain-c1');
  });

  it('el alfa de la matriz sigue la intensidad', () => {
    expect(grainMatrix(0.5)).toContain('0 0 0 0.500 0');
    expect(grainMatrix(0)).toContain('0 0 0 0.000 0');
  });

  it('agrega la referencia sin perder filtros previos', () => {
    expect(appendGrainFilter('brightness(1.2)', 'c1', 0.4)).toBe(
      'brightness(1.2) url(#olyvia-grain-c1)',
    );
    expect(appendGrainFilter('', 'c1', 0.4)).toBe('url(#olyvia-grain-c1)');
    expect(appendGrainFilter('brightness(1.2)', 'c1', 0)).toBe('brightness(1.2)');
  });
});
