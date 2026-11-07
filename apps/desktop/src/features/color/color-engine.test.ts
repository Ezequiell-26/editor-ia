import { describe, expect, it } from 'vitest';
import { createDefaultColorGrade, createNeutralLayer, type ColorGrade } from '@editor-ia/project-schema';
import {
  applyGradeProjection, compileGrade, effectiveLayer, gradeCurveTable,
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
