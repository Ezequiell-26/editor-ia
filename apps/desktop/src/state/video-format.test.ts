import { describe, expect, it } from 'vitest';
import {
  FPS_PRESETS,
  FORMAT_PRESETS,
  aspectRatioOf,
  evenDimension,
  formatFps,
  gcd,
  validFpsRange,
} from './video-format';

describe('formatos de video', () => {
  it('simplifica cualquier proporción entera', () => {
    expect(aspectRatioOf(1920, 1080)).toBe('16:9');
    expect(aspectRatioOf(1080, 1920)).toBe('9:16');
    expect(aspectRatioOf(1440, 1080)).toBe('4:3');
    expect(aspectRatioOf(1366, 768)).toBe('683:384');
    expect(aspectRatioOf(2560, 1080)).toBe('64:27');
    expect(gcd(1920, 1080)).toBe(120);
  });

  it('redondea a dimensiones pares y dentro del rango', () => {
    expect(evenDimension(1921)).toBe(1922);
    expect(evenDimension(1920.4)).toBe(1920);
    expect(evenDimension(2)).toBe(16);
    expect(evenDimension(99_999)).toBe(16_384);
    expect(evenDimension(Number.NaN, 1080)).toBe(1080);
  });

  it('formatea fps exactos y fraccionarios', () => {
    expect(formatFps(30, 1)).toBe('30');
    expect(formatFps(24_000, 1_001)).toBe('23.976');
    expect(formatFps(60_000, 1_001)).toBe('59.94');
    expect(formatFps(0, 0)).toBe('30');
  });

  it('ofrece presets coherentes de formato y fps', () => {
    for (const preset of FORMAT_PRESETS) {
      expect(preset.width % 2).toBe(0);
      expect(preset.height % 2).toBe(0);
    }
    for (const preset of FPS_PRESETS) {
      expect(preset.num).toBeGreaterThan(0);
      expect(preset.den).toBeGreaterThan(0);
    }
    expect(FPS_PRESETS.some((preset) => preset.num === 24_000 && preset.den === 1_001)).toBe(true);
  });

  it('limita fps a un rango práctico de 1–240', () => {
    expect(validFpsRange(24_000, 1_001)).toBe(true);
    expect(validFpsRange(240, 1)).toBe(true);
    expect(validFpsRange(1, 1)).toBe(true);
    expect(validFpsRange(300, 1)).toBe(false);
    expect(validFpsRange(1, 2)).toBe(false);
    expect(validFpsRange(0, 1)).toBe(false);
    expect(validFpsRange(30, 0)).toBe(false);
  });
});
