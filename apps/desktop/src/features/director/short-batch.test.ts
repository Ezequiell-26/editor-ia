import { describe, expect, it, vi } from 'vitest';
import type { ExportShortResult } from '../../services/project-service';
import type { ShortCandidate } from './shorts';
import { runShortBatch } from './short-batch';

function candidate(id: string, title: string, start = 0): ShortCandidate {
  return {
    id,
    title,
    startSeconds: start,
    endSeconds: start + 20,
    durationSeconds: 20,
    score: 80,
    reasons: ['gancho'],
    excerpt: 'texto',
  };
}

function result(path: string): ExportShortResult {
  return {
    path,
    bytes: 1024,
    width: 1080,
    height: 1920,
    durationSeconds: 20,
    reframe: 'center',
    facesDetected: 0,
  };
}

describe('lote de Auto Shorts', () => {
  it('exporta todos los candidatos en orden con una sola carpeta', async () => {
    const exportOne = vi.fn(async (request: { readonly label?: string }) =>
      result(`${request.label ?? 'short'}.mp4`),
    );
    const progress: string[] = [];
    const outcomes = await runShortBatch(
      [candidate('a', 'Uno'), candidate('b', 'Dos')],
      { videoPath: 'video.mp4', outputDir: 'salida', smartReframe: true },
      exportOne,
      (item) => progress.push(`${item.index}/${item.total}:${item.title}`),
    );

    expect(outcomes.every((item) => item.ok)).toBe(true);
    expect(outcomes.map((item) => item.result?.path)).toEqual([
      'Uno.mp4',
      'Dos.mp4',
    ]);
    expect(progress).toEqual(['1/2:Uno', '2/2:Dos']);
    expect(exportOne).toHaveBeenCalledTimes(2);
    expect(exportOne.mock.calls[0]?.[0]).toMatchObject({
      path: 'video.mp4',
      outputDir: 'salida',
      smartReframe: true,
      label: 'Uno',
    });
  });

  it('sigue con el siguiente si uno falla y conserva el error', async () => {
    const exportOne = vi
      .fn()
      .mockRejectedValueOnce(new Error('disco lleno'))
      .mockResolvedValueOnce(result('Dos.mp4'));
    const outcomes = await runShortBatch(
      [candidate('a', 'Uno'), candidate('b', 'Dos')],
      { videoPath: 'video.mp4', outputDir: 'salida', smartReframe: false },
      exportOne,
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ ok: false, error: 'disco lleno' });
    expect(outcomes[1]).toMatchObject({ ok: true });
  });

  it('no llama al exportador si no hay candidatos', async () => {
    const exportOne = vi.fn();
    const outcomes = await runShortBatch(
      [],
      { videoPath: 'video.mp4', outputDir: 'salida', smartReframe: false },
      exportOne,
    );
    expect(outcomes).toEqual([]);
    expect(exportOne).not.toHaveBeenCalled();
  });
});
