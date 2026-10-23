import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  FALLBACK_VISUAL_CATALOG,
  mergePresetEffects,
  quickEffects,
  safeTransitionFrames,
} from './visuals';

describe('Visuals Studio helpers', () => {
  it('conserva fades y LUT al aplicar un preset', () => {
    const next = mergePresetEffects(
      {
        brightness: 0.4,
        fadeInFrames: 12,
        fadeOutFrames: 8,
        lutFile: 'media/look.cube',
        lutIntensity: 0.7,
      },
      FALLBACK_VISUAL_CATALOG.presets.find((preset) => preset.id === 'noir')!,
    );
    expect(next.fadeInFrames).toBe(12);
    expect(next.fadeOutFrames).toBe(8);
    expect(next.lutFile).toBe('media/look.cube');
    expect(next.lutIntensity).toBe(0.7);
    expect(next.grayscale).toBe(true);
    expect(next.brightness).toBeUndefined();
  });

  it('mezcla ajustes rápidos y borra los flags al desactivarlos', () => {
    const next = quickEffects(
      {
        brightness: 0.2,
        contrast: 1.1,
        saturation: 0.9,
        temperature: -0.1,
        vignette: 0.2,
        blur: 1.5,
        sharpen: 0.5,
        grayscale: false,
        sepia: false,
      },
      { grayscale: true, sepia: true, fadeInFrames: 4 },
    );
    expect(next.grayscale).toBeUndefined();
    expect(next.sepia).toBeUndefined();
    expect(next.fadeInFrames).toBe(4);
    expect(next.brightness).toBe(0.2);
  });

  it('acota la transición a la duración del clip y al máximo de 120', () => {
    const clip = { durationFrames: 8 } as Clip;
    expect(safeTransitionFrames(12, clip)).toBe(8);
    expect(safeTransitionFrames(300, { ...clip, durationFrames: 500 })).toBe(120);
  });

  it('el catálogo local tiene ids únicos y las siete transiciones', () => {
    const presetIds = new Set(FALLBACK_VISUAL_CATALOG.presets.map((preset) => preset.id));
    expect(presetIds.size).toBe(FALLBACK_VISUAL_CATALOG.presets.length);
    expect(FALLBACK_VISUAL_CATALOG.transitions.map((transition) => transition.id)).toEqual([
      'dissolve',
      'fade-black',
      'fade-white',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
    ]);
  });
});
