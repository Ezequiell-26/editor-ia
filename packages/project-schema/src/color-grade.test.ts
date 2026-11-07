import { describe, expect, it } from 'vitest';
import {
  COLOR_GRADE_OUTPUT_ID,
  COLOR_GRADE_SOURCE_ID,
  ColorGradeSchema,
  createDefaultColorGrade,
  createNeutralLayer,
} from './color-grade.ts';
import { ClipEffectsSchema } from './timeline.ts';

describe('ColorGrade schema', () => {
  it('produces a valid default serial chain', () => {
    const grade = createDefaultColorGrade();
    expect(ColorGradeSchema.safeParse(grade).success).toBe(true);
    expect(grade.nodes.map((node) => node.kind)).toEqual(['source', 'serial', 'output']);
    expect(grade.links[0]?.from).toBe(COLOR_GRADE_SOURCE_ID);
    expect(grade.links[1]?.to).toBe(COLOR_GRADE_OUTPUT_ID);
  });

  it('keeps the neutral layer neutral', () => {
    const layer = createNeutralLayer();
    expect(layer.primaries.saturation).toBe(1);
    expect(layer.primaries.contrast).toBe(0);
    expect(layer.mixer.red).toEqual([1, 0, 0]);
    expect(layer.curves).toEqual({});
    expect(layer.windows).toEqual([]);
  });

  it('rejects unknown keys, bad ranges and unordered curves', () => {
    const grade = createDefaultColorGrade();
    const wrong = { ...grade, nodes: [...grade.nodes, { ...grade.nodes[1]!, id: 'extra', typo: true }] };
    expect(ColorGradeSchema.safeParse(wrong).success).toBe(false);

    const withCurve = createDefaultColorGrade();
    withCurve.nodes[1]!.layer.curves.master = [
      { x: 0, y: 0 }, { x: 0.8, y: 0.7 }, { x: 0.4, y: 0.5 }, { x: 1, y: 1 },
    ];
    expect(ColorGradeSchema.safeParse(withCurve).success).toBe(false);

    const outOfRange = createDefaultColorGrade();
    outOfRange.nodes[1]!.layer.primaries.saturation = 9;
    expect(ColorGradeSchema.safeParse(outOfRange).success).toBe(false);
  });

  it('embeds into ClipEffects without breaking existing projects', () => {
    expect(ClipEffectsSchema.safeParse({ brightness: 0.2 }).success).toBe(true);
    expect(ClipEffectsSchema.safeParse({ brightness: 0.2, colorGrade: createDefaultColorGrade() }).success).toBe(true);
    expect(ClipEffectsSchema.safeParse({ colorGrade: { version: 99 } }).success).toBe(false);
    expect(ClipEffectsSchema.safeParse({ colorGrade: createDefaultColorGrade(), nope: 1 }).success).toBe(false);
  });

  it('rejects a graph with too few terminals', () => {
    const grade = createDefaultColorGrade();
    expect(ColorGradeSchema.safeParse({ ...grade, nodes: [grade.nodes[1]!] }).success).toBe(false);
  });
});
