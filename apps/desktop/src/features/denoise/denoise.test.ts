import { describe, expect, it } from 'vitest';
import {
  DENOISE_PRESETS,
  clampDenoiseStrength,
  denoiseFilterSummary,
  formatDenoiseBytes,
  formatDenoiseDuration,
} from './denoise';

describe('Denoise Studio helpers', () => {
  it('ofrece tres preajustes con etiqueta y detalle', () => {
    expect(DENOISE_PRESETS.map((preset) => preset.id)).toEqual([
      'fast',
      'balanced',
      'quality',
    ]);
    for (const preset of DENOISE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.detail.length).toBeGreaterThan(0);
    }
  });

  it('acota la fuerza entre 1 y 100 y tolera valores inválidos', () => {
    expect(clampDenoiseStrength(-4)).toBe(1);
    expect(clampDenoiseStrength(0)).toBe(1);
    expect(clampDenoiseStrength(55.4)).toBe(55);
    expect(clampDenoiseStrength(150)).toBe(100);
    expect(clampDenoiseStrength(Number.NaN)).toBe(55);
  });

  it('resume el filtro con temporal y detalle solo cuando aplican', () => {
    expect(denoiseFilterSummary('fast', 40, true, false)).toContain('temporal');
    expect(denoiseFilterSummary('fast', 40, false, true)).toContain('detalle');
    expect(denoiseFilterSummary('quality', 40, true, false)).not.toContain('temporal');
  });

  it('formatea duración y peso de forma legible', () => {
    expect(formatDenoiseDuration(null)).toBe('—');
    expect(formatDenoiseDuration(2.4)).toBe('2.4 s');
    expect(formatDenoiseDuration(75)).toBe('1 min 15 s');
    expect(formatDenoiseBytes(512)).toBe('1 KB');
    expect(formatDenoiseBytes(1_048_576)).toBe('1.0 MB');
  });
});
