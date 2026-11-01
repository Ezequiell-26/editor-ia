import { ClipEffectsSchema, type ClipEffects } from '@editor-ia/project-schema';
import { parameterGroup, type RegisteredEffect } from './registry';

export type EffectValue = number | boolean | string;
export type EffectValues = Record<string, EffectValue>;

type EffectsRecord = Record<string, unknown>;

/** Parámetros que el esquema exige enteros. */
const INTEGER_KEYS = new Set(['frames']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function defaultValues(effect: RegisteredEffect): EffectValues {
  const values: EffectValues = {};
  for (const parameter of effect.parameters) {
    values[parameter.key] = parameter.default;
  }
  return values;
}

/** Lee el estado real del clip para inicializar el editor de parámetros. */
export function valuesFromClip(
  effects: ClipEffects | undefined,
  effect: RegisteredEffect,
): EffectValues {
  const values: EffectValues = {};
  for (const parameter of effect.parameters) {
    const group = parameterGroup(effect.id, parameter.key);
    const source = effects as EffectsRecord | undefined;
    const container = group
      ? (source?.[group] as Record<string, unknown> | undefined)
      : source;
    const current = container?.[parameter.key];
    values[parameter.key] =
      typeof current === 'number' || typeof current === 'boolean' || typeof current === 'string'
        ? current
        : parameter.default;
  }
  return values;
}

/**
 * Aplica los valores del editor al clip conservando el resto de efectos.
 * Clampea al rango declarado, completa los campos anidados que falten con su
 * default y devuelve un objeto válido para `ClipEffectsSchema`.
 */
export function applyEffectValues(
  effects: ClipEffects | undefined,
  effect: RegisteredEffect,
  values: EffectValues,
): ClipEffects {
  const next: EffectsRecord = { ...(effects as EffectsRecord | undefined) };
  if (effect.parameters.length === 0) return next as ClipEffects;

  const groups = new Map<string, Record<string, unknown>>();
  for (const parameter of effect.parameters) {
    const raw = values[parameter.key] ?? parameter.default;
    const value =
      typeof raw === 'number'
        ? INTEGER_KEYS.has(parameter.key)
          ? Math.round(clamp(raw, parameter.min, parameter.max))
          : clamp(raw, parameter.min, parameter.max)
        : raw;
    const group = parameterGroup(effect.id, parameter.key);
    if (!group) {
      next[parameter.key] = value;
      continue;
    }
    const target = groups.get(group) ?? {
      ...((next[group] as Record<string, unknown> | undefined) ?? {}),
    };
    target[parameter.key] = value;
    groups.set(group, target);
  }
  for (const [group, target] of groups) {
    // Completa los campos que el editor no expone (por ejemplo threshold).
    for (const parameter of effect.parameters) {
      if (parameterGroup(effect.id, parameter.key) !== group) continue;
      if (target[parameter.key] === undefined) target[parameter.key] = parameter.default;
    }
    next[group] = target;
  }
  // Nunca se escribe un efecto que el esquema rechace: si falla, se conserva
  // el estado anterior en vez de corromper el proyecto.
  const parsed = ClipEffectsSchema.safeParse(next);
  return parsed.success ? parsed.data : ((effects ?? {}) as ClipEffects);
}
