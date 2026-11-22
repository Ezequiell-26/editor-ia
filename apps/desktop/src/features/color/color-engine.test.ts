import { describe, expect, it } from 'vitest';
import { createDefaultColorGrade, createNeutralLayer, type ColorGrade } from '@editor-ia/project-schema';
import {
  applyGradeProjection, clipChromaKeySpec, clipCurvesSpec, clipGlowSpec, clipRelightSpec, clipSharpenSpec, clipVignetteSpec, compileGrade, effectiveLayer, gradeCurveTable,
  gradeFilterId, resolveGradeStages, sampleGradeCurve,
} from './color-engine';

function gradeWith(primaries: Partial<ReturnType<typeof createNeutralLayer>['primaries']>): ColorGrade {
  const grade = createDefaultColorGrade();
  Object.assign(grade.nodes[1]!.layer.primaries, primaries);
  return grade;
}

describe('grade curve math', () => {
  it('samples an S-curve and builds a finite table', () => {
    const curve = [
      { x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.85 }, { x: 1, y: 1 },
    ];
    expect(sampleGradeCurve(curve, 0.25)).toBeCloseTo(0.15, 5);
    expect(sampleGradeCurve(curve, 0.5)).toBeCloseTo(0.5, 5);
    const table = gradeCurveTable(curve).split(' ');
    expect(table).toHaveLength(24);
    expect(table.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1)).toBe(true);
  });
});

describe('resolveGradeStages', () => {
  it('includes the first corrector of a serial chain', () => {
    const stages = resolveGradeStages(createDefaultColorGrade());
    expect(stages).toHaveLength(1);
    expect(stages[0]?.nodeId).toContain('color-node');
  });

  it('bypasses disabled and disconnected nodes', () => {
    const grade = createDefaultColorGrade();
    grade.nodes[1]!.enabled = false;
    expect(resolveGradeStages(grade)).toHaveLength(0);

    const disconnected = createDefaultColorGrade();
    disconnected.links = [];
    expect(resolveGradeStages(disconnected)).toHaveLength(0);
  });

  it('blends parallel branches feeding the same target', () => {
    const grade = createDefaultColorGrade();
    const a = grade.nodes[1]!;
    const b = { ...a, id: 'parallel-1', label: 'Paralelo', kind: 'parallel' as const, layer: createNeutralLayer() };
    a.layer.primaries.temperature = 1;
    b.layer.primaries.temperature = -1;
    grade.nodes = [...grade.nodes, b];
    grade.links = [
      { id: 'l1', from: 'color-source', to: a.id },
      { id: 'l2', from: 'color-source', to: b.id },
      { id: 'l3', from: a.id, to: 'color-output' },
      { id: 'l4', from: b.id, to: 'color-output' },
    ];
    const stages = resolveGradeStages(grade);
    expect(stages).toHaveLength(1);
    // Two opposite temperatures blended 50/50 cancel out.
    expect(Math.abs(stages[0]!.layer.primaries.temperature)).toBeLessThan(0.001);
  });

  it('chains serial nodes in link order', () => {
    const grade = createDefaultColorGrade();
    const second = { ...grade.nodes[1]!, id: 'serial-2', label: 'Corrección 02', layer: createNeutralLayer() };
    second.layer.primaries.contrast = 0.4;
    grade.nodes = [grade.nodes[0]!, grade.nodes[1]!, second, grade.nodes[2]!];
    grade.links = [
      { id: 'l1', from: 'color-source', to: grade.nodes[1]!.id },
      { id: 'l2', from: grade.nodes[1]!.id, to: 'serial-2' },
      { id: 'l3', from: 'serial-2', to: 'color-output' },
    ];
    const stages = resolveGradeStages(grade);
    expect(stages).toHaveLength(2);
    expect(effectiveLayer(stages).primaries.contrast).toBeGreaterThan(0.2);
  });
});

