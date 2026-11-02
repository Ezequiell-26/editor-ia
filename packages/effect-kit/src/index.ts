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
  MAX_STACK_EFFECTS,
  activeInstances,
  addInstance,
  clearStack,
  createInstance,
  duplicateInstance,
  findInstance,
  moveInstance,
  newInstanceId,
  removeInstance,
  resetInstance,
  setInstanceEnabled,
  setInstanceParam,
  shiftInstance,
  toggleInstance,
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

import { createRegistry } from './registry.ts';
import { ALL_EFFECTS } from './catalog/index.ts';

/** Registro con todo el catálogo incluido. La UI lo usa tal cual. */
export const effectRegistry = createRegistry(ALL_EFFECTS);
