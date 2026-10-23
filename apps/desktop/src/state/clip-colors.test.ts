import { describe, expect, it } from 'vitest';
import { CLIP_COLORS, clipColorHex, clipMatchesColorFilter } from './clip-colors';

describe('clip colors', () => {
  it('keeps eight unique tags with valid hex values', () => {
    expect(CLIP_COLORS).toHaveLength(8);
    expect(new Set(CLIP_COLORS.map((color) => color.id)).size).toBe(8);
    for (const color of CLIP_COLORS) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('matches the active filter and lets everything through with all', () => {
    expect(clipMatchesColorFilter('rose', 'rose')).toBe(true);
    expect(clipMatchesColorFilter('rose', 'teal')).toBe(false);
    expect(clipMatchesColorFilter(undefined, 'rose')).toBe(false);
    expect(clipMatchesColorFilter(undefined, 'all')).toBe(true);
    expect(clipMatchesColorFilter('violet', 'all')).toBe(true);
    expect(clipColorHex('teal')).toBe('#4f9188');
    expect(clipColorHex(undefined)).toBeUndefined();
  });
});
