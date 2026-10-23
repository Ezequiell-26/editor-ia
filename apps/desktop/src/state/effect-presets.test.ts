import { describe, expect, it } from 'vitest';
import { ClipEffectsSchema } from '@editor-ia/project-schema';
import { EFFECT_PRESETS, applyEffectPreset } from './effect-presets';

describe('efeitos creativos', () => {
  it('cada preset tiene id único y campos válidos para el esquema', () => {
    expect(new Set(EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(
      EFFECT_PRESETS.length,
    );
    for (const preset of EFFECT_PRESETS) {
      expect(ClipEffectsSchema.safeParse(preset.settings).success).toBe(true);
    }
  });

  it('reemplaza el grade pero conserva fades y LUT', () => {
    const merged = applyEffectPreset(
      {
        brightness: 0.4,
        fadeInFrames: 8,
        fadeOutFrames: 12,
        lutFile: 'media/luts/x.cube',
        lutIntensity: 0.5,
      },
      EFFECT_PRESETS.find((preset) => preset.id === 'noir')!,
    );
    expect(merged.grayscale).toBe(true);
    expect(merged.brightness).toBeUndefined();
    expect(merged.fadeInFrames).toBe(8);
    expect(merged.fadeOutFrames).toBe(12);
    expect(merged.lutFile).toBe('media/luts/x.cube');
    expect(merged.lutIntensity).toBe(0.5);
  });
});
