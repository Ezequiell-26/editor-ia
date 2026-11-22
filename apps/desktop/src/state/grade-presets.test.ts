import { describe, expect, it } from 'vitest';
import { createDefaultColorGrade } from '@editor-ia/project-schema';
import {
  createBuiltinLooks, deleteGradePreset, getGradeClipboard, GRADE_PRESETS_KEY,
  hasGradeClipboard, loadGradePresets, parseGradePresets, saveGradePreset,
  setGradeClipboard, type PresetStorage,
} from './grade-presets';

function memory(): PresetStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('grade presets', () => {
  it('saves, dedupes by name, reloads and deletes', () => {
    const store = memory();
    const grade = createDefaultColorGrade();
    const saved = saveGradePreset('Mi look', { grade }, store);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe('Mi look');
    expect(loadGradePresets(store)).toHaveLength(1);
    expect(loadGradePresets(store)[0]?.grade?.nodes).toHaveLength(3);

    saveGradePreset('mi LOOK', { grade }, store);
    const deduped = loadGradePresets(store);
    expect(deduped).toHaveLength(1);

    expect(deleteGradePreset(deduped[0]!.id, store)).toHaveLength(0);
  });

  it('survives corrupt storage and rejects invalid grades', () => {
    expect(parseGradePresets('not json')).toEqual([]);
    expect(parseGradePresets('{"a":1}')).toEqual([]);
    expect(parseGradePresets('[{"id":"x","name":"bad","createdAt":"t","grade":{"version":99}}]')).toEqual([]);
    const store = memory();
    store.setItem(GRADE_PRESETS_KEY, 'null');
    expect(loadGradePresets(store)).toEqual([]);
  });

  it('keeps a deep, independent clipboard', () => {
    const grade = createDefaultColorGrade();
    setGradeClipboard(grade);
    expect(hasGradeClipboard()).toBe(true);
    const copy = getGradeClipboard()!;
    copy.nodes[1]!.label = 'modificado';
    expect(getGradeClipboard()!.nodes[1]!.label).toBe('Corrección 01');
    setGradeClipboard(null);
    expect(hasGradeClipboard()).toBe(false);
  });

  it('ships built-in looks with real, distinct values', () => {
    const looks = createBuiltinLooks();
    expect(looks.length).toBeGreaterThan(4);
    const warm = looks.find((look) => look.id === 'warm')!;
    const cool = looks.find((look) => look.id === 'cool')!;
    expect(warm.layer.primaries.temperature).toBeGreaterThan(0);
    expect(cool.layer.primaries.temperature).toBeLessThan(0);
    expect(looks.find((look) => look.id === 'mono')!.layer.primaries.saturation).toBe(0);
    expect(looks.find((look) => look.id === 'cinema')!.layer.curves.master?.length).toBeGreaterThan(2);
  });
});
