import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { GRAPH_DOC_KEY, readStoredGraphs, upsertStoredGraph } from './graph-store';
import { emptyGraph, type NodeGraph } from './graph-model';

function sampleGraph(name: string): NodeGraph {
  return {
    ...emptyGraph(name),
    nodes: [
      {
        id: 'n1',
        kind: 'input',
        x: 10,
        y: 20,
        data: { kind: 'input', assetId: 'a1', atFrame: 0, durationFrames: 90 },
      },
    ],
    edges: [],
  };
}

describe('graph-store · grafos dentro del documento del proyecto', () => {
  it('proyecto vacío no tiene grafos guardados', () => {
    expect(readStoredGraphs(createEmptyProject('Obra'))).toEqual([]);
  });

  it('upsert guarda y recupera el grafo bajo x-nodeGraphs', () => {
    const project = createEmptyProject('Obra');
    const entry = {
      name: 'Intro vertical',
      updatedAt: '2026-11-07T12:00:00.000Z',
      graph: sampleGraph('Intro vertical'),
    };

    const saved = upsertStoredGraph(project, entry);

    expect(saved[GRAPH_DOC_KEY]).toBeDefined();
    const read = readStoredGraphs(saved);
    expect(read).toHaveLength(1);
    expect(read[0]?.name).toBe('Intro vertical');
    expect(read[0]?.graph.nodes[0]?.id).toBe('n1');
    // El documento original no se mutó.
    expect(project[GRAPH_DOC_KEY]).toBeUndefined();
  });

  it('guardar con el mismo nombre reemplaza la entrada, no duplica', () => {
    let project = createEmptyProject('Obra');
    project = upsertStoredGraph(project, {
      name: 'Grafo',
      updatedAt: '2026-11-07T10:00:00.000Z',
      graph: sampleGraph('Grafo'),
    });
    project = upsertStoredGraph(project, {
      name: 'Grafo',
      updatedAt: '2026-11-07T11:00:00.000Z',
      graph: { ...sampleGraph('Grafo'), nodes: [] },
    });

    const read = readStoredGraphs(project);
    expect(read).toHaveLength(1);
    expect(read[0]?.updatedAt).toBe('2026-11-07T11:00:00.000Z');
    expect(read[0]?.graph.nodes).toHaveLength(0);
  });

  it('varios grafos conviven y se leen en orden de guardado', () => {
    let project = createEmptyProject('Obra');
    project = upsertStoredGraph(project, {
      name: 'A',
      updatedAt: '2026-11-07T10:00:00.000Z',
      graph: sampleGraph('A'),
    });
    project = upsertStoredGraph(project, {
      name: 'B',
      updatedAt: '2026-11-07T11:00:00.000Z',
      graph: sampleGraph('B'),
    });

    expect(readStoredGraphs(project).map((g) => g.name)).toEqual(['A', 'B']);
  });

  it('entradas corruptas se descartan sin romper la lectura', () => {
    const project = createEmptyProject('Obra');
    (project as Record<string, unknown>)[GRAPH_DOC_KEY] = [
      { name: 'ok', updatedAt: '2026-11-07T10:00:00.000Z', graph: sampleGraph('ok') },
      { name: '', updatedAt: 'x', graph: sampleGraph('mal') },
      { name: 'sin-grafo', updatedAt: 'x' },
      'basura',
      null,
    ];

    const read = readStoredGraphs(project);
    expect(read).toHaveLength(1);
    expect(read[0]?.name).toBe('ok');
  });

  it('la clave no es un root key conocido: viaja por el namespace x-', () => {
    // El formato admite x-* justamente para campos aditivos: si GRAPH_DOC_KEY
    // dejara de empezar con 'x-' el documento sería inválido al re-guardar.
    expect(GRAPH_DOC_KEY.startsWith('x-')).toBe(true);
  });

  it('el documento con grafos guardados sigue siendo un proyecto válido', () => {
    // Contrato real: `store.update` corre `parseProject` sobre el resultado;
    // si la entrada tuviera `undefined` u otro no-JSON, el guardado fallaría.
    let project = createEmptyProject('Obra');
    project = upsertStoredGraph(project, {
      name: 'Con undefined',
      updatedAt: '2026-11-07T12:00:00.000Z',
      graph: {
        version: 1,
        name: 'Con undefined',
        nodes: [
          {
            id: 'n1',
            kind: 'input',
            x: 0,
            y: 0,
            data: {
              kind: 'input',
              label: undefined,
              assetId: undefined,
              manifestId: undefined,
              params: undefined,
            },
          },
        ],
        edges: [],
      },
    });

    const parsed = parseProject(project);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(readStoredGraphs(parsed.project)).toHaveLength(1);
    }
  });
});
