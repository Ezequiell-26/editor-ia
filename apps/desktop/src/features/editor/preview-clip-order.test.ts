import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Clip,
  type ProjectDocument,
  type Track,
} from '@editor-ia/project-schema';
import { comparePreviewClips } from './preview-clip-order';

function track(id: string, order: number): Track {
  return {
    id,
    kind: 'video',
    label: `Pista ${id}`,
    order,
    muted: false,
    hidden: false,
    locked: false,
  } as Track;
}

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 0,
    durationFrames: 30,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 30 },
    ...partial,
  } as Clip;
}

function projectWith(clips: Clip[], tracks: Track[]): ProjectDocument {
  const base = createEmptyProject('Orden', '2026-01-01T00:00:00.000Z');
  return { ...base, timeline: { tracks, clips } } as ProjectDocument;
}

describe('comparePreviewClips', () => {
  it('ordena por orden de pista igual que el render', () => {
    const project = projectWith([], [track('v1', 0), track('v2', 1)]);
    const abajo = clip({ id: 'abajo', trackId: 'v1', startFrame: 500 });
    const arriba = clip({ id: 'arriba', trackId: 'v2', startFrame: 0 });
    expect(comparePreviewClips(abajo, arriba, project)).toBeLessThan(0);
    expect(comparePreviewClips(arriba, abajo, project)).toBeGreaterThan(0);
  });

  it('a igual orden de pista el clip que empieza después queda encima', () => {
    // Solape de transición en la misma pista: el saliente termina en 160 y
    // el entrante monta su lead desde el frame 130. El render ordena por
    // startFrame y dibuja el entrante encima; la preview debe hacer lo mismo
    // aunque el array del proyecto los liste al revés.
    const project = projectWith([], [track('v1', 0)]);
    const saliente = clip({ id: 'saliente', startFrame: 100, durationFrames: 60 });
    const entrante = clip({ id: 'entrante', startFrame: 160, durationFrames: 60 });
    expect(comparePreviewClips(saliente, entrante, project)).toBeLessThan(0);
    expect(comparePreviewClips(entrante, saliente, project)).toBeGreaterThan(0);
    const desordenado = [entrante, saliente].sort((a, b) => comparePreviewClips(a, b, project));
    expect(desordenado.map((c) => c.id)).toEqual(['saliente', 'entrante']);
  });

  it('pista inexistente cuenta como orden 0, como en ffmpeg.rs', () => {
    const project = projectWith([], [track('v1', 5)]);
    const huerfano = clip({ id: 'huerfano', trackId: 'no-existe', startFrame: 0 });
    const real = clip({ id: 'real', trackId: 'v1', startFrame: 0 });
    expect(comparePreviewClips(huerfano, real, project)).toBeLessThan(0);
  });

  it('empates exactos devuelven 0 y el sort estable conserva el orden', () => {
    const project = projectWith([], [track('v1', 0)]);
    const a = clip({ id: 'a', startFrame: 10 });
    const b = clip({ id: 'b', startFrame: 10 });
    expect(comparePreviewClips(a, b, project)).toBe(0);
    const ordenado = [b, a].sort((x, y) => comparePreviewClips(x, y, project));
    expect(ordenado.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
