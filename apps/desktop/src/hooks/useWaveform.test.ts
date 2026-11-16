import { describe, expect, it } from 'vitest';
import {
  computePeaks,
  encodeWavePeak,
  peaksForWindow,
  waveformDurationSeconds,
  WAVE_CLIP_LEVEL,
  WAVE_HOT_LEVEL,
} from './useWaveform';

describe('waveform', () => {
  it('normalizes peak buckets and boosts quiet detail', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0, 1, -1, 0.25, 0]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(peaks[1]).toBeCloseTo(Math.SQRT1_2, 4);
    // raw = 1.0 (plena escala) se marca como punta caliente.
    expect(peaks[2]).toBe(WAVE_HOT_LEVEL);
    expect(peaks[3]).toBeCloseTo(0.5, 4);
  });

  it('marks clipped peaks above full scale', () => {
    const samples = new Float32Array([0.2, 0.4, 1.4, -1.2, 0.3]);
    const peaks = computePeaks(samples, 5);
    expect(peaks[2]).toBe(WAVE_CLIP_LEVEL);
    expect(peaks[3]).toBe(WAVE_CLIP_LEVEL);
    // El resto conserva la forma normalizada (<=1).
    expect(peaks[0]).toBeLessThanOrEqual(1);
    expect(peaks[1]).toBeLessThanOrEqual(1);
    expect(peaks[4]).toBeLessThanOrEqual(1);
  });

  it('does not mark hot or clipped on quiet material', () => {
    const samples = new Float32Array([0.1, -0.2, 0.15, -0.1]);
    const peaks = computePeaks(samples, 4);
    for (const peak of peaks) {
      expect(peak).toBeLessThanOrEqual(1);
    }
    expect(encodeWavePeak(0.4, 0.4)).toBe(1);
    expect(encodeWavePeak(0.5, 0.4)).toBeLessThanOrEqual(1);
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

describe('waveformDurationSeconds · AUD-039', () => {
  it('usa el frameRate del medio cuando existe', () => {
    expect(
      waveformDurationSeconds(2400, { num: 24, den: 1 }, 60),
    ).toBeCloseTo(100);
  });

  it('sin frameRate del medio usa el FPS del proyecto, no 30', () => {
    // Asset de audio importado en proyecto 24 fps: 14400 frames = 600 s.
    // Con el viejo fallback de 30 daba 480 s (subestimaba 20%).
    expect(waveformDurationSeconds(14_400, undefined, 24)).toBeCloseTo(600);
    // Proyecto 60 fps: 36000 frames = 600 s; con 30 daba 1200 s (el doble).
    expect(waveformDurationSeconds(36_000, undefined, 60)).toBeCloseTo(600);
  });

  it('sin medio ni proyecto conserva el fallback histórico de 30', () => {
    expect(waveformDurationSeconds(3000, undefined)).toBeCloseTo(100);
    expect(waveformDurationSeconds(3000, undefined, 0)).toBeCloseTo(100);
  });

  it('frameRate roto del medio cae al proyecto en vez de romper la duración', () => {
    expect(
      waveformDurationSeconds(2400, { num: 0, den: 1 }, 24),
    ).toBeCloseTo(100);
  });

  it('sin frames devuelve infinito (la duración es desconocida)', () => {
    expect(waveformDurationSeconds(0, undefined, 24)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
