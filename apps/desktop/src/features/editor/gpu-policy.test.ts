import { describe, expect, it } from 'vitest';
import { gpuRecommendation } from './gpu-policy';

describe('recomendación de GPU para el render', () => {
  it('no recomienda GPU para un clip corto en 1080p', () => {
    const decision = gpuRecommendation({
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      preset: 'veryfast',
    });
    expect(decision.recommended).toBe(false);
    expect(decision.reason).toMatch(/software/i);
  });

  it('recomienda GPU para 4K o más', () => {
    const decision = gpuRecommendation({
      width: 3840,
      height: 2160,
      durationSeconds: 5,
      preset: 'veryfast',
    });
    expect(decision.recommended).toBe(true);
  });

  it('recomienda GPU para una timeline larga aunque sea 1080p', () => {
    const decision = gpuRecommendation({
      width: 1920,
      height: 1080,
      durationSeconds: 300,
      preset: 'veryfast',
    });
    expect(decision.recommended).toBe(true);
  });

  it('recomienda GPU para presets pesados', () => {
    for (const preset of ['medium', 'slow', 'slower']) {
      const decision = gpuRecommendation({
        width: 1920,
        height: 1080,
        durationSeconds: 5,
        preset,
      });
      expect(decision.recommended).toBe(true);
    }
  });
});
