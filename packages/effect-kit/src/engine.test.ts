import { describe, expect, it } from 'vitest';
import { effectRegistry } from './index.ts';
import {
  coerceParam,
  defaultParams,
  normalizeParams,
  paramGroups,
  resolveParamsAt,
  sampleKeyframes,
} from './params.ts';
import {
  MAX_STACK_EFFECTS,
  addInstance,
  createInstance,
  duplicateInstance,
  moveInstance,
  removeInstance,
  resetInstance,
  setInstanceEnabled,
  setInstanceParam,
  shiftInstance,
  toggleInstance,
  type EffectStack,
} from './stack.ts';
import type { EffectManifest } from './types.ts';

const exposure = effectRegistry.get('color.exposure') as EffectManifest;
const grade = effectRegistry.get('color.grade') as EffectManifest;
const gaussian = effectRegistry.get('blur.gaussian') as EffectManifest;

describe('parámetros', () => {
  it('recorta al rango declarado', () => {
    const spec = exposure.params[0];
    expect(spec).toBeTruthy();
    if (!spec) return;
    expect(coerceParam(spec, 99)).toBe(2);
    expect(coerceParam(spec, -99)).toBe(-2);
    expect(coerceParam(spec, 'no es un número')).toBe(0);
  });

  it('normaliza colores y pares', () => {
    const duotone = effectRegistry.get('color.duotone') as EffectManifest;
    const color = duotone.params.find((param) => param.type === 'color');
    const pair = grade.params.find((param) => param.type === 'vec2');
    expect(color).toBeTruthy();
    expect(pair).toBeTruthy();
    if (color) expect(coerceParam(color, 'FFAA00')).toBe('#ffaa00');
    if (pair) expect(coerceParam(pair, [9, -9])).toEqual([1, -1]);
  });

  it('completa defaults y descarta claves desconocidas', () => {
    const params = normalizeParams(exposure, { exposure: 1, inventado: 3 });
    expect(params).toEqual({ exposure: 1 });
    expect(defaultParams(exposure)).toEqual({ exposure: 0 });
  });

  it('agrupa por sección preservando el orden', () => {
    const groups = paramGroups(grade);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]?.name).toBe('Luz');
    expect(groups[0]?.params.length).toBe(3);
  });

  it('muestrea keyframes con easing y sostiene los extremos', () => {
    const keys = [
      { frame: 0, value: 0, easing: 'linear' as const },
      { frame: 10, value: 1, easing: 'linear' as const },
    ];
    expect(sampleKeyframes(keys, -5)).toBe(0);
    expect(sampleKeyframes(keys, 5)).toBeCloseTo(0.5);
    expect(sampleKeyframes(keys, 99)).toBe(1);
    expect(sampleKeyframes(undefined, 3)).toBeUndefined();
  });

  it('resuelve parámetros animados en un frame', () => {
    const params = defaultParams(exposure);
    const resolved = resolveParamsAt(
      exposure,
      params,
      { exposure: [{ frame: 0, value: 0 }, { frame: 10, value: 2 }] },
      5,
    );
    expect(resolved.exposure).toBe(1);
  });
});

describe('stack', () => {
  it('crea instancias con defaults', () => {
    const instance = createInstance(gaussian);
    expect(instance.effectId).toBe('blur.gaussian');
    expect(instance.enabled).toBe(true);
    expect(instance.params.radius).toBe(8);
  });

  it('agrega, mueve y quita preservando el orden', () => {
    let stack: EffectStack = [createInstance(gaussian, { id: 'a' }), createInstance(exposure, { id: 'b' })];
    stack = addInstance(stack, createInstance(grade, { id: 'c' }));
    expect(stack.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    stack = moveInstance(stack, 'c', 0);
    expect(stack.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    stack = shiftInstance(stack, 'c', 1);
    expect(stack.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    stack = removeInstance(stack, 'c');
    expect(stack.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('respeta el tope del stack', () => {
    let stack: EffectStack = [];
    for (let index = 0; index < MAX_STACK_EFFECTS + 5; index += 1) {
      stack = addInstance(stack, createInstance(exposure));
    }
    expect(stack).toHaveLength(MAX_STACK_EFFECTS);
  });

  it('prende, apaga y resetea', () => {
    let stack: EffectStack = [createInstance(grade, { id: 'g' })];
    stack = setInstanceEnabled(stack, 'g', false);
    expect(stack[0]?.enabled).toBe(false);
    stack = toggleInstance(stack, 'g');
    expect(stack[0]?.enabled).toBe(true);
    stack = setInstanceParam(stack, grade, 'g', 'contrast', 1.8);
    expect(stack[0]?.params.contrast).toBe(1.8);
    stack = resetInstance(stack, grade, 'g');
    expect(stack[0]?.params.contrast).toBe(1);
  });

  it('duplica justo después del original', () => {
    const stack = duplicateInstance(
      [createInstance(gaussian, { id: 'a' }), createInstance(exposure, { id: 'b' })],
      'a',
      'a2',
    );
    expect(stack.map((item) => item.id)).toEqual(['a', 'a2', 'b']);
  });

  it('ignora un parámetro que el manifiesto no declara', () => {
    const stack = setInstanceParam(
      [createInstance(exposure, { id: 'a' })],
      exposure,
      'a',
      'inexistente',
      1,
    );
    expect(stack[0]?.params).toEqual({ exposure: 0 });
  });
});
