import type { ClipEffects } from '@editor-ia/project-schema';

export interface EffectPreset {
  readonly id: string;
  readonly label: string;
  readonly settings: ClipEffects;
}

export const EFFECT_PRESETS: readonly EffectPreset[] = [
  {
    id: 'soft',
    label: 'Suave',
    settings: { blur: 1.2, brightness: 0.03, contrast: 0.98, saturation: 1.04 },
  },
  {
    id: 'dream',
    label: 'Onírico',
    settings: { blur: 2.4, brightness: 0.05, saturation: 1.1, vignette: 0.12 },
  },
  {
    id: 'noir',
    label: 'Noir',
    settings: {
      grayscale: true,
      contrast: 1.25,
      vignette: 0.35,
      curvePreset: 'contrast-strong',
    },
  },
  {
    id: 'vhs',
    label: 'VHS',
    settings: {
      contrast: 1.08,
      saturation: 0.85,
      hueRotateDeg: 6,
      blur: 0.5,
      vignette: 0.2,
      curvePreset: 'vintage',
    },
  },
  {
    id: 'documentary',
    label: 'Documental',
    settings: { sharpen: 1.2, contrast: 1.05, saturation: 0.95 },
  },
  {
    id: 'high-key',
    label: 'Alta clave',
    settings: {
      brightness: 0.12,
      contrast: 0.95,
      saturation: 1.05,
      shadows: 0.1,
      fade: 0.08,
    },
  },
  {
    id: 'low-key',
    label: 'Baja clave',
    settings: {
      brightness: -0.1,
      contrast: 1.15,
      shadows: -0.12,
      highlights: 0.08,
      vignette: 0.22,
    },
  },
  {
    id: 'neon',
    label: 'Neón',
    settings: {
      saturation: 1.35,
      hueRotateDeg: -10,
      contrast: 1.1,
      vignette: 0.18,
    },
  },
  {
    id: 'viral-glow',
    label: 'Glow viral',
    settings: {
      glow: { intensity: 0.7, radius: 24, threshold: 0.5 },
      contrast: 1.08,
      saturation: 1.12,
    },
  },
];

export function applyEffectPreset(
  current: ClipEffects,
  preset: EffectPreset,
): ClipEffects {
  const kept: ClipEffects = {};
  if (current.fadeInFrames !== undefined) kept.fadeInFrames = current.fadeInFrames;
  if (current.fadeOutFrames !== undefined) kept.fadeOutFrames = current.fadeOutFrames;
  if (current.lutFile !== undefined) kept.lutFile = current.lutFile;
  if (current.lutIntensity !== undefined) kept.lutIntensity = current.lutIntensity;
  return { ...kept, ...preset.settings };
}
