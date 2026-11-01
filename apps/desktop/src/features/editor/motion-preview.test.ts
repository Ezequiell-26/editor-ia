import { describe, expect, it } from 'vitest';
import { motionPreview } from './motion-preview';

describe('movimiento de foto en la preview', () => {
  it('el paneo es lineal en la intensidad y el progreso', () => {
    const slow = motionPreview({ type: 'pan-left', intensity: 0.05 }, 0);
    const fast = motionPreview({ type: 'pan-left', intensity: 0.4 }, 0);
    expect(slow.x).toBeCloseTo(1.25, 5);
    expect(fast.x).toBeCloseTo(10, 5);
    expect(slow.scale).toBeCloseTo(1.05, 5);
    expect(fast.scale).toBeCloseTo(1.4, 5);
    const slowEnd = motionPreview({ type: 'pan-left', intensity: 0.05 }, 1);
    const fastEnd = motionPreview({ type: 'pan-left', intensity: 0.4 }, 1);
    expect(slowEnd.x).toBeCloseTo(-1.25, 5);
    expect(fastEnd.x).toBeCloseTo(-10, 5);
    expect(Math.abs(fastEnd.x - fast.x)).toBeGreaterThan(Math.abs(slowEnd.x - slow.x));
  });

  it('zoom-in y zoom-out interpolan en sentidos opuestos', () => {
    expect(motionPreview({ type: 'zoom-in', intensity: 0.2 }, 0).scale).toBeCloseTo(1, 5);
    expect(motionPreview({ type: 'zoom-in', intensity: 0.2 }, 1).scale).toBeCloseTo(1.2, 5);
    expect(motionPreview({ type: 'zoom-out', intensity: 0.2 }, 0).scale).toBeCloseTo(1.2, 5);
    expect(motionPreview({ type: 'zoom-out', intensity: 0.2 }, 1).scale).toBeCloseTo(1, 5);
  });

  it('acota el progreso y cubre los cuatro paneos', () => {
    expect(motionPreview({ type: 'pan-right', intensity: 0.2 }, 2).x).toBeCloseTo(5, 5);
    expect(motionPreview({ type: 'pan-up', intensity: 0.2 }, -1).y).toBeCloseTo(5, 5);
    expect(motionPreview({ type: 'pan-down', intensity: 0.2 }, 1).y).toBeCloseTo(5, 5);
    expect(motionPreview({ type: 'pan-left' }, 0.5)).toEqual({ scale: 1.12, x: 0, y: 0 });
  });
});