describe('compileGrade', () => {
  it('is inert for a neutral grade', () => {
    const compiled = compileGrade(createDefaultColorGrade(), 'neutral');
    expect(compiled.active).toBe(true);
    expect(compiled.css).toBe('');
    // Neutral layers still emit identity transfer tables, but no visible CSS.
    expect(compiled.svg?.primitives.every((p) => p.tag === 'feComponentTransfer')).toBe(true);
  });

  it('turns a brightness/contrast change into real CSS functions', () => {
    const grade = gradeWith({ contrast: 0.5, saturation: 1.4, temperature: 0.4 });
    const compiled = compileGrade(grade, 'grade-a');
    expect(compiled.css).toContain('contrast(');
    expect(compiled.css).toContain('saturate(');
    expect(compiled.css).toContain('sepia(');
    expect(compiled.effects.contrast).toBeGreaterThan(1);
    expect(compiled.effects.saturation).toBeGreaterThan(1);
    expect(compiled.effects.temperature).toBeCloseTo(0.4, 3);
  });

  it('emits per-channel tables when wheels and curves change', () => {
    const grade = createDefaultColorGrade();
    grade.nodes[1]!.layer.primaries.gain = { r: 0.4, g: 0, b: -0.2 };
    grade.nodes[1]!.layer.curves.master = [
      { x: 0, y: 0.05 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 },
    ];
    const compiled = compileGrade(grade, 'grade-b');
    expect(compiled.svg?.id).toBe('grade-b');
    const matrices = compiled.svg?.primitives.filter((p) => p.tag === 'feColorMatrix') ?? [];
    expect(matrices.length).toBeGreaterThan(0);
    const transfers = compiled.svg?.primitives.filter((p) => p.tag === 'feComponentTransfer') ?? [];
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers[0]?.funcs?.r).not.toBe(transfers[0]?.funcs?.b);
  });

  it('projects wheels, curves and LUT to the fields FFmpeg already reads', () => {
    const grade = createDefaultColorGrade();
    grade.nodes[1]!.layer.primaries.lift = { r: 0.2, g: 0.1, b: 0 };
    grade.nodes[1]!.layer.blur = 3;
    grade.nodes[1]!.layer.lutFile = 'media/luts/test.cube';
    grade.nodes[1]!.layer.lutIntensity = 0.6;
    const { effects } = compileGrade(grade, 'grade-c');
    expect(effects.lift).toEqual({ r: 0.2, g: 0.1, b: 0 });
    expect(effects.blur).toBe(3);
    expect(effects.lutFile).toBe('media/luts/test.cube');
    expect(effects.lutIntensity).toBe(0.6);
  });
});

describe('applyGradeProjection', () => {
  it('replaces only owned keys and preserves fades, stacks and audio', () => {
    const result = applyGradeProjection(
      { brightness: 0.9, fadeInFrames: 12, grayscale: true, audioStack: [] } as never,
      { brightness: 0.1, saturation: 1.2 },
    );
    expect(result.brightness).toBe(0.1);
    expect(result.saturation).toBe(1.2);
    expect(result.fadeInFrames).toBe(12);
    expect(result.grayscale).toBe(true);
    expect(result.audioStack).toEqual([]);
  });

  it('keeps a DOM-safe filter id', () => {
    expect(gradeFilterId('abc-123:xyz')).toBe('grade-filter-abc-123_xyz');
  });
});

describe('clipCurvesSpec', () => {
  const tableOf = (spec: ReturnType<typeof clipCurvesSpec>, channel: 'r' | 'g' | 'b'): number[] => {
    const func = spec?.primitives[0]?.funcs?.[channel];
    expect(func).toBeTruthy();
    return func!.split(' ').map(Number);
  };

  it('devuelve null sin curvas ni preset', () => {
    expect(clipCurvesSpec(undefined, 'f1')).toBeNull();
    expect(clipCurvesSpec({}, 'f1')).toBeNull();
  });

  it('curvePreset darker aplica la master curve a los tres canales', () => {
    const spec = clipCurvesSpec({ curvePreset: 'darker' }, 'f1');
    expect(spec?.id).toBe('f1');
    const r = tableOf(spec, 'r');
    const g = tableOf(spec, 'g');
    const b = tableOf(spec, 'b');
    // master "0/0 0.5/0.4 1/1": a mitad de tabla la salida queda por debajo
    // de la identidad (0.4 < 0.5 aprox por interpolación linear).
    const mid = Math.floor(r.length / 2);
    expect(r[mid]!).toBeLessThan(mid / (r.length - 1));
    expect(r).toEqual(g);
    expect(g).toEqual(b);
  });

  it('curvas propias componen canal y master como FFmpeg', () => {
    const spec = clipCurvesSpec(
      {
        curves: {
          red: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          master: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.25 },
            { x: 1, y: 1 },
          ],
        },
      },
      'f2',
    );
    const r = tableOf(spec, 'r');
    const g = tableOf(spec, 'g');
    // master baja medios tonos: en x=0.5, channel identity → master(0.5)≈0.25.
    const mid = Math.floor(r.length / 2);
    expect(r[mid]!).toBeLessThan(0.4);
    // green no tiene curva propia → también pasa por master.
    expect(g[mid]!).toBeLessThan(0.4);
    // extremos anclados.
    expect(r[0]).toBe(0);
    expect(r[r.length - 1]).toBe(1);
  });

  it('preset vintage separa los canales (sin master)', () => {
    const spec = clipCurvesSpec({ curvePreset: 'vintage' }, 'f3');
    const r = tableOf(spec, 'r');
    const b = tableOf(spec, 'b');
    // vintage: r arranca en y=0.11, b en y=0.22 →primer sample > 0.
    expect(r[0]).toBeCloseTo(0.11, 2);
    expect(b[0]).toBeCloseTo(0.22, 2);
  });

  it('curvas que resuelven a identidad devuelven null', () => {
    const identity = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(
      clipCurvesSpec({ curves: { master: identity } }, 'f4'),
    ).toBeNull();
  });
});

