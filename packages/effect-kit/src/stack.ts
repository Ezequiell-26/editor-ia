import { coerceParam, defaultParams, normalizeParams } from './params.ts';
import type { EffectInstance, EffectManifest, ParamValue } from './types.ts';

/** Tope defensivo: un stack de 32 efectos ya es más de lo que un clip tolera. */
export const MAX_STACK_EFFECTS = 32;

export type EffectStack = readonly EffectInstance[];

let counter = 0;

/** Id corto y estable dentro de la sesión; el proyecto lo persiste tal cual. */
export function newInstanceId(effectId: string): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${effectId}-${counter.toString(36)}${random}`;
}

export function createInstance(
  manifest: EffectManifest,
  overrides?: { readonly id?: string; readonly params?: Readonly<Record<string, unknown>> },
): EffectInstance {
  return {
    id: overrides?.id ?? newInstanceId(manifest.id),
    effectId: manifest.id,
    enabled: true,
    params: overrides?.params
      ? normalizeParams(manifest, overrides.params)
      : defaultParams(manifest),
  };
}

/** Agrega al final. Devuelve el mismo stack si se alcanzó el tope. */
export function addInstance(stack: EffectStack, instance: EffectInstance): EffectStack {
  if (stack.length >= MAX_STACK_EFFECTS) return stack;
  return [...stack, instance];
}

export function removeInstance(stack: EffectStack, instanceId: string): EffectStack {
  return stack.filter((instance) => instance.id !== instanceId);
}

export function setInstanceEnabled(
  stack: EffectStack,
  instanceId: string,
  enabled: boolean,
): EffectStack {
  return stack.map((instance) =>
    instance.id === instanceId ? { ...instance, enabled } : instance,
  );
}

export function toggleInstance(stack: EffectStack, instanceId: string): EffectStack {
  return stack.map((instance) =>
    instance.id === instanceId ? { ...instance, enabled: !instance.enabled } : instance,
  );
}

/** Mueve una instancia a un índice absoluto, recortado al rango válido. */
export function moveInstance(
  stack: EffectStack,
  instanceId: string,
  toIndex: number,
): EffectStack {
  const from = stack.findIndex((instance) => instance.id === instanceId);
  if (from < 0) return stack;
  const target = Math.max(0, Math.min(stack.length - 1, Math.trunc(toIndex)));
  if (target === from) return stack;
  const next = [...stack];
  const [moved] = next.splice(from, 1);
  if (!moved) return stack;
  next.splice(target, 0, moved);
  return next;
}

/** Desplazamiento relativo: -1 sube (se aplica antes), +1 baja. */
export function shiftInstance(
  stack: EffectStack,
  instanceId: string,
  delta: number,
): EffectStack {
  const from = stack.findIndex((instance) => instance.id === instanceId);
  if (from < 0) return stack;
  return moveInstance(stack, instanceId, from + Math.trunc(delta));
}

export function setInstanceParam(
  stack: EffectStack,
  manifest: EffectManifest,
  instanceId: string,
  paramId: string,
  raw: unknown,
): EffectStack {
  const spec = manifest.params.find((param) => param.id === paramId);
  if (!spec) return stack;
  return stack.map((instance) => {
    if (instance.id !== instanceId) return instance;
    const value: ParamValue = coerceParam(spec, raw);
    return { ...instance, params: { ...instance.params, [paramId]: value } };
  });
}

/** Vuelve a los defaults del manifiesto, conservando id y estado. */
export function resetInstance(
  stack: EffectStack,
  manifest: EffectManifest,
  instanceId: string,
): EffectStack {
  return stack.map((instance) => {
    if (instance.id !== instanceId) return instance;
    // Se descartan las claves de animación: resetear es volver al manifiesto.
    const { keyframes: _dropped, ...rest } = instance;
    return { ...rest, params: defaultParams(manifest) };
  });
}

export function duplicateInstance(
  stack: EffectStack,
  instanceId: string,
  nextId: string,
): EffectStack {
  const index = stack.findIndex((instance) => instance.id === instanceId);
  if (index < 0) return stack;
  const source = stack[index];
  if (!source) return stack;
  const copy: EffectInstance = {
    ...source,
    id: nextId,
    params: { ...source.params },
  };
  const next = [...stack];
  next.splice(index + 1, 0, copy);
  return next;
}

export function clearStack(): EffectStack {
  return [];
}

/** Sólo las habilitadas, en orden de aplicación. */
export function activeInstances(stack: EffectStack): EffectStack {
  return stack.filter((instance) => instance.enabled);
}

export function findInstance(
  stack: EffectStack,
  instanceId: string,
): EffectInstance | undefined {
  return stack.find((instance) => instance.id === instanceId);
}
