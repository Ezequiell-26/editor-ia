import { describe, expect, it } from 'vitest';
import { computePeaks, peaksForWindow } from './useWaveform';

describe('waveform', () => {
  it('normalizes peak buckets and boosts quiet detail', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0, 1, -1, 0.25, 0]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(peaks[1]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(peaks[2]).toBe(1);
    expect(peaks[3]).toBeCloseTo(0.5, 4);
  });

  it('returns an empty array for empty audio', () => {
    expect(computePeaks(new Float32Array(0), 8)).toEqual([]);
  });

  it('slices the asset peaks down to the clip source window', () => {
    const peaks = Array.from({ length: 100 }, (_, index) => index);
    expect(peaksForWindow(peaks, 25, 75, 100)).toEqual(peaks.slice(25, 75));
  });

  it('keeps at least one bucket for very short windows', () => {
    const peaks = Array.from({ length: 10 }, (_, index) => index);
    expect(peaksForWindow(peaks, 4, 5, 1000)).toEqual([0]);
  });
});