describe('clipSharpenSpec', () => {
  it('devuelve null sin nitidez', () => {
    expect(clipSharpenSpec(undefined, 's1')).toBeNull();
    expect(clipSharpenSpec({ sharpen: 0 }, 's1')).toBeNull();
  });

  it('emite feConvolveMatrix con kernel de enfoque para sharpen > 0', () => {
    const spec = clipSharpenSpec({ sharpen: 2 }, 's1');
    expect(spec?.id).toBe('s1');
    const prim = spec?.primitives[0];
    expect(prim?.tag).toBe('feConvolveMatrix');
    const kernel = String(prim?.attrs.kernelMatrix);
    // amount = 2*0.35 = 0.7 → centro 1+2.8 = 3.8, bordes -0.7.
    expect(kernel).toContain('3.8');
    expect(kernel).toContain('-0.7');
  });
});

describe('clipGlowSpec', () => {
  it('devuelve null sin glow o con intensidad ~0', () => {
    expect(clipGlowSpec(undefined, 'g1')).toBeNull();
    expect(clipGlowSpec({}, 'g1')).toBeNull();
    expect(
      clipGlowSpec({ glow: { intensity: 0, radius: 10, threshold: 0.5 } }, 'g1'),
    ).toBeNull();
  });

  it('encadena crush → blur → dim → screen como el export', () => {
    const spec = clipGlowSpec(
      { glow: { intensity: 0.8, radius: 12, threshold: 0.5 } },
      'g1',
    );
    expect(spec?.id).toBe('g1');
    const tags = spec!.primitives.map((p) => p.tag);
    expect(tags).toEqual([
      'feComponentTransfer',
      'feGaussianBlur',
      'feComponentTransfer',
      'feBlend',
    ]);
    const blur = spec!.primitives[1]!;
    expect(blur.attrs.stdDeviation).toBe('12.00');
    const blend = spec!.primitives[3]!;
    expect(blend.attrs.mode).toBe('screen');
    // El crush anula todo por debajo del umbral: primer sample = 0.
    const crush = spec!.primitives[0]!.funcs!.r!.split(' ').map(Number);
    expect(crush[0]).toBe(0);
    expect(crush[crush.length - 1]).toBeCloseTo(1, 3);
  });
});

