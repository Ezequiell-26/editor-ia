import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import {
  emptyGraph,
  executeGraph,
  graphFromJson,
  topoSort,
  validateGraph,
  type GraphNode,
  type NodeGraph,
} from './graph-model';
import { VIDEO_EFFECTS, AUDIO_EFFECTS } from '@editor-ia/effect-kit';

const NOW = '2026-11-06T00:00:00.000Z';

function projectWithAsset() {
  const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
  return { project: ensureDelivery(addAsset(createEmptyProject('Grafo', NOW), asset)), asset };
}

function node(
  id: string,
  kind: GraphNode['kind'],
  data: Omit<GraphNode['data'], 'kind'>,
  x = 0,
  y = 0,
): GraphNode {
  return { id, kind, x, y, data: { kind, ...data } };
}

describe('grafo de nodos', () => {
  it('ordena topológicamente y rechaza ciclos', () => {
    const graph: NodeGraph = {
      version: 1,
      name: 'g',
      nodes: [
        node('a', 'input', { assetId: 'x' }),
        node('b', 'effect', { manifestId: 'vfx.blur' }),
        node('c', 'render', {}),
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    };
    expect(topoSort(graph).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    const cyclic: NodeGraph = {
      ...graph,
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    };
    expect(() => topoSort(cyclic)).toThrow(/ciclo/);
    expect(validateGraph(cyclic).join(' ')).toMatch(/ciclo/);
  });

  it('valida nodos incompletos y grafos sin medio', () => {
    const graph: NodeGraph = {
      version: 1,
      name: 'solo render',
      nodes: [node('r', 'render', {})],
      edges: [],
    };
    const problems = validateGraph(graph);
    expect(problems.join(' ')).toMatch(/necesita al menos un nodo de medio/);
  });

  it('ejecuta input→effect→render y aplica el efecto al clip real', () => {
    const { project, asset } = projectWithAsset();
    const fx = VIDEO_EFFECTS[0]!;
    const graph: NodeGraph = {
      version: 1,
      name: 'demo',
      nodes: [
        node('in', 'input', { assetId: asset.id, atFrame: 0, durationFrames: 60 }),
        node('fx', 'effect', { manifestId: fx.id }),
        node('cap', 'caption', { text: 'Hola nodos', atFrame: 0, durationFrames: 30 }),
        node('out', 'render', {}),
      ],
      edges: [
        { id: 'e1', source: 'in', target: 'fx' },
        { id: 'e2', source: 'fx', target: 'out' },
      ],
    };
    const result = executeGraph(graph, project);
    expect(result.renderRequested).toBe(true);
    const clip = result.project.timeline.clips.find((item) =>
      result.results[0]!.clipIds.includes(item.id),
    );
    expect(clip).toBeTruthy();
    const clipEffects =
      clip && 'effects' in clip
        ? (clip.effects as { stack?: { effectId: string }[] } | undefined)
        : undefined;
    const stack = clipEffects?.stack ?? [];
    expect(stack).toHaveLength(1);
    expect(stack[0]!.effectId).toBe(fx.id);
    expect(result.project.captions.cues.some((cue) => cue.text === 'Hola nodos')).toBe(true);
  });

  it('aplica efectos de audio al audioStack, no al stack de video', () => {
    const { project, asset } = projectWithAsset();
    const fx = AUDIO_EFFECTS[0]!;
    const graph: NodeGraph = {
      version: 1,
      name: 'audio',
      nodes: [
        node('in', 'input', { assetId: asset.id }),
        node('afx', 'audio-fx', { manifestId: fx.id }),
      ],
      edges: [{ id: 'e1', source: 'in', target: 'afx' }],
    };
    const result = executeGraph(graph, project);
    const clipId = result.results[0]!.clipIds[0]!;
    const clip = result.project.timeline.clips.find((item) => item.id === clipId)!;
    const clipEffects =
      'effects' in clip
        ? (clip.effects as { stack?: unknown[]; audioStack?: unknown[] } | undefined)
        : undefined;
    expect(clipEffects?.audioStack ?? []).toHaveLength(1);
    expect(clipEffects?.stack ?? []).toHaveLength(0);
  });

  it('rechaza un efecto de video en un nodo de audio', () => {
    const { project, asset } = projectWithAsset();
    const videoFx = VIDEO_EFFECTS[0]!;
    const graph: NodeGraph = {
      version: 1,
      name: 'mal',
      nodes: [
        node('in', 'input', { assetId: asset.id }),
        node('afx', 'audio-fx', { manifestId: videoFx.id }),
      ],
      edges: [{ id: 'e1', source: 'in', target: 'afx' }],
    };
    expect(() => executeGraph(graph, project)).toThrow(/audio-fx.*falló|efecto desconocido/);
  });

  it('serializa y parsea el grafo', () => {
    const graph: NodeGraph = {
      version: 1,
      name: 'roundtrip',
      nodes: [node('a', 'input', { assetId: 'x' })],
      edges: [],
    };
    expect(graphFromJson(JSON.stringify(graph))).toEqual(graph);
    expect(() => graphFromJson('{"version":2}')).toThrow(/formato/);
  });
});
