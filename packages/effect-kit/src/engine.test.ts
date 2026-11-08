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
  clearParamKeyframeCurves,
  clearParamKeyframes,
  createInstance,
  duplicateInstance,
  moveInstance,
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

  it('un bezier en la clave que inicia el segmento gobierna la interpolación', () => {
    // ease-in-out como bezier (0.42,0)-(0.58,1): en el punto medio debe dar
    // casi 0.5 como el preset, y un bezier lineal (0,0)-(1,1) da exactamente t.
    const eased = [
      {
        frame: 0,
        value: 0,
        bezier: { cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 },
      },
      { frame: 10, value: 1 },
    ];
    expect(sampleKeyframes(eased, 5)).toBeCloseTo(0.5, 1);
    const linear = [
      { frame: 0, value: 0, bezier: { cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1 } },
      { frame: 10, value: 1 },
    ];
    expect(sampleKeyframes(linear, 5)).toBeCloseTo(0.5, 6);
    // Un bezier que tarda en arrancar queda por debajo de la recta a mitad.
    const slow = [
      { frame: 0, value: 0, bezier: { cp1X: 0.9, cp1Y: 0.1, cp2X: 0.9, cp2Y: 0.1 } },
      { frame: 10, value: 1 },
    ];
    expect(sampleKeyframes(slow, 5)!).toBeLessThan(0.5);
    // El bezier de una clave intermedia no contamina al segmento siguiente.
    const two = [
      { frame: 0, value: 0, bezier: { cp1X: 0.9, cp1Y: 0.9, cp2X: 0.9, cp2Y: 0.9 } },
      { frame: 10, value: 1 },
      { frame: 20, value: 2 },
    ];
    expect(sampleKeyframes(two, 15)).toBeCloseTo(1.5, 6);
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

describe('keyframes por parámetro', () => {
  const animated = (): EffectStack => [
    {
      ...createInstance(exposure, { id: 'a', params: { exposure: 0.2 } }),
      keyframes: {
        exposure: [
          { frame: 0, value: -1 },
          { frame: 30, value: 1 },
        ],
      },
    },
  ];

  it('crea la primera pista con una compañera plana (mínimo 2 del schema)', () => {
    let stack: EffectStack = [createInstance(exposure, { id: 'a', params: { exposure: 0.4 } })];
    stack = toggleParamKeyframe(stack, exposure, 'a', 'exposure', 12);
    const keys = stack[0]?.keyframes?.exposure ?? [];
    expect(keys).toHaveLength(2);
    expect(keys.map((key) => key.frame).sort((a, b) => a - b)).toEqual([0, 12]);
    expect(keys.every((key) => key.value === 0.4)).toBe(true);
  });

  it('agrega y quita claves en el frame del playhead', () => {
    let stack = animated();
    stack = toggleParamKeyframe(stack, exposure, 'a', 'exposure', 15);
    expect(stack[0]?.keyframes?.exposure).toHaveLength(3);
    // El valor nuevo es el muestreado en ese frame (lineal: -1 + 2*(15/30) = 0).
    const added = stack[0]?.keyframes?.exposure?.find((key) => key.frame === 15);
    expect(added?.value).toBeCloseTo(0, 5);
    stack = toggleParamKeyframe(stack, exposure, 'a', 'exposure', 15);
    expect(stack[0]?.keyframes?.exposure).toHaveLength(2);
  });

  it('borra la pista entera si queda una sola clave', () => {
    let stack: EffectStack = [
      {
        ...createInstance(exposure, { id: 'a' }),
        keyframes: {
          exposure: [
            { frame: 0, value: 0 },
            { frame: 10, value: 1 },
          ],
        },
      },
    ];
    stack = toggleParamKeyframe(stack, exposure, 'a', 'exposure', 0);
    expect(stack[0]?.keyframes).toBeUndefined();
  });

  it('removeParamKeyframe borra una clave suelta y conserva la pista', () => {
    let stack: EffectStack = [
      {
        ...createInstance(exposure, { id: 'a' }),
        keyframes: {
          exposure: [
            { frame: 0, value: -1 },
            { frame: 15, value: 0 },
            { frame: 30, value: 1 },
          ],
        },
      },
    ];
    stack = removeParamKeyframe(stack, 'a', 'exposure', 15);
    expect(stack[0]?.keyframes?.exposure?.map((key) => key.frame)).toEqual([0, 30]);
  });

  it('removeParamKeyframe elimina la pista entera si queda una sola clave', () => {
    let stack = removeParamKeyframe(animated(), 'a', 'exposure', 0);
    expect(stack[0]?.keyframes).toBeUndefined();
    stack = removeParamKeyframe(animated(), 'a', 'exposure', 30);
    expect(stack[0]?.keyframes).toBeUndefined();
  });

  it('removeParamKeyframe es no-op sin pista, sin clave en el frame o sin instancia', () => {
    const plain = [createInstance(exposure, { id: 'b' })];
    expect(removeParamKeyframe(plain, 'b', 'exposure', 0)[0]?.keyframes).toBeUndefined();
    expect(removeParamKeyframe(animated(), 'a', 'exposure', 12)[0]?.keyframes?.exposure).toHaveLength(2);
    expect(removeParamKeyframe(animated(), 'zzz', 'exposure', 0)[0]?.keyframes?.exposure).toHaveLength(2);
  });

  it('el slider escribe en la clave del frame sólo si la pista existe', () => {
    let stack = animated();
    stack = setParamKeyframeAt(stack, exposure, 'a', 'exposure', 30, 0.75);
    expect(stack[0]?.keyframes?.exposure?.find((key) => key.frame === 30)?.value).toBe(0.75);
    // Sin pista no crea nada: la animación empieza con el botón de clave.
    const plain = [createInstance(exposure, { id: 'b' })];
    const untouched = setParamKeyframeAt(plain, exposure, 'b', 'exposure', 5, 1);
    expect(untouched[0]?.keyframes).toBeUndefined();
  });

  it('clearParamKeyframes devuelve el parámetro al estático', () => {
    const stack = clearParamKeyframes(animated(), 'a', 'exposure');
    expect(stack[0]?.keyframes).toBeUndefined();
    expect(stack[0]?.params.exposure).toBe(0.2);
  });

  it('setParamKeyframeBezier escribe la curva de la clave del segmento y la preserva al reescribir el valor', () => {
    const curve = { cp1X: 0.2, cp1Y: 0.1, cp2X: 0.8, cp2Y: 0.9 };
    let stack = setParamKeyframeBezier(animated(), 'a', 'exposure', 0, curve);
    const first = stack[0]?.keyframes?.exposure?.find((key) => key.frame === 0);
    expect(first?.bezier).toEqual(curve);
    expect(first?.value).toBe(-1);
    // Reescribir el valor no aplana la curva (misma regla que easing).
    stack = setParamKeyframeAt(stack, exposure, 'a', 'exposure', 0, -0.5);
    expect(stack[0]?.keyframes?.exposure?.find((key) => key.frame === 0)?.bezier).toEqual(curve);
    // null quita la curva de esa clave.
    stack = setParamKeyframeBezier(stack, 'a', 'exposure', 0, null);
    expect(stack[0]?.keyframes?.exposure?.find((key) => key.frame === 0)?.bezier).toBeUndefined();
  });

  it('setParamKeyframeBezier es no-op sin pista o sin clave en el frame', () => {
    const plain = [createInstance(exposure, { id: 'b' })];
    const noTrack = setParamKeyframeBezier(plain, 'b', 'exposure', 0, {
      cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1,
    });
    expect(noTrack[0]?.keyframes).toBeUndefined();
    const noKey = setParamKeyframeBezier(animated(), 'a', 'exposure', 12, {
      cp1X: 0, cp1Y: 0, cp2X: 1, cp2Y: 1,
    });
    expect(noKey[0]?.keyframes?.exposure?.every((key) => key.bezier === undefined)).toBe(true);
  });

  it('setParamKeyframeEasing escribe el preset, conserva el valor y reemplaza la curva propia', () => {
    const curve = { cp1X: 0.2, cp1Y: 0.1, cp2X: 0.8, cp2Y: 0.9 };
    let stack = setParamKeyframeBezier(animated(), 'a', 'exposure', 0, curve);
    stack = setParamKeyframeEasing(stack, 'a', 'exposure', 0, 'ease-in');
    const first = stack[0]?.keyframes?.exposure?.find((key) => key.frame === 0);
    expect(first?.easing).toBe('ease-in');
    expect(first?.value).toBe(-1);
    // El bezier ganaba sobre easing: al elegir preset se quita para que rija.
    expect(first?.bezier).toBeUndefined();
    // La otra clave no se toca.
    expect(
      stack[0]?.keyframes?.exposure?.find((key) => key.frame === 30)?.easing,
    ).toBeUndefined();
    // El muestreo refleja el preset en el tramo.
    expect(sampleKeyframes(stack[0]?.keyframes?.exposure, 15)).toBeCloseTo(-0.5, 5);
  });

  it('setParamKeyframeEasing es no-op sin pista o sin clave en el frame', () => {
    const plain = [createInstance(exposure, { id: 'b' })];
    const noTrack = setParamKeyframeEasing(plain, 'b', 'exposure', 0, 'hold');
    expect(noTrack[0]?.keyframes).toBeUndefined();
    const noKey = setParamKeyframeEasing(animated(), 'a', 'exposure', 12, 'hold');
    expect(
      noKey[0]?.keyframes?.exposure?.every((key) => key.easing === undefined),
    ).toBe(true);
  });

  it('clearParamKeyframeCurves quita bezier de todas las claves sin tocar la pista', () => {
    const curve = { cp1X: 0.2, cp1Y: 0.1, cp2X: 0.8, cp2Y: 0.9 };
    let stack = setParamKeyframeBezier(animated(), 'a', 'exposure', 0, curve);
    stack = setParamKeyframeBezier(stack, 'a', 'exposure', 30, curve);
    stack = clearParamKeyframeCurves(stack, 'a', 'exposure');
    const track = stack[0]?.keyframes?.exposure ?? [];
    expect(track).toHaveLength(2);
    expect(track.every((key) => key.bezier === undefined)).toBe(true);
  });

  it('ignora parámetros no numéricos', () => {
    const stack = [createInstance(grade, { id: 'g' })];
    const next = toggleParamKeyframe(stack, grade, 'g', 'lift', 3);
    expect(next[0]?.keyframes).toBeUndefined();
  });
});
