import { describe, expect, it } from 'vitest';
import { createNeutralQualifier, type PowerWindow } from '@editor-ia/project-schema';
import { gradeMaskWeight } from './grade-mask';

function window(overrides: Partial<PowerWindow> = {}): PowerWindow {
  return {
    id: 'w1', kind: 'circle', enabled: true,
    x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 0,
    feather: 0, tracking: false, dx: 0, dy: 0,
    ...overrides,
  };
}

describe('gradeMaskWeight', () => {
  const off = createNeutralQualifier();

  it('is fully open when no key and no windows are active', () => {
    expect(gradeMaskWeight(200, 100, 50, 0.5, 0.5, off, [])).toBe(1);
  });

  it('selects only the chosen hue range', () => {
    const q = { ...off, enabled: true, hue: 0, hueWidth: 0.2, satMin: 0.3, satMax: 1, lumMin: 0, lumMax: 1, feather: 0 };
    // Pure red (hue 0) vs pure blue (hue ~0.66).
    expect(gradeMaskWeight(255, 0, 0, 0.5, 0.5, q, [])).toBeGreaterThan(0.9);
    expect(gradeMaskWeight(0, 0, 255, 0.5, 0.5, q, [])).toBeLessThan(0.1);
  });

  it('inverts the key when requested', () => {
    const q = { ...off, enabled: true, hue: 0, hueWidth: 0.2, satMin: 0.3, satMax: 1, lumMin: 0, lumMax: 1, feather: 0, invert: true };
    expect(gradeMaskWeight(255, 0, 0, 0.5, 0.5, q, [])).toBeLessThan(0.1);
    expect(gradeMaskWeight(0, 0, 255, 0.5, 0.5, q, [])).toBeGreaterThan(0.9);
  });

  it('limits the correction to a circle window', () => {
    const w = window();
    expect(gradeMaskWeight(128, 128, 128, 0.5, 0.5, off, [w])).toBeGreaterThan(0.9);
    expect(gradeMaskWeight(128, 128, 128, 0.02, 0.02, off, [w])).toBe(0);
  });

  it('honours tracking offsets', () => {
    const w = window({ dx: 0.3, dy: 0 });
    expect(gradeMaskWeight(128, 128, 128, 0.8, 0.5, off, [w])).toBeGreaterThan(0.5);
    expect(gradeMaskWeight(128, 128, 128, 0.5, 0.5, off, [w])).toBeLessThan(0.5);
  });

  it('combines qualifier and window', () => {
    const q = { ...off, enabled: true, hue: 0, hueWidth: 0.2, satMin: 0.3, satMax: 1, lumMin: 0, lumMax: 1, feather: 0 };
    const w = window({ x: 0.1, y: 0.1 });
    // Red pixel but outside the window: key passes, window blocks.
    expect(gradeMaskWeight(255, 0, 0, 0.9, 0.9, q, [w])).toBeLessThan(0.1);
  });
});
