import { describe, expect, it } from 'vitest';
import { applyLottieTheme, parseLottieTheme } from './lottie-theme';

function animation(): Record<string, unknown> {
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      { ty: 4, nm: 'fill', shapes: [{ ty: 'fl', c: { a: 0, k: [0, 0, 0, 1], sid: 'fill' } }] },
      {
        ty: 4,
        nm: 'meta',
        ks: {
          o: { a: 0, k: 100, sid: 'opacity' },
          p: { a: 0, k: [0, 0], sid: 'pos' },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100] },
              { t: 60, s: [200, 200] },
            ],
            sid: 'scale',
          },
        },
      },
      { a: 0, k: { t: 'Hola', f: 'Arial', s: 24, fc: [0, 0, 0] }, sid: 'title' },
    ],
  };
}

describe('parseLottieTheme', () => {
  it('acepta {rules} o un array y descarta reglas inválidas', () => {
    const theme = parseLottieTheme('t1', {
      name: 'Tema',
      rules: [
        { id: 'a', type: 'Color', value: [1, 0, 0] },
        { id: '', type: 'Color', value: [1, 0, 0] },
        { id: 'b', type: 'Nope', value: 1 },
      ],
    });
    expect(theme?.name).toBe('Tema');
    expect(theme?.rules).toHaveLength(1);
    expect(parseLottieTheme('arr', [{ id: 'a', type: 'Scalar', value: 1 }])?.rules).toHaveLength(1);
    expect(parseLottieTheme('bad', { rules: 'x' })).toBeNull();
  });
});

describe('applyLottieTheme', () => {
  it('aplica color, scalar, posición, vector animado y texto sobre slots', () => {
    const theme = parseLottieTheme('brand', {
      rules: [
        { id: 'fill', type: 'Color', value: [1, 0, 0] },
        { id: 'opacity', type: 'Scalar', value: 50 },
        { id: 'pos', type: 'Position', value: [10, 20] },
        {
          id: 'scale',
          type: 'Vector',
          keyframes: [
            { frame: 0, value: [1, 1] },
            { frame: 60, value: [2, 2], hold: true },
          ],
        },
        {
          id: 'title',
          type: 'Text',
          value: { text: 'Nuevo', fontSize: 48, fillColor: [1, 1, 1], justify: 'Center' },
        },
      ],
    })!;
    const original = animation();
    const result = applyLottieTheme(original, theme, 'anim_1');
    expect(result.applied).toBe(5);
    expect(result.warnings).toEqual([]);

    const layers = result.raw.layers as Record<string, unknown>[];
    const shapes = layers[0]!.shapes as Record<string, unknown>[];
    expect((shapes[0]!.c as Record<string, unknown>).k).toEqual([1, 0, 0, 1]);
    const ks = layers[1]!.ks as Record<string, unknown>;
    expect((ks.o as Record<string, unknown>).k).toBe(50);
    expect((ks.p as Record<string, unknown>).k).toEqual([10, 20]);
    const scale = ks.s as Record<string, unknown>;
    expect(scale.a).toBe(1);
    expect(scale.k).toEqual([
      { t: 0, s: [1, 1] },
      { t: 60, s: [2, 2], h: 1 },
    ]);
    const title = layers[2] as Record<string, unknown>;
    const doc = title.k as Record<string, unknown>;
    expect(doc.t).toBe('Nuevo');
    expect(doc.s).toBe(48);
    expect(doc.fc).toEqual([1, 1, 1]);
    expect(doc.j).toBe(2);

    // El JSON del pack no se muta.
    const originalShapes = (original.layers as Record<string, unknown>[])[0]!
      .shapes as Record<string, unknown>[];
    expect((originalShapes[0]!.c as Record<string, unknown>).k).toEqual([0, 0, 0, 1]);
  });

  it('acepta claves cortas del Text Document además de las largas', () => {
    const theme = parseLottieTheme('corto', {
      rules: [
        {
          id: 'title',
          type: 'Text',
          value: { t: 'Corto', s: 32, fc: [0, 1, 0], j: 1 },
        },
      ],
    })!;
    const result = applyLottieTheme(animation(), theme, 'anim_1');
    const title = (result.raw.layers as Record<string, unknown>[])[2]!;
    const doc = title.k as Record<string, unknown>;
    expect(doc.t).toBe('Corto');
    expect(doc.s).toBe(32);
    expect(doc.fc).toEqual([0, 1, 0]);
    expect(doc.j).toBe(1);
  });

  it('avisa por slots inexistentes, expresiones y tipos no soportados', () => {
    const theme = parseLottieTheme('warn', {
      rules: [
        { id: 'missing', type: 'Color', value: [1, 0, 0] },
        { id: 'fill', type: 'Color', expression: 'var $bm_rt; $bm_rt = [1,0,0];' },
        { id: 'fill', type: 'Gradient', value: [] },
      ],
    })!;
    const result = applyLottieTheme(animation(), theme, 'anim_1');
    expect(result.applied).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/no existe/);
    expect(result.warnings.join(' ')).toMatch(/expresión/);
    expect(result.warnings.join(' ')).toMatch(/Gradient/);
  });

  it('ignora reglas de otras animaciones', () => {
    const theme = parseLottieTheme('filtro', {
      rules: [{ id: 'fill', type: 'Color', animations: ['otra'], value: [1, 0, 0] }],
    })!;
    const result = applyLottieTheme(animation(), theme, 'anim_1');
    expect(result.applied).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
