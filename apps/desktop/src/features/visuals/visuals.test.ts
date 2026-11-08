import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  FALLBACK_VISUAL_CATALOG,
  batchTransitionIn,
  dipColorForClip,
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

  it('el catálogo local tiene ids únicos y las transiciones por lote', () => {
    const presetIds = new Set(FALLBACK_VISUAL_CATALOG.presets.map((preset) => preset.id));
    expect(presetIds.size).toBe(FALLBACK_VISUAL_CATALOG.presets.length);
    // Mismo conjunto que catalog_transitions() en Rust: todo tipo del schema
    // es aplicable por lote porque la vista resuelve `color` (dip-color) y un
    // mate por clip (luma-wipe) antes de escribir.
    expect(FALLBACK_VISUAL_CATALOG.transitions.map((transition) => transition.id)).toEqual([
      'dissolve',
      'fade-black',
      'fade-white',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
      'slide-3d-left',
      'slide-3d-right',
      'slide-3d-up',
      'slide-3d-down',
      'wipe-left',
      'wipe-right',
      'wipe-up',
      'wipe-down',
      'iris',
      'dip-color',
      'luma-wipe',
    ]);
  });

  it('batchTransitionIn exige color para dip-color y mate para luma-wipe', () => {
    const clip = { durationFrames: 500 } as Clip;
    expect(batchTransitionIn(clip, 'dip-color', 12)).toBeUndefined();
    expect(batchTransitionIn(clip, 'dip-color', 12, { color: '#2244aa' })).toEqual({
      type: 'dip-color',
      frames: 12,
      color: '#2244aa',
    });
    expect(batchTransitionIn(clip, 'luma-wipe', 15)).toBeUndefined();
    expect(batchTransitionIn(clip, 'luma-wipe', 15, { mateClipId: 'm1' })).toEqual({
      type: 'luma-wipe',
      frames: 15,
      mateClipId: 'm1',
    });
    expect(batchTransitionIn(clip, 'dissolve', 300)).toEqual({
      type: 'dissolve',
      frames: 120,
    });
  });

  it('dipColorForClip: override > color propio del clip > general', () => {
    const own = { type: 'dip-color', frames: 12, color: '#123456' } as const;
    const other = { type: 'dissolve', frames: 12 } as const;
    // Sin override ni color propio cae al general.
    expect(dipColorForClip(undefined, undefined, '#1b2a4a')).toBe('#1b2a4a');
    expect(dipColorForClip(other, undefined, '#1b2a4a')).toBe('#1b2a4a');
    // El color que el clip ya tiene en transitionIn se conserva.
    expect(dipColorForClip(own, undefined, '#1b2a4a')).toBe('#123456');
    // El override de la vista gana sobre el color propio.
    expect(dipColorForClip(own, '#ff0000', '#1b2a4a')).toBe('#ff0000');
    // `null` fuerza el general aunque el clip tenga color propio.
    expect(dipColorForClip(own, null, '#1b2a4a')).toBe('#1b2a4a');
  });
});
