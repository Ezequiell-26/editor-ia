/**
 * `@editor-ia/effect-kit`
 *
 * Motor de efectos declarativo de Olyvia. La idea en una línea: un efecto es un
 * dato (manifiesto) y el clip guarda una lista ordenada de instancias, no un
 * objeto plano de campos fijos. Preview y export consumen el mismo stack por
 * dos caminos distintos (WebGL2 y FFmpeg) y cada manifiesto declara cuánta
 * fidelidad puede prometer en cada uno.
 */

export {
  EFFECT_CATEGORIES,
  EFFECT_KINDS,
  CATEGORY_LABELS,
} from './types.ts';
export type {
  AudioRecipe,
  EffectCategory,
  EffectInstance,
  EffectKeyframe,
  EffectKind,
  EffectManifest,
  ExportFidelity,
  FfmpegRecipe,
  GpuPass,
  ParamSpec,
  ParamType,
  ParamValue,
  PassInput,
} from './types.ts';

export {
  applyTemplate,
  coerceParam,
  defaultParams,
  formatForFfmpeg,
  formatNumber,
  hasUnresolvedPlaceholder,
  hexToRgb,
  normalizeColor,
  normalizeParams,
  paramDefault,
  paramGroups,
  resolveParamsAt,
  sampleKeyframes,
} from './params.ts';
export type { ParamGroup } from './params.ts';

export {
  MAX_PARAM_KEYFRAMES,
  MAX_STACK_EFFECTS,
  activeInstances,
  addInstance,
  clearParamKeyframeCurves,
  clearParamKeyframes,
  clearStack,
  createInstance,
  duplicateInstance,
  findInstance,
  moveInstance,
  newInstanceId,
  paramKeyframes,
  removeInstance,
  removeParamKeyframe,
  resetInstance,
  setInstanceEnabled,
  setInstanceParam,
  setParamKeyframeAt,
  setParamKeyframeBezier,
  setParamKeyframeEasing,
  shiftInstance,
  toggleInstance,
  toggleParamKeyframe,
} from './stack.ts';
export type { EffectStack } from './stack.ts';

export { createRegistry } from './registry.ts';
export type { EffectRegistry } from './registry.ts';

export {
  compileAudioInstance,
  compileAudioStack,
  compileInstance,
  compileStack,
  DEFAULT_SAMPLE_RATE,
  fidelityLabel,
  manifestFidelity,
  manifestNote,
} from './ffmpeg.ts';
export type { CompiledAudioStack, CompiledStack, CompiledStep } from './ffmpeg.ts';

export { EffectRenderer } from './webgl.ts';
export type { RenderClock } from './webgl.ts';

export { COMMON_GLSL, VERTEX_SHADER, fragmentHeader } from './shaders/prelude.ts';

export { VIDEO_EFFECTS } from './catalog/video.ts';
export { TRANSITIONS } from './catalog/transitions.ts';
export { AUDIO_EFFECTS } from './catalog/audio.ts';
export { ALL_EFFECTS } from './catalog/index.ts';

export { parseEffectPackage, validateShaderSource } from './package-import.ts';
export type { PackageImportResult } from './package-import.ts';

import { createRegistry } from './registry.ts';
import type { EffectRegistry } from './registry.ts';
import type { EffectManifest } from './types.ts';
import { ALL_EFFECTS } from './catalog/index.ts';

const customManifests: EffectManifest[] = [];
let innerRegistry = createRegistry(ALL_EFFECTS);

/**
 * Registro con todo el catálogo incluido. La UI lo usa tal cual. Los
 * efectos de terceros se suman con `registerCustomEffects`: el objeto
 * delega en un registry interno que se reconstruye al registrar, así
 * los consumidores que guardaron la referencia ven los nuevos efectos
 * sin reiniciar la app.
 */
export const effectRegistry: EffectRegistry = {
  get all() {
    return innerRegistry.all;
  },
  get: (id) => innerRegistry.get(id),
  byKind: (kind) => innerRegistry.byKind(kind),
  byCategory: (category, kind) => innerRegistry.byCategory(category, kind),
  search: (query, kind) => innerRegistry.search(query, kind),
  categories: (kind) => innerRegistry.categories(kind),
};

/**
 * Registra efectos de terceros (paquetes `.driftfx`/JSON ya parseados por
 * `parseEffectPackage`). Los ids repetidos se ignoran: el primero gana.
 */
export function registerCustomEffects(manifests: readonly EffectManifest[]): void {
  let changed = false;
  for (const manifest of manifests) {
    if (customManifests.some((existing) => existing.id === manifest.id)) continue;
    if (ALL_EFFECTS.some((existing) => existing.id === manifest.id)) continue;
    customManifests.push(manifest);
    changed = true;
  }
  if (changed) innerRegistry = createRegistry([...ALL_EFFECTS, ...customManifests]);
}

/** Quita todos los efectos de terceros (tests y restablecimiento). */
export function clearCustomEffects(): void {
  if (customManifests.length === 0) return;
  customManifests.length = 0;
  innerRegistry = createRegistry(ALL_EFFECTS);
}

/** Ids de los efectos de terceros registrados, para persistencia. */
export function customEffectIds(): readonly string[] {
  return customManifests.map((manifest) => manifest.id);
}
