import { describe, expect, it } from 'vitest';
import {
  PREVIEW_PROFILE_KEY,
  adaptEffectsForPreview,
  loadPreviewProfile,
  savePreviewProfile,
  temporalDenoiseForProfile,
} from './preview-profile';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe('preview profiles', () => {
  it('defaults to balanced and rejects unknown values', () => {
    expect(loadPreviewProfile(memoryStorage())).toBe('balanced');
    expect(
      loadPreviewProfile(memoryStorage({ [PREVIEW_PROFILE_KEY]: 'turbo' })),
    ).toBe('balanced');
    expect(
      loadPreviewProfile(memoryStorage({ [PREVIEW_PROFILE_KEY]: 'maximum' })),
    ).toBe('maximum');
  });

  it('persists the selected profile', () => {
    const storage = memoryStorage();
    savePreviewProfile('efficient', storage);
    expect(storage.data[PREVIEW_PROFILE_KEY]).toBe('efficient');
  });

  it('caps only the heavy blur in efficient and balanced preview', () => {
    const effects = { blur: 40, brightness: 0.2 };
    expect(adaptEffectsForPreview(effects, 'efficient')).toEqual({
      blur: 4,
      brightness: 0.2,
    });
    expect(adaptEffectsForPreview(effects, 'balanced')).toEqual({
      blur: 20,
      brightness: 0.2,
    });
    expect(adaptEffectsForPreview(effects, 'maximum')).toEqual(effects);
  });

  it('caps the SVG sharpen only in efficient preview', () => {
    expect(adaptEffectsForPreview({ sharpen: 0.9 }, 'efficient')).toEqual({
      sharpen: 0.35,
    });
    expect(adaptEffectsForPreview({ sharpen: 0.9 }, 'balanced')).toEqual({
      sharpen: 0.9,
    });
    expect(adaptEffectsForPreview({ sharpen: 0.9 }, 'maximum')).toEqual({
      sharpen: 0.9,
    });
  });

  it('acota el radio de glow sin cambiar su intensidad', () => {
    const glow = { intensity: 0.7, radius: 60, threshold: 0.4 };
    expect(adaptEffectsForPreview({ glow }, 'efficient')?.glow).toEqual({
      ...glow,
      radius: 8,
    });
    expect(adaptEffectsForPreview({ glow }, 'balanced')?.glow).toEqual({
      ...glow,
      radius: 20,
    });
    expect(adaptEffectsForPreview({ glow }, 'maximum')?.glow).toEqual(glow);
  });

  it('does not invent effects when there are none', () => {
    expect(adaptEffectsForPreview(undefined, 'efficient')).toBeUndefined();
  });

  it('apaga el denoise temporal sólo en el perfil eficiente', () => {
    expect(temporalDenoiseForProfile('efficient')).toBe(false);
    expect(temporalDenoiseForProfile('balanced')).toBe(true);
    expect(temporalDenoiseForProfile('maximum')).toBe(true);
  });
});
