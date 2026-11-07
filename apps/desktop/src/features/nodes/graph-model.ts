import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  addCaptionCue,
  addClipFromAsset,
  updateClip,
} from '../../state/project-actions';
import { createInstance, effectRegistry, type EffectStack } from '@editor-ia/effect-kit';
import type { ClipEffects } from '@editor-ia/project-schema';

/**
 * Grafo de procesamiento del editor de nodos.
 *
 * Modelo puro y ejecutable: los nodos son operaciones reales sobre el proyecto
 * (`project-actions`), no una maqueta. La ejecución es por orden topológico y
 * cada nodo recibe los clips que produjeron sus entradas, así una entrada puede
 * ramificar a varios efectos y cada rama termina en su propio clip.
 */

export type NodeKind = 'input' | 'effect' | 'audio-fx' | 'caption' | 'render';

export interface GraphNodeData {
  readonly kind: NodeKind;
  readonly label?: string | undefined;
  readonly assetId?: string | undefined;
  readonly atFrame?: number | undefined;
  readonly durationFrames?: number | undefined;
  readonly manifestId?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | undefined;
  readonly text?: string | undefined;
  readonly offsetFrames?: number | undefined;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly x: number;
  readonly y: number;
  readonly data: GraphNodeData;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface NodeGraph {
  readonly version: 1;
  readonly name: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface NodeResult {
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly clipIds: readonly string[];
  readonly note?: string;
}

export interface GraphRunResult {
  readonly project: ProjectDocument;
  readonly results: readonly NodeResult[];
  readonly renderRequested: boolean;
}

const KIND_LABEL: Record<NodeKind, string> = {
  input: 'Medio',
  effect: 'Efecto de video',
  'audio-fx': 'Efecto de audio',
  caption: 'Subtítulo',
  render: 'Render',
};

export function nodeKindLabel(kind: NodeKind): string {
  return KIND_LABEL[kind];
}

/** Orden de ejecución: DFS post-orden sobre las entradas de cada nodo. */
export function topoSort(graph: NodeGraph): GraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const inputsOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = inputsOf.get(edge.target) ?? [];
    list.push(edge.source);
    inputsOf.set(edge.target, list);
  }
  const order: GraphNode[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    const mark = state.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      throw new Error(`el grafo tiene un ciclo en el nodo «${id}»`);
    }
    const node = byId.get(id);
    if (!node) throw new Error(`el grafo referencia el nodo inexistente «${id}»`);
    state.set(id, 'visiting');
    for (const input of inputsOf.get(id) ?? []) visit(input);
    state.set(id, 'done');
    order.push(node);
  };
  for (const node of graph.nodes) visit(node.id);
  return order;
}

export function validateGraph(graph: NodeGraph): string[] {
  const problems: string[] = [];
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (graph.nodes.length === 0) problems.push('el grafo no tiene nodos');
  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) problems.push(`arista sin origen «${edge.source}»`);
    if (!ids.has(edge.target)) problems.push(`arista sin destino «${edge.target}»`);
    if (edge.source === edge.target) problems.push(`el nodo «${edge.source}» se conecta a sí mismo`);
  }
  try {
    topoSort(graph);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'ciclo en el grafo');
  }
  for (const node of graph.nodes) {
    if (node.kind === 'input' && !node.data.assetId) {
      problems.push(`el nodo «${node.data.label ?? node.id}» (medio) no tiene asset`);
    }
    if ((node.kind === 'effect' || node.kind === 'audio-fx') && !node.data.manifestId) {
      problems.push(`el nodo «${node.data.label ?? node.id}» no tiene efecto elegido`);
    }
    if (node.kind === 'caption' && !(node.data.text ?? '').trim()) {
      problems.push(`el nodo «${node.data.label ?? node.id}» (subtítulo) está vacío`);
    }
  }
  const hasRender = graph.nodes.some((node) => node.kind === 'render');
  if (hasRender && !graph.nodes.some((node) => node.kind === 'input')) {
    problems.push('un grafo con render necesita al menos un nodo de medio');
  }
  return problems;
}

function incomingClipIds(
  node: GraphNode,
  graph: NodeGraph,
  produced: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const sources = graph.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
  const ids: string[] = [];
  for (const source of sources) {
    for (const clipId of produced.get(source) ?? []) {
      if (!ids.includes(clipId)) ids.push(clipId);
    }
  }
  return ids;
}

function manifestFor(kind: 'effect' | 'audio-fx', manifestId: string | undefined) {
  if (!manifestId) return null;
  const manifest = effectRegistry.get(manifestId);
  if (!manifest) return null;
  const isAudio = Boolean(manifest.audio);
  return kind === 'audio-fx' ? (isAudio ? manifest : null) : isAudio ? null : manifest;
}

