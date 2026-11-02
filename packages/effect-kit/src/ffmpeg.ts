import {
  applyTemplate,
  formatNumber,
  hasUnresolvedPlaceholder,
  normalizeParams,
  paramDefault,
} from './params.ts';
import type { EffectRegistry } from './registry.ts';
import type { EffectInstance, EffectManifest, ExportFidelity, ParamValue } from './types.ts';
import { activeInstances, type EffectStack } from './stack.ts';

/**
 * Compilador de stack → FFmpeg.
 *
 * Devuelve pasos, no un string: el renderer aplica cada paso sobre la cola de
 * la cadena del clip, así dos efectos con grafo (`split` + `blend`) pueden
 * convivir sin que uno pise las etiquetas del otro.
 */

export type CompiledStep =
  | { readonly kind: 'filters'; readonly filters: readonly string[] }
  | { readonly kind: 'graph'; readonly template: string };

export interface CompiledStack {
  readonly steps: readonly CompiledStep[];
  /** Peor fidelidad del conjunto: si algo es aproximado, el total lo es. */
  readonly fidelity: ExportFidelity;
  readonly notes: readonly string[];
  /** Efectos que no llegan al render porque no tienen receta. */
  readonly previewOnly: readonly string[];
  readonly effects: number;
}

const RANK: Record<ExportFidelity, number> = {
  exact: 0,
  approximate: 1,
  'preview-only': 2,
};

function worst(current: ExportFidelity, next: ExportFidelity): ExportFidelity {
  return RANK[next] > RANK[current] ? next : current;
}

export function compileInstance(
  registry: EffectRegistry,
  instance: EffectInstance,
): { steps: CompiledStep[]; fidelity: ExportFidelity; notes: string[] } {
  const manifest = registry.get(instance.effectId);
  if (!manifest) return { steps: [], fidelity: 'preview-only', notes: [] };
  const recipe = manifest.ffmpeg;
  if (!recipe) {
    return { steps: [], fidelity: 'preview-only', notes: [] };
  }
  const params = normalizeParams(manifest, instance.params);
  const notes: string[] = [];
  if (recipe.note) notes.push(`${manifest.name}: ${recipe.note}`);

  const steps: CompiledStep[] = [];
  if (recipe.chain && recipe.chain.length > 0) {
    const filters: string[] = [];
    let broken = false;
    for (const template of recipe.chain) {
      const filter = applyTemplate(template, manifest, params);
      if (hasUnresolvedPlaceholder(filter)) {
        broken = true;
        break;
      }
      filters.push(filter);
    }
    if (broken) {
      return {
        steps: [],
        fidelity: 'preview-only',
        notes: [...notes, `${manifest.name}: la receta tiene marcadores sin resolver.`],
      };
    }
    steps.push({ kind: 'filters', filters });
  }
  if (recipe.graph) {
    const graph = applyTemplate(recipe.graph, manifest, params);
    if (hasUnresolvedPlaceholder(graph)) {
      return {
        steps: [],
        fidelity: 'preview-only',
        notes: [...notes, `${manifest.name}: el grafo tiene marcadores sin resolver.`],
      };
    }
    steps.push({ kind: 'graph', template: graph });
  }
  if (steps.length === 0) {
    return { steps: [], fidelity: 'preview-only', notes };
  }
  return { steps, fidelity: recipe.fidelity, notes };
}

export function compileStack(registry: EffectRegistry, stack: EffectStack): CompiledStack {
  const steps: CompiledStep[] = [];
  const notes: string[] = [];
  const previewOnly: string[] = [];
  let fidelity: ExportFidelity = 'exact';
  const instances = activeInstances(stack);

  for (const instance of instances) {
    const compiled = compileInstance(registry, instance);
    if (compiled.steps.length === 0) {
      previewOnly.push(instance.effectId);
      fidelity = worst(fidelity, 'preview-only');
      continue;
    }
    steps.push(...compiled.steps);
    notes.push(...compiled.notes);
    fidelity = worst(fidelity, compiled.fidelity);
  }

  return {
    steps,
    fidelity: instances.length === 0 ? 'exact' : fidelity,
    notes,
    previewOnly,
    effects: instances.length,
  };
}

/** Etiqueta corta para la UI: "exacto", "aproximado" o "sólo preview". */
export function fidelityLabel(fidelity: ExportFidelity): string {
  switch (fidelity) {
    case 'exact':
      return 'Export exacto';
    case 'approximate':
      return 'Export aproximado';
    case 'preview-only':
    default:
      return 'Sólo preview';
  }
}

