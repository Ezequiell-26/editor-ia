import type {
  VisualCatalog,
  VisualEffectSpec,
  VisualTransitionSpec,
} from '../../services/project-service';

/**
 * Registro central de efectos: toma el catálogo vivo de Rust (disponibilidad
 * real de FFmpeg y parámetros) y le agrega el contrato que el resto de la app
 * necesita para previsualizar, configurar y exportar sin duplicar listas.
 *
 * Un efecto nuevo en el catálogo Rust aparece automáticamente con valores
 * seguros ("export-only", sin preview); para anunciarlo como disponible hay
 * que declarar su metadata acá.
 */
export const EFFECT_REGISTRY_VERSION = '1.0.0';

export const EFFECT_LICENSE = { spdx: 'MIT', holder: 'Editor IA' } as const;

export const EFFECT_CATEGORIES = {
  color: 'Color y luz',
  stylize: 'Estilo y textura',
  composite: 'Composición',
  motion: 'Movimiento',
  light: 'Luz',
  film: 'Filmación',
} as const;

export type EffectCategory = keyof typeof EFFECT_CATEGORIES;
export type EffectPreviewEngine = 'css' | 'webgl' | 'canvas' | 'none';
export type EffectStatus = 'available' | 'export-only' | 'requires-file' | 'manual';

export interface EffectLicense {
  readonly spdx: string;
  readonly holder: string;
}

export interface RegisteredEffect extends VisualEffectSpec {
  readonly version: string;
  readonly preview: EffectPreviewEngine;
  readonly exportEngine: 'ffmpeg';
  readonly requirements: 'cpu';
  readonly license: EffectLicense;
  readonly clipKinds: readonly ['video', 'image', 'freeze'];
  readonly status: EffectStatus;
}

export interface RegisteredTransition extends VisualTransitionSpec {
  readonly version: string;
  readonly preview: 'css';
  readonly exportEngine: 'ffmpeg';
  readonly requirements: 'cpu';
  readonly license: EffectLicense;
  readonly clipKinds: readonly ['video', 'image', 'freeze'];
  readonly status: 'available' | 'unavailable';
}

interface EffectMetadata {
  readonly preview: EffectPreviewEngine;
  readonly status?: EffectStatus;
  /** Campo objeto de ClipEffects que agrupa los parámetros. */
  readonly group?: string;
}

/** Preview CSS real (effectsToCss) y estado verificado de cada efecto. */
const METADATA: Record<string, EffectMetadata> = {
  brightness: { preview: 'css' },
  contrast: { preview: 'css' },
  saturation: { preview: 'css' },
  temperature: { preview: 'css' },
  shadows: { preview: 'css' },
  highlights: { preview: 'css' },
  fade: { preview: 'css' },
  blur: { preview: 'css' },
  hueRotate: { preview: 'css' },
  hsl: { preview: 'css' },
  colorWheels: { preview: 'webgl', status: 'manual' },
  colorMatch: { preview: 'css', group: 'colorMatch' },
  vignette: { preview: 'webgl', status: 'available' },
  sharpen: { preview: 'css' },
  glow: { preview: 'css', group: 'glow' },
  motionBlur: { preview: 'canvas', status: 'available', group: 'motionBlur' },
  denoise: { preview: 'webgl', status: 'available' },
  grain: { preview: 'css' },
  lut: { preview: 'webgl', status: 'requires-file' },
  curves: { preview: 'webgl', status: 'manual' },
  chromaKey: { preview: 'webgl', status: 'manual' },
  mask: { preview: 'none', status: 'manual' },
};

const UNKNOWN: EffectMetadata = { preview: 'none', status: 'export-only' };

const NESTED_GROUPS: Record<string, string> = Object.fromEntries(
  Object.entries(METADATA)
    .filter(([, metadata]) => metadata.group)
    .map(([id, metadata]) => [id, metadata.group as string]),
);

export function categoryLabel(category: string): string {
  return EFFECT_CATEGORIES[category as EffectCategory] ?? category;
}

export function buildEffectRegistry(catalog: VisualCatalog): RegisteredEffect[] {
  return catalog.effects.map((effect) => {
    const metadata = METADATA[effect.id] ?? UNKNOWN;
    const status =
      metadata.status ??
      (metadata.preview === 'none'
        ? 'export-only'
        : effect.parameters.length === 0
          ? 'manual'
          : 'available');
    return {
      ...effect,
      version: EFFECT_REGISTRY_VERSION,
      preview: metadata.preview,
      exportEngine: 'ffmpeg',
      requirements: 'cpu',
      license: EFFECT_LICENSE,
      clipKinds: ['video', 'image', 'freeze'],
      status,
    };
  });
}

/** Contrato homogéneo para las transiciones del catálogo vivo. */
export function buildTransitionRegistry(
  catalog: VisualCatalog,
): RegisteredTransition[] {
  return catalog.transitions.map((transition) => ({
    ...transition,
    version: EFFECT_REGISTRY_VERSION,
    preview: 'css',
    exportEngine: 'ffmpeg',
    requirements: 'cpu',
    license: EFFECT_LICENSE,
    clipKinds: ['video', 'image', 'freeze'],
    status: transition.available ? 'available' : 'unavailable',
  }));
}

/** Etiqueta legible para una clave activa de `ClipEffects` (objeto anidado incluido). */
export function effectLabelForKey(
  registry: readonly RegisteredEffect[],
  key: string,
): string {
  const effect = registry.find(
    (item) =>
      item.id === key ||
      item.parameters.some((parameter) => parameterGroup(item.id, parameter.key) === key),
  );
  return effect?.label ?? key;
}

/** Campo objeto que agrupa un parámetro; `null` cuando va en la raíz. */
export function parameterGroup(effectId: string, parameterKey: string): string | null {
  const group = NESTED_GROUPS[effectId];
  return group && group !== parameterKey ? group : null;
}
