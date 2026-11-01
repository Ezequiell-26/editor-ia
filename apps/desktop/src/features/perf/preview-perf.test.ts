import { describe, expect, it } from 'vitest';
import { calculatePreviewPerf } from './preview-perf';

describe('medidor de preview', () => {
  it('calcula FPS y caídos con intervalos de 60 Hz', () => {
    const times = Array.from({ length: 61 }, (_, index) => index * (1000 / 60));
    const stats = calculatePreviewPerf(times, 30, true, 200 * 1024 * 1024);
    expect(stats.fps).toBeCloseTo(60, 1);
    expect(stats.frames).toBe(61);
    expect(stats.dropped).toBe(0);
    expect(stats.heapMb).toBe(200);
  });

  it('cuenta frames caídos cuando el compositor va lento', () => {
    const times = Array.from({ length: 11 }, (_, index) => index * 100);
    const stats = calculatePreviewPerf(times, 30, true);
    expect(stats.fps).toBeCloseTo(10, 1);
    expect(stats.dropped).toBe(20);
    expect(stats.heapMb).toBeNull();
  });

  it('sin reproducción no inventa métricas', () => {
    expect(calculatePreviewPerf([1, 2, 3], 30, false).active).toBe(false);
    expect(calculatePreviewPerf([1, 2, 3], 30, false).fps).toBe(0);
  });
});
