import { describe, expect, it } from 'vitest';
import type { VisualCatalog, VisualEffectSpec } from '../../services/project-service';
import {
  EFFECT_CATEGORIES,
  buildEffectRegistry,
  buildTransitionRegistry,
  categoryLabel,
  effectLabelForKey,
  parameterGroup,
} from './registry';

function spec(
  id: string,
  category: string,
  parameters: { key: string; label: string; min: number; max: number; default: number }[],
): VisualEffectSpec {
  return {
    id,
    label: id === 'brightness' ? 'Brillo' : id === 'glow' ? 'Glow' : id,
    category,
    description: `${id} description`,
    filters: ['eq'],
    available: true,
    parameters: parameters.map((item) => ({ ...item, unit: 'range' })),
  };
}

const catalog: VisualCatalog = {
  ffmpegAvailable: true,
  effects: [
    spec('brightness', 'color', [{ key: 'brightness', label: 'Brillo', min: -1, max: 1, default: 0 }]),
    spec('denoise', 'stylize', [{ key: 'denoise', label: 'Cantidad', min: 0, max: 1, default: 0.3 }]),
    spec('sharpen', 'stylize', [{ key: 'sharpen', label: 'Nitidez', min: 0, max: 1, default: 0.3 }]),
    spec('glow', 'stylize', [
      { key: 'intensity', label: 'Intensidad', min: 0, max: 1, default: 0.35 },
      { key: 'radius', label: 'Radio', min: 1, max: 80, default: 20 },
    ]),
    spec('motionBlur', 'motion', [
      { key: 'frames', label: 'Frames', min: 2, max: 12, default: 4 },
      { key: 'intensity', label: 'Intensidad', min: 0, max: 1, default: 0.5 },
    ]),
    spec('lut', 'color', [{ key: 'lutIntensity', label: 'Intensidad', min: 0, max: 1, default: 1 }]),
    spec('curves', 'color', []),
    spec('future', 'unknown-category', []),
  ],
  presets: [],
  transitions: [
    { id: 'dissolve', label: 'Disolvencia', description: 'alfa', defaultFrames: 12, maxFrames: 120, overlapsPrevious: true, available: true },
  ],
  filters: [],
};

describe('buildEffectRegistry', () => {
  const registry = buildEffectRegistry(catalog);

  it('registers every catalog effect once', () => {
    expect(registry.map((effect) => effect.id)).toEqual([
      'brightness',
      'denoise',
      'sharpen',
      'glow',
      'motionBlur',
      'lut',
      'curves',
      'future',
    ]);
    expect(new Set(registry.map((effect) => effect.id)).size).toBe(registry.length);
  });

  it('declares preview, export, license and status for each effect', () => {
    for (const effect of registry) {
      expect(effect.version).toBe('1.0.0');
      expect(effect.preview).toMatch(/^(css|webgl|canvas|none)$/);
      expect(effect.exportEngine).toBe('ffmpeg');
      expect(effect.requirements).toBe('cpu');
      expect(effect.license).toEqual({ spdx: 'MIT', holder: 'Editor IA' });
      expect(effect.clipKinds).toEqual(['video', 'image', 'freeze']);
      expect(['available', 'export-only', 'requires-file', 'manual']).toContain(effect.status);
    }
    expect(registry.find((effect) => effect.id === 'brightness')?.preview).toBe('css');
    expect(registry.find((effect) => effect.id === 'denoise')?.status).toBe('available');
    expect(registry.find((effect) => effect.id === 'denoise')?.preview).toBe('webgl');
    expect(registry.find((effect) => effect.id === 'sharpen')?.preview).toBe('css');
    expect(registry.find((effect) => effect.id === 'sharpen')?.status).toBe('available');
    expect(registry.find((effect) => effect.id === 'glow')?.preview).toBe('css');
    expect(registry.find((effect) => effect.id === 'glow')?.status).toBe('available');
    expect(registry.find((effect) => effect.id === 'motionBlur')?.preview).toBe('canvas');
    expect(registry.find((effect) => effect.id === 'motionBlur')?.status).toBe('available');
    expect(registry.find((effect) => effect.id === 'lut')?.status).toBe('requires-file');
    expect(registry.find((effect) => effect.id === 'lut')?.preview).toBe('webgl');
    expect(registry.find((effect) => effect.id === 'curves')?.status).toBe('manual');
    expect(registry.find((effect) => effect.id === 'curves')?.preview).toBe('webgl');
    expect(registry.find((effect) => effect.id === 'future')?.preview).toBe('none');
  });

  it('groups nested parameters by effect field', () => {
    expect(parameterGroup('glow', 'intensity')).toBe('glow');
    expect(parameterGroup('brightness', 'brightness')).toBeNull();
    expect(parameterGroup('denoise', 'denoise')).toBeNull();
  });

  it('keeps every default inside its declared range', () => {
    for (const effect of registry) {
      for (const parameter of effect.parameters) {
        expect(parameter.default).toBeGreaterThanOrEqual(parameter.min);
        expect(parameter.default).toBeLessThanOrEqual(parameter.max);
      }
    }
  });

  it('resolves the label of an active effect key, including nested objects', () => {
    expect(effectLabelForKey(registry, 'brightness')).toBe('Brillo');
    expect(effectLabelForKey(registry, 'glow')).toBe('Glow');
    expect(effectLabelForKey(registry, 'desconocido')).toBe('desconocido');
  });

  it('registra las transiciones con el mismo contrato', () => {
    const transitions = buildTransitionRegistry(catalog);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      id: 'dissolve',
      version: '1.0.0',
      preview: 'css',
      exportEngine: 'ffmpeg',
      requirements: 'cpu',
      license: { spdx: 'MIT', holder: 'Editor IA' },
      status: 'available',
    });
    expect(transitions[0]?.clipKinds).toEqual(['video', 'image', 'freeze']);
  });

  it('labels known categories and falls back to the raw id', () => {
    expect(categoryLabel('color')).toBe(EFFECT_CATEGORIES.color);
    expect(categoryLabel('otra')).toBe('otra');
  });
});
