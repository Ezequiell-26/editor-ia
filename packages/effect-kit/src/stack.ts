import { coerceParam, defaultParams, normalizeParams, sampleKeyframes } from './params.ts';
import type { EffectInstance, EffectKeyframe, EffectManifest, ParamValue } from './types.ts';

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

// ── Keyframes por parámetro ────────────────────────────────────────────────
//
// El schema exige entre 2 y 64 claves por parámetro: una pista de un solo
// keyframe no es un documento válido. Por eso crear la primera clave genera
// una compañera (en el frame 0, o en el 1 si el playhead está en 0) con el
// mismo valor — una línea plana que el usuario anima moviendo el playhead.
// Borrar claves hasta quedar una elimina la pista entera.

/** Tope del schema (`EffectKeyframeSchema` admite hasta 64 por parámetro). */
export const MAX_PARAM_KEYFRAMES = 64;

function byFrame(a: EffectKeyframe, b: EffectKeyframe): number {
  return a.frame - b.frame;
}

function patchInstance(
  instance: EffectInstance,
  keyframes: Record<string, EffectKeyframe[]>,
): EffectInstance {
  const { keyframes: _dropped, ...rest } = instance;
  return Object.keys(keyframes).length > 0 ? { ...rest, keyframes } : rest;
}

/** Track de keyframes de un parámetro, ordenada por frame (o undefined). */
export function paramKeyframes(
  instance: EffectInstance,
  paramId: string,
): readonly EffectKeyframe[] | undefined {
  const track = instance.keyframes?.[paramId];
  return track ? [...track].sort(byFrame) : undefined;
}

/**
 * Alterna el keyframe del playhead para un parámetro numérico.
 *
 * - Sin track: crea la pista con el valor actual y una compañera plana.
 * - Con key en el frame: lo quita; si queda una sola clave borra la pista.
 * - Con track sin key en el frame: agrega uno con el valor muestreado en ese
 *   frame (lo que la preview mostraría ahí).
 */
export function toggleParamKeyframe(
  stack: EffectStack,
  manifest: EffectManifest,
  instanceId: string,
  paramId: string,
  frame: number,
): EffectStack {
  const spec = manifest.params.find((param) => param.id === paramId);
  if (!spec || (spec.type !== 'float' && spec.type !== 'int')) return stack;
  const rounded = Math.max(0, Math.round(frame));
  return stack.map((instance) => {
    if (instance.id !== instanceId) return instance;
    const tracks: Record<string, EffectKeyframe[]> = {};
    for (const [id, keys] of Object.entries(instance.keyframes ?? {})) {
      tracks[id] = [...keys];
    }
    const existing = (tracks[paramId] ?? []).sort(byFrame);
    const at = existing.findIndex((key) => key.frame === rounded);
    if (at >= 0) {
      const next = [...existing];
      next.splice(at, 1);
      if (next.length < 2) delete tracks[paramId];
      else tracks[paramId] = next;
      return patchInstance(instance, tracks);
    }
    if (existing.length >= MAX_PARAM_KEYFRAMES) return instance;
    const current = instance.params[paramId] ?? spec.default;
    const value = coerceParam(
      spec,
      sampleKeyframes(existing.length > 0 ? existing : undefined, rounded) ?? current,
    ) as number;
    if (existing.length === 0) {
      const companion: EffectKeyframe = {
        frame: rounded > 0 ? 0 : rounded + 1,
        value,
      };
      tracks[paramId] = [companion, { frame: rounded, value }].sort(byFrame);
    } else {
      tracks[paramId] = [...existing, { frame: rounded, value }].sort(byFrame);
    }
    return patchInstance(instance, tracks);
  });
}

/**
 * Escribe el valor de un parámetro animado en el frame del playhead.
 *
 * Si ya hay clave en ese frame la actualiza; si no, la crea — siempre que la
 * pista exista (un parámetro sin animación no se keyframea arrastrando el
 * slider: para eso está el botón de clave). Devuelve el mismo stack cuando la
 * pista no existe o llegó al tope.
 */
export function setParamKeyframeAt(
  stack: EffectStack,
  manifest: EffectManifest,
  instanceId: string,
  paramId: string,
  frame: number,
  raw: unknown,
): EffectStack {
  const spec = manifest.params.find((param) => param.id === paramId);
  if (!spec || (spec.type !== 'float' && spec.type !== 'int')) return stack;
  const rounded = Math.max(0, Math.round(frame));
  const value = coerceParam(spec, raw) as number;
  return stack.map((instance) => {
    if (instance.id !== instanceId) return instance;
    const existing = instance.keyframes?.[paramId];
    if (!existing || existing.length === 0) return instance;
    const tracks: Record<string, EffectKeyframe[]> = {};
    for (const [id, keys] of Object.entries(instance.keyframes ?? {})) {
      tracks[id] = [...keys];
    }
    const track = [...existing].sort(byFrame);
    const at = track.findIndex((key) => key.frame === rounded);
    const previous = at >= 0 ? track[at] : undefined;
    if (previous) {
      // Se preserva la curva del segmento (bezier gana sobre easing, como en
      // el muestreo): reescribir el valor no debe aplanar la animación.
      track[at] = {
        frame: previous.frame,
        value,
        ...(previous.easing !== undefined ? { easing: previous.easing } : {}),
        ...(previous.bezier !== undefined ? { bezier: previous.bezier } : {}),
      };
    } else {
      if (track.length >= MAX_PARAM_KEYFRAMES) return instance;
      track.push({ frame: rounded, value });
      track.sort(byFrame);
    }
    tracks[paramId] = track;
    return patchInstance(instance, tracks);
  });
}

/** Quita toda la animación de un parámetro (vuelve al valor estático). */
export function clearParamKeyframes(
  stack: EffectStack,
  instanceId: string,
  paramId: string,
): EffectStack {
  return stack.map((instance) => {
    if (instance.id !== instanceId || !instance.keyframes?.[paramId]) return instance;
    const tracks: Record<string, EffectKeyframe[]> = {};
    for (const [id, keys] of Object.entries(instance.keyframes ?? {})) {
      if (id !== paramId) tracks[id] = [...keys];
    }
    return patchInstance(instance, tracks);
  });
}
