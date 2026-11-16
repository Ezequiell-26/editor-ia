import { describe, expect, it, vi } from 'vitest';
import {
  PREWARM_RADIUS,
  prewarmFramesAround,
  prewarmOffsets,
  type FramePrewarmBounds,
} from './frame-prewarm';
import type { PreviewFrameRequest, PreviewFrameResult } from '../../services/contracts/media';

const request: PreviewFrameRequest = {
  project: { video: { frameRate: { num: 30, den: 1 } } },
  clipId: 'clip-1',
  frame: 100,
};

const bounds: FramePrewarmBounds = { minFrame: 90, maxFrame: 110 };

function fakeRender(failOn?: number) {
  const calls: number[] = [];
  const render = vi.fn(async (req: PreviewFrameRequest): Promise<PreviewFrameResult> => {
    calls.push(req.frame);
    if (req.frame === failOn) throw new Error('ffmpeg fallo');
    return {
      path: `frame-${req.frame}.png`,
      width: 1920,
      height: 1080,
      frame: req.frame,
      timeSeconds: req.frame / 30,
      clipId: req.clipId,
      clipLabel: 'clip',
      native: false,
      decoder: 'ffmpeg',
    };
  });
  return { calls, render };
}

describe('prewarmOffsets', () => {
  it('ordena por cercanía: +1, −1, +2, −2', () => {
    expect(prewarmOffsets(2)).toEqual([1, -1, 2, -2]);
    expect(prewarmOffsets(1)).toEqual([1, -1]);
    expect(PREWARM_RADIUS).toBe(2);
  });
});

describe('prewarmFramesAround', () => {
  it('renderiza los vecinos dentro de bounds en orden de cercanía', async () => {
    const { calls, render } = fakeRender();
    await prewarmFramesAround(render, request, bounds);
    expect(calls).toEqual([101, 99, 102, 98]);
  });

  it('respeta minFrame/maxFrame y salta frames inválidos', async () => {
    const { calls, render } = fakeRender();
    await prewarmFramesAround(render, { ...request, frame: 91 }, bounds);
    // 92,90,93,89→sólo 90..93 válidos dentro de [90,110] menos el actual 91.
    expect(calls).toEqual([92, 90, 93]);
  });

  it('sigue adelante si un vecino falla (best-effort)', async () => {
    const { calls, render } = fakeRender(101);
    await prewarmFramesAround(render, request, bounds);
    expect(calls).toEqual([101, 99, 102, 98]);
  });

  it('corta la cadena cuando isStale devuelve true', async () => {
    const { calls, render } = fakeRender();
    let renders = 0;
    await prewarmFramesAround(render, request, bounds, () => {
      renders += 1;
      return renders > 2;
    });
    expect(calls).toEqual([101, 99]);
  });

  it('no renderiza nada si el frame pedido ya está fuera de bounds', async () => {
    const { calls, render } = fakeRender();
    await prewarmFramesAround(render, { ...request, frame: 500 }, bounds);
    expect(calls).toEqual([]);
  });
});
