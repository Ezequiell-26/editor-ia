// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupSfxItems } from './SfxLibrary';
import type { SfxItem } from '../../services/contracts';

function item(id: string, group?: string): SfxItem {
  return {
    id,
    file: `${id}.wav`,
    label: id,
    description: '',
    durationSeconds: 0.5,
    ...(group !== undefined ? { group } : {}),
    path: `/sfx/${id}.wav`,
  };
}

describe('groupSfxItems', () => {
  it('agrupa por group conservando orden de primera aparición', () => {
    const groups = groupSfxItems([
      item('a', 'UX'),
      item('b', 'Impactos'),
      item('c', 'UX'),
      item('d'),
    ]);
    expect(groups.map(([key]) => key)).toEqual(['UX', 'Impactos', '']);
    expect(groups[0]?.[1].map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups[2]?.[1].map((i) => i.id)).toEqual(['d']);
  });

  it('sin grupos devuelve una sola entrada plana', () => {
    const groups = groupSfxItems([item('a'), item('b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.[0]).toBe('');
  });
});
