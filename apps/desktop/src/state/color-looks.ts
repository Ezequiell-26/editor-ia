import type { ClipEffects } from '@editor-ia/project-schema';

export const COLOR_LOOKS: readonly { readonly id: string; readonly label: string; readonly effects: ClipEffects }[] = [
  { id: 'neutral', label: 'Neutro', effects: {} },
  {
    id: 'warm',
    label: 'Cálido',
    effects: { temperature: 0.22, saturation: 1.08, contrast: 1.03 },
  },
  {
    id: 'cool',
    label: 'Frío',
    effects: { temperature: -0.22, saturation: 0.95, contrast: 1.04 },
  },
  {
    id: 'cinema',
    label: 'Cine',
    effects: {
      contrast: 1.14,
      saturation: 0.9,
      temperature: -0.05,
      vignette: 0.18,
      curvePreset: 'contrast-medium',
    },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    effects: {
      sepia: true,
      saturation: 0.8,
      contrast: 1.05,
      vignette: 0.22,
      curvePreset: 'vintage',
    },
  },
  {
    id: 'mono',
    label: 'B/N',
    effects: { grayscale: true, contrast: 1.08 },
  },
];