describe('clipVignetteSpec', () => {
  it('devuelve null sin viñeta o con valor ~0', () => {
    expect(clipVignetteSpec(undefined, 'v1')).toBeNull();
    expect(clipVignetteSpec({}, 'v1')).toBeNull();
    expect(clipVignetteSpec({ vignette: 0.0005 }, 'v1')).toBeNull();
  });

  it('genera feImage data-URI + feBlend multiply', () => {
    const spec = clipVignetteSpec({ vignette: 0.8 }, 'v1');
    expect(spec?.id).toBe('v1');
    expect(spec!.primitives.map((p) => p.tag)).toEqual(['feImage', 'feBlend']);
    const image = spec!.primitives[0]!;
    expect(String(image.attrs.href)).toMatch(/^data:image\/svg\+xml,/);
    expect(image.attrs.preserveAspectRatio).toBe('none');
    const blend = spec!.primitives[1]!;
    expect(blend.attrs.mode).toBe('multiply');
    expect(blend.attrs.in).toBe('SourceGraphic');
  });

  it('la fuerza de la viñeta oscurece el stop del borde', () => {
    const weak = clipVignetteSpec({ vignette: 0.2 }, 'v1')!;
    const strong = clipVignetteSpec({ vignette: 1 }, 'v1')!;
    const edgeOf = (spec: typeof weak) =>
      decodeURIComponent(String(spec.primitives[0]!.attrs.href)).match(
        /stop-color="rgb\(([\d.]+),/,
      )![1];
    // Más viñeta → borde más oscuro (menor luminancia).
    expect(Number(edgeOf(strong))).toBeLessThan(Number(edgeOf(weak)));
    expect(Number(edgeOf(weak))).toBeCloseTo(0.81, 2);
    expect(Number(edgeOf(strong))).toBeCloseTo(0.05, 2);
  });

  it('recorta valores por encima de 1', () => {
    const over = clipVignetteSpec({ vignette: 1.5 }, 'v1');
    const max = clipVignetteSpec({ vignette: 1 }, 'v1');
    expect(over!.primitives[0]!.attrs.href).toBe(max!.primitives[0]!.attrs.href);
  });
});

describe('clipRelightSpec', () => {
  const base = { x: 0, y: 0, radius: 0.5, strength: 0.8, warmth: 0.2 };

  it('devuelve null sin relight o con fuerza y calidez ~0', () => {
    expect(clipRelightSpec(undefined, 'r1')).toBeNull();
    expect(
      clipRelightSpec({ relight: { ...base, strength: 0, warmth: 0 } }, 'r1'),
    ).toBeNull();
  });

  it('ganancia positiva genera feImage+feBlend screen', () => {
    const spec = clipRelightSpec({ relight: base }, 'r1');
    expect(spec?.id).toBe('r1');
    expect(spec!.primitives.map((p) => p.tag)).toEqual(['feImage', 'feBlend']);
    const blend = spec!.primitives[1]!;
    expect(blend.attrs.mode).toBe('screen');
    expect(String(spec!.primitives[0]!.attrs.href)).toContain('data:image/svg');
  });

  it('fuerza negativa genera feBlend multiply', () => {
    const spec = clipRelightSpec(
      { relight: { ...base, strength: -0.8, warmth: 0 } },
      'r1',
    );
    expect(spec!.primitives.map((p) => p.tag)).toEqual(['feImage', 'feBlend']);
    expect(spec!.primitives[1]!.attrs.mode).toBe('multiply');
  });

  it('ganancias mixtas encadenan screen → multiply', () => {
    // strength positivo pequeño + warmth negativo fuerte → B queda negativo.
    const spec = clipRelightSpec(
      { relight: { ...base, strength: 0.2, warmth: -1 } },
      'r1',
    );
    const modes = spec!.primitives
      .filter((p) => p.tag === 'feBlend')
      .map((p) => p.attrs.mode);
    expect(modes).toEqual(['screen', 'multiply']);
    // El segundo blend toma el resultado del primero, no SourceGraphic.
    const second = spec!.primitives.filter((p) => p.tag === 'feBlend')[1]!;
    expect(second.attrs.in).not.toBe('SourceGraphic');
  });

  it('el gradiente lleva el centro y radio normalizados', () => {
    const spec = clipRelightSpec(
      { relight: { ...base, x: 0.25, y: -0.25, radius: 0.4 } },
      'r1',
    )!;
    const svg = decodeURIComponent(String(spec.primitives[0]!.attrs.href));
    expect(svg).toContain('cx="0.7500"');
    expect(svg).toContain('cy="0.2500"');
    expect(svg).toContain('r="0.4000"');
  });
});

