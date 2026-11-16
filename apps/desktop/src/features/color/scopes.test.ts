import { describe, expect, it } from 'vitest';
import {
  PARADE_COLUMNS,
  VECTOR_SIZE,
  WAVEFORM_COLUMNS,
  WAVEFORM_LEVELS,
  computeScopes,
} from './scopes.ts';

function pixels(colors: readonly (readonly [number, number, number])[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b], index) => {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = 255;
  });
  return data;
}

function sum(values: Uint32Array): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('computeScopes', () => {
  it('counts luma, RGB, waveform and vectorscope bins for every sample', () => {
    const data = pixels([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
    const scopes = computeScopes(data, 2, 2);
    expect(scopes.sampleCount).toBe(4);
    expect(scopes.luma).toHaveLength(256);
    expect(sum(scopes.luma)).toBe(4);
    expect(sum(scopes.red)).toBe(4);
    expect(sum(scopes.green)).toBe(4);
    expect(sum(scopes.blue)).toBe(4);
    expect(scopes.waveform).toHaveLength(WAVEFORM_COLUMNS * WAVEFORM_LEVELS);
    expect(sum(scopes.waveform)).toBe(4);
    expect(scopes.vectorscope).toHaveLength(VECTOR_SIZE * VECTOR_SIZE);
    expect(sum(scopes.vectorscope)).toBe(4);
    expect(scopes.red[255]).toBe(2);
    expect(scopes.green[255]).toBe(2);
    expect(scopes.blue[255]).toBe(2);
    expect(scopes.red[0]).toBe(2);
  });

  it('puts neutral white near the center of the vectorscope', () => {
    const scopes = computeScopes(pixels([[255, 255, 255]]), 1, 1);
    const center = Math.floor(VECTOR_SIZE / 2);
    expect(scopes.vectorscope[center * VECTOR_SIZE + center]).toBe(1);
  });

  it('puts saturated red away from the vectorscope center', () => {
    const scopes = computeScopes(pixels([[255, 0, 0]]), 1, 1);
    const center = Math.floor(VECTOR_SIZE / 2);
    expect(scopes.vectorscope[center * VECTOR_SIZE + center]).toBe(0);
    expect(sum(scopes.vectorscope)).toBe(1);
  });

  it('returns empty scopes when the frame has no usable pixels', () => {
    const scopes = computeScopes(new Uint8ClampedArray(0), 0, 0);
    expect(scopes.sampleCount).toBe(0);
    expect(sum(scopes.luma)).toBe(0);
    expect(sum(scopes.waveform)).toBe(0);
    expect(sum(scopes.vectorscope)).toBe(0);
  });

  it('separa el parade en tres canales con sus propios bins', () => {
    const width = 6;
    const height = 2;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = 255; // rojo puro
      pixels[index * 4 + 1] = 0;
      pixels[index * 4 + 2] = 0;
      pixels[index * 4 + 3] = 255;
    }
    const scopes = computeScopes(pixels, width, height);
    const third = Math.floor(PARADE_COLUMNS / 3);
    let redBins = 0;
    let greenBins = 0;
    let blueBins = 0;
    for (let index = 0; index < scopes.parade.length; index += 1) {
      const count = scopes.parade[index] ?? 0;
      if (count === 0) continue;
      const column = index % PARADE_COLUMNS;
      if (column < third) redBins += count;
      else if (column < third * 2) greenBins += count;
      else blueBins += count;
    }
    expect(redBins).toBe(width * height);
    expect(greenBins).toBe(0);
    expect(blueBins).toBe(0);
  });
});
