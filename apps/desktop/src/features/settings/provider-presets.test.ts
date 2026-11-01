import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, presetById } from './provider-presets';

describe('presets de proveedor', () => {
  it('incluye NVIDIA NIM con el endpoint y modelo oficiales', () => {
    const nvidia = presetById('nvidia-nim');
    expect(nvidia).not.toBeNull();
    expect(nvidia?.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(nvidia?.model).toBe('deepseek-ai/deepseek-v4.1-flash');
    expect(nvidia?.keyHint).toContain('nvapi-');
  });

  it('todos los presets son OpenAI-compatible con URL https o local', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(preset.baseUrl.endsWith('/v1')).toBe(true);
      expect(preset.model.length).toBeGreaterThan(0);
    }
  });

  it('devuelve null para un id desconocido', () => {
    expect(presetById('no-existe')).toBeNull();
  });
});