/**
 * Ejecuta el grafo sobre el proyecto. Devuelve un único `ProjectDocument`
 * nuevo (un solo paso de undo para toda la ejecución) más el resultado por
 * nodo. Lanza `GraphRunError` con el id del nodo que falló.
 */
export function executeGraph(
  graph: NodeGraph,
  project: ProjectDocument,
): GraphRunResult {
  const problems = validateGraph(graph);
  if (problems.length > 0) {
    throw new GraphRunError(`grafo inválido: ${problems.join(' · ')}`);
  }
  let next = project;
  const produced = new Map<string, readonly string[]>();
  const results: NodeResult[] = [];
  let renderRequested = false;

  for (const node of topoSort(graph)) {
    const incoming = incomingClipIds(node, graph, produced);
    try {
      switch (node.kind) {
        case 'input': {
          const asset = next.assets.find((item) => item.id === node.data.assetId);
          if (!asset) {
            throw new Error(`el asset «${node.data.assetId}» no está en el proyecto`);
          }
          const added = addClipFromAsset(next, asset, {
            atFrame: node.data.atFrame ?? 0,
            durationFrames: node.data.durationFrames ?? 90,
          });
          next = added.project;
          const clipId = added.clipId;
          produced.set(node.id, [clipId]);
          results.push({ nodeId: node.id, kind: node.kind, clipIds: [clipId] });
          break;
        }
        case 'effect':
        case 'audio-fx': {
          if (incoming.length === 0) {
            throw new Error('no recibe clips de ninguna entrada');
          }
          const manifest = manifestFor(node.kind, node.data.manifestId);
          if (!manifest) {
            throw new Error(`efecto desconocido «${node.data.manifestId}»`);
          }
          const instance = createInstance(manifest, {
            params: node.data.params ?? {},
          });
          const clipIds: string[] = [];
          for (const clipId of incoming) {
            next = next.timeline.clips.some((clip) => clip.id === clipId)
              ? applyInstance(next, clipId, node.kind, instance)
              : next;
            clipIds.push(clipId);
          }
          produced.set(node.id, clipIds);
          results.push({ nodeId: node.id, kind: node.kind, clipIds });
          break;
        }
        case 'caption': {
          const added = addCaptionCue(next, {
            text: node.data.text ?? '',
            startFrame: (node.data.atFrame ?? 0) + (node.data.offsetFrames ?? 0),
            ...(node.data.durationFrames !== undefined
              ? { durationFrames: node.data.durationFrames }
              : {}),
          });
          next = added.project;
          produced.set(node.id, []);
          results.push({
            nodeId: node.id,
            kind: node.kind,
            clipIds: [],
            note: `subtítulo «${added.cueId}» en frame ${added.startFrame}`,
          });
          break;
        }
        case 'render': {
          renderRequested = true;
          produced.set(node.id, []);
          results.push({ nodeId: node.id, kind: node.kind, clipIds: [] });
          break;
        }
      }
    } catch (error) {
      throw new GraphRunError(
        `nodo «${node.data.label ?? nodeKindLabel(node.kind)}» falló: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
        node.id,
      );
    }
  }
  return { project: next, results, renderRequested };
}

function applyInstance(
  project: ProjectDocument,
  clipId: string,
  kind: 'effect' | 'audio-fx',
  instance: ReturnType<typeof createInstance>,
): ProjectDocument {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return project;
  if (
    clip.kind !== 'video' &&
    clip.kind !== 'image' &&
    clip.kind !== 'freeze' &&
    clip.kind !== 'adjustment'
  ) {
    throw new Error(`el clip «${clip.label ?? clipId}» no acepta efectos (${clip.kind})`);
  }
  const currentEffects = (clip as { effects?: ClipEffects }).effects ?? {};
  const effects = currentEffects as ClipEffects;
  const stackKey = kind === 'audio-fx' ? 'audioStack' : 'stack';
  const current = ((effects as Record<string, unknown>)[stackKey] ?? []) as EffectStack;
  const merged: ClipEffects = {
    ...effects,
    [stackKey]: [...current, instance],
  };
  return updateClip(project, clipId, { effects: merged });
}

export class GraphRunError extends Error {
  readonly nodeId: string | undefined;
  constructor(message: string, nodeId?: string) {
    super(message);
    this.name = 'GraphRunError';
    this.nodeId = nodeId;
  }
}

export function emptyGraph(name = 'Grafo'): NodeGraph {
  return { version: 1, name, nodes: [], edges: [] };
}

export function graphFromJson(raw: string): NodeGraph {
  const parsed = JSON.parse(raw) as NodeGraph;
  if (parsed.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('el archivo de grafo no tiene el formato esperado (version 1)');
  }
  return parsed;
}
