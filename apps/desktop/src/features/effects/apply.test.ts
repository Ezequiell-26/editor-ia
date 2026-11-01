import { describe, expect, it } from 'vitest';
import { ClipEffectsSchema } from '@editor-ia/project-schema';
import type { VisualCatalog, VisualEffectSpec } from '../../services/project-service';
import { buildEffectRegistry } from './registry';
import { applyEffectValues, defaultValues, valuesFromClip } from './apply';

function spec(
  id: string,
  parameters: { key: string; label: string; min: number; max: number; default: number }[],
): VisualEffectSpec {
  return {
    id,
    label: id,
    category: 'stylize',
    description: id,
    filters: ['eq'],
    available: true,
    parameters: parameters.map((item) => ({ ...item, unit: 'range' })),
  };
}

const catalog: VisualCatalog = {
  ffmpegAvailable: true,
  effects: [
    spec('brightness', [{ key: 'brightness', label: 'Brillo', min: -1, max: 1, default: 0 }]),
    spec('glow', [
      { key: 'intensity', label: 'Intensidad', min: 0, max: 1, default: 0.35 },
      { key: 'radius', label: 'Radio', min: 1, max: 80, default: 20 },
    ]),
    spec('denoise', [{ key: 'denoise', label: 'Cantidad', min: 0, max: 1, default: 0.3 }]),
    spec('curves', []),
    spec('motionBlur', [
      { key: 'frames', label: 'Frames', min: 2, max: 12, default: 4 },
      { key: 'intensity', label: 'Intensidad', min: 0, max: 1, default: 0.5 },
    ]),
  ],
  presets: [],
  transitions: [],
  filters: [],
};

const registry = buildEffectRegistry(catalog);
const effect = (id: string) => registry.find((item) => item.id === id)!;

describe('defaultValues', () => {
  it('reads the declared defaults', () => {
    expect(defaultValues(effect('brightness'))).toEqual({ brightness: 0 });
    expect(defaultValues(effect('glow'))).toEqual({ intensity: 0.35, radius: 20 });
  });
});

describe('valuesFromClip', () => {
  it('reads top-level values and falls back to defaults', () => {
    expect(valuesFromClip({ brightness: 0.4 }, effect('brightness'))).toEqual({ brightness: 0.4 });
    expect(valuesFromClip(undefined, effect('brightness'))).toEqual({ brightness: 0 });
  });

  it('reads nested effect objects', () => {
    const values = valuesFromClip(
      { glow: { intensity: 0.6, radius: 30, threshold: 0.5 } },
      effect('glow'),
    );
    expect(values).toEqual({ intensity: 0.6, radius: 30 });
  });
});

describe('applyEffectValues', () => {
  it('sets a scalar and clamps it to the declared range', () => {
    const next = applyEffectValues(undefined, effect('brightness'), { brightness: 5 });
    expect(next.brightness).toBe(1);
    expect(ClipEffectsSchema.safeParse(next).success).toBe(true);
  });

  it('merges a nested effect and preserves other effects', () => {
    const next = applyEffectValues(
      { brightness: 0.2, glow: { intensity: 0.1, radius: 10, threshold: 0.6 } },
      effect('glow'),
      { intensity: 0.8, radius: 40 },
    );
    expect(next.brightness).toBe(0.2);
    expect(next.glow).toEqual({ intensity: 0.8, radius: 40, threshold: 0.6 });
    expect(ClipEffectsSchema.safeParse(next).success).toBe(true);
  });

  it('writes an export-only effect', () => {
    const next = applyEffectValues(undefined, effect('denoise'), { denoise: 0.7 });
    expect(next.denoise).toBe(0.7);
    expect(ClipEffectsSchema.safeParse(next).success).toBe(true);
  });

  it('rounds integer parameters required by the schema', () => {
    const next = applyEffectValues(undefined, effect('motionBlur'), {
      frames: 4.6,
      intensity: 0.8,
    });
    expect(next.motionBlur).toEqual({ frames: 5, intensity: 0.8 });
    expect(ClipEffectsSchema.safeParse(next).success).toBe(true);
  });

  it('returns the same effects when the descriptor has no parameters', () => {
    const current = { contrast: 1.2 };
    expect(applyEffectValues(current, effect('curves'), {})).toEqual(current);
  });
});
