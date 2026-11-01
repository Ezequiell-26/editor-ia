import { describe, expect, it } from 'vitest';
import { assetGridColumns, chunkIntoRows } from './asset-grid';

describe('assetGridColumns', () => {
  it('replica auto-fill de 300 px con gap de 12', () => {
    expect(assetGridColumns(1180)).toBe(3);
    expect(assetGridColumns(900)).toBe(2);
    expect(assetGridColumns(600)).toBe(1);
    expect(assetGridColumns(624)).toBe(2);
    expect(assetGridColumns(0)).toBe(1);
    expect(assetGridColumns(Number.NaN)).toBe(1);
  });
});

describe('chunkIntoRows', () => {
  it('agrupa por cantidad de columnas y descarta filas vacías', () => {
    expect(chunkIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkIntoRows([], 3)).toEqual([]);
    expect(chunkIntoRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});