/**
 * Fidelidad declarada por el manifiesto, sea de video o de audio.
 *
 * La UI necesita una sola respuesta: un efecto de audio con receta exacta no
 * puede mostrarse como "sólo preview" sólo porque su receta no está en
 * `ffmpeg`.
 */
export function manifestFidelity(manifest: EffectManifest): ExportFidelity {
  if (manifest.ffmpeg) return manifest.ffmpeg.fidelity;
  if (manifest.audio) return manifest.audio.fidelity;
  return manifest.kind === 'transition' ? 'exact' : 'preview-only';
}

/** Nota de aproximación del manifiesto, si declara una. */
export function manifestNote(manifest: EffectManifest): string | undefined {
  return manifest.ffmpeg?.note ?? manifest.audio?.note;
}

/** Frecuencia de muestreo que usa el compilador cuando nadie le pasa el perfil. */
export const DEFAULT_SAMPLE_RATE = 48_000;

const RATE_TOKEN = '%RATE%';
const INVERSE_TOKEN = /%INV:([a-zA-Z0-9_]+)%/g;

export interface CompiledAudioStack {
  /** Filtros de audio en orden, listos para `-af` o para la cadena del clip. */
  readonly filters: readonly string[];
  readonly fidelity: ExportFidelity;
  readonly notes: readonly string[];
  readonly previewOnly: readonly string[];
  readonly effects: number;
}

function inverseOf(
  manifest: EffectManifest,
  params: Readonly<Record<string, ParamValue>>,
  id: string,
): number | null {
  const spec = manifest.params.find((param) => param.id === id);
  if (!spec || (spec.type !== 'float' && spec.type !== 'int')) return null;
  const raw = params[id] ?? paramDefault(spec);
  const value = typeof raw === 'number' ? raw : spec.default;
  if (!Number.isFinite(value) || value === 0) return null;
  return 1 / value;
}

/**
 * Compila una instancia de audio a filtros de FFmpeg.
 *
 * A diferencia del compilador de video, acá no hay pasos ni grafos: la cadena
 * de audio del clip es una lista plana de filtros. Las macros `%RATE%` e
 * `%INV:<param>%` se resuelven con el sample rate del perfil y con el valor
 * efectivo del parámetro, así el catálogo no necesita saber ni uno ni otro.
 */
export function compileAudioInstance(
  registry: EffectRegistry,
  instance: EffectInstance,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): { filters: string[]; fidelity: ExportFidelity; notes: string[] } {
  const manifest = registry.get(instance.effectId);
  const recipe = manifest?.audio;
  if (!manifest || !recipe) return { filters: [], fidelity: 'preview-only', notes: [] };
  const params = normalizeParams(manifest, instance.params);
  const notes: string[] = [];
  if (recipe.note) notes.push(`${manifest.name}: ${recipe.note}`);

  const filters: string[] = [];
  for (const template of recipe.chain) {
    let filter = applyTemplate(template, manifest, params).replaceAll(
      RATE_TOKEN,
      String(Math.round(sampleRate)),
    );
    let broken = false;
    filter = filter.replace(INVERSE_TOKEN, (_match, id: string) => {
      const inverse = inverseOf(manifest, params, id);
      if (inverse === null) {
        broken = true;
        return _match;
      }
      return formatNumber(inverse, 6);
    });
    if (broken || hasUnresolvedPlaceholder(filter) || filter.includes('%INV:') || filter.includes(RATE_TOKEN)) {
      return {
        filters: [],
        fidelity: 'preview-only',
        notes: [...notes, `${manifest.name}: la receta de audio tiene marcadores sin resolver.`],
      };
    }
    filters.push(filter);
  }
  if (filters.length === 0) return { filters: [], fidelity: 'preview-only', notes };
  return { filters, fidelity: recipe.fidelity, notes };
}

/** Compila el stack de audio completo, en orden, con la peor fidelidad. */
export function compileAudioStack(
  registry: EffectRegistry,
  stack: EffectStack,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): CompiledAudioStack {
  const filters: string[] = [];
  const notes: string[] = [];
  const previewOnly: string[] = [];
  let fidelity: ExportFidelity = 'exact';
  const instances = activeInstances(stack);

  for (const instance of instances) {
    const compiled = compileAudioInstance(registry, instance, sampleRate);
    if (compiled.filters.length === 0) {
      previewOnly.push(instance.effectId);
      fidelity = worst(fidelity, 'preview-only');
      continue;
    }
    filters.push(...compiled.filters);
    notes.push(...compiled.notes);
    fidelity = worst(fidelity, compiled.fidelity);
  }

  return {
    filters,
    fidelity: instances.length === 0 ? 'exact' : fidelity,
    notes,
    previewOnly,
    effects: instances.length,
  };
}