describe('clipChromaKeySpec', () => {
  const key = { color: '#00ff00', similarity: 0.3, blend: 0.1 };

  it('devuelve null sin key o con color inválido', () => {
    expect(clipChromaKeySpec(undefined, 'k1')).toBeNull();
    expect(clipChromaKeySpec({ ...key, color: 'verde' }, 'k1')).toBeNull();
  });

  it('encadena diff → dist → matte → composite in', () => {
    const spec = clipChromaKeySpec(key, 'k1');
    expect(spec?.id).toBe('k1');
    expect(spec!.primitives.map((p) => p.tag)).toEqual([
      'feComponentTransfer',
      'feColorMatrix',
      'feComponentTransfer',
      'feComposite',
    ]);
    const composite = spec!.primitives[3]!;
    expect(composite.attrs.operator).toBe('in');
    expect(composite.attrs.in).toBe('SourceGraphic');
  });

  it('las tablas |x−k| valen 0 en el color clave', () => {
    const spec = clipChromaKeySpec(key, 'k1')!;
    // key #00ff00 → kr=0, kg=1, kb=0. La tabla de G vale 0 en x=1 (último sample).
    const gTable = spec.primitives[0]!.funcs!.g!.split(' ').map(Number);
    expect(gTable[gTable.length - 1]).toBeCloseTo(0, 3);
    const rTable = spec.primitives[0]!.funcs!.r!.split(' ').map(Number);
    expect(rTable[0]).toBeCloseTo(0, 3);
  });

  it('el threshold conserva lo que se aleja del clave (keep=1 al final)', () => {
    const spec = clipChromaKeySpec(key, 'k1')!;
    const matte = spec.primitives[2]!.funcs!.a!.split(' ').map(Number);
    // Extremo de la tabla (distancia máxima) → conservar = 1.
    expect(matte[matte.length - 1]).toBeCloseTo(1, 2);
    // Inicio (distancia 0 = color exacto) → remover = 0.
    expect(matte[0]).toBeCloseTo(0, 2);
  });

  it('sin spill (o spill ~0) la cadena queda en 4 primitivas', () => {
    expect(clipChromaKeySpec({ ...key, spill: 0 }, 'k1')!.primitives).toHaveLength(4);
    expect(clipChromaKeySpec({ ...key, spill: 0.0005 }, 'k1')!.primitives).toHaveLength(4);
  });

  it('con spill verde agrega UNA feColorMatrix de supresión', () => {
    const spec = clipChromaKeySpec({ ...key, spill: 0.6 }, 'k1')!;
    expect(spec.primitives).toHaveLength(5);
    const last = spec.primitives[spec.primitives.length - 1]!;
    expect(last.tag).toBe('feColorMatrix');
    expect(last.attrs.in).toBe('chroma-keyed');
    expect(last.attrs.result).toBe('chroma-spilled');
    // values = 4 filas de 5 [r,g,b,a,const]. Canal G (fila 1):
    // G' = 0.3·R + 0.4·G + 0.3·B  (avg en vez de max — ver color-engine).
    const rows = String(last.attrs.values).split(' ').map(Number);
    expect(rows[5]).toBeCloseTo(0.3, 3); // R
    expect(rows[6]).toBeCloseTo(0.4, 3); // G (1 - spill)
    expect(rows[7]).toBeCloseTo(0.3, 3); // B
    // Filas R y B identidad, A copia el alpha de entrada.
    expect(rows[0]).toBe(1);
    expect(rows[12]).toBe(1); // B row: coef G? fila B indices 10..14 → [0,0,1,0,0]
    expect(rows[15]).toBe(0);
    expect(rows[18]).toBe(1); // A row copia alpha
  });

  it('con spill azul la supresión entra por el canal B (fila 2)', () => {
    const spec = clipChromaKeySpec(
      { color: '#0000ff', similarity: 0.3, blend: 0.1, spill: 0.5 },
      'k1',
    )!;
    const last = spec.primitives[spec.primitives.length - 1]!;
    const rows = String(last.attrs.values).split(' ').map(Number);
    // Fila B = indices 10..14: B' = 0.25·R + 0.25·G + 0.5·B.
    expect(rows[10]).toBeCloseTo(0.25, 3);
    expect(rows[11]).toBeCloseTo(0.25, 3);
    expect(rows[12]).toBeCloseTo(0.5, 3);
  });

  it('spill sobre color que no es pantalla no agrega primitivas', () => {
    const spec = clipChromaKeySpec(
      { color: '#ff0000', similarity: 0.3, blend: 0.1, spill: 0.8 },
      'k1',
    )!;
    expect(spec.primitives).toHaveLength(4);
  });
});
