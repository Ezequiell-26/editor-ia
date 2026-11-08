import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './nodes.css';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { effectRegistry, ALL_EFFECTS } from '@editor-ia/effect-kit';
import type { ViewId } from '../../app/navigation';
import { useProjectStore } from '../../state/project-store';
import { Icon, type IconName } from '../../components/Icon';
import { buildProjectMotionPlans } from '../motion/plan';
import {
  GraphRunError,
  emptyGraph,
  executeGraph,
  graphFromJson,
  nodeKindLabel,
  validateGraph,
  type GraphNode,
  type GraphNodeData,
  type NodeGraph,
  type NodeKind,
} from './graph-model';
import { readStoredGraphs, upsertStoredGraph, type StoredGraph } from './graph-store';

export interface NodeGraphViewProps {
  readonly onNavigate: (view: ViewId) => void;
}

type FlowNodeData = GraphNodeData & { readonly summary?: string } & Record<string, unknown>;
type FlowNode = Node<FlowNodeData, 'graph'>;

const KIND_ICON: Record<NodeKind, IconName> = {
  input: 'film',
  effect: 'sparkles',
  'audio-fx': 'audio',
  caption: 'captions',
  render: 'download',
};

function toFlowNodes(graph: NodeGraph): FlowNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'graph',
    position: { x: node.x, y: node.y },
    data: { ...node.data, summary: summarize(node.data) },
  }));
}

function summarize(data: GraphNodeData): string {
  switch (data.kind) {
    case 'input':
      return data.assetId ? `asset ${data.assetId.slice(0, 8)}…` : 'sin asset';
    case 'effect':
    case 'audio-fx': {
      const manifest = data.manifestId ? effectRegistry.get(data.manifestId) : undefined;
      return manifest?.name ?? 'sin efecto';
    }
    case 'caption':
      return data.text ? `«${data.text.slice(0, 24)}${data.text.length > 24 ? '…' : ''}»` : 'vacío';
    case 'render':
      return 'exporta el proyecto';
  }
}

function GraphNodeCard({ data }: NodeProps<FlowNode>): JSX.Element {
  return (
    <div className={`node-card node-${data.kind}`}>
      {(data.kind === 'effect' || data.kind === 'audio-fx' || data.kind === 'caption') && (
        <Handle type="target" position={Position.Left} />
      )}
      {(data.kind === 'input' || data.kind === 'effect' || data.kind === 'audio-fx') && (
        <Handle type="source" position={Position.Right} />
      )}
      <div className="node-card-head">
        <Icon name={KIND_ICON[data.kind]} size={15} />
        <strong>{nodeKindLabel(data.kind)}</strong>
      </div>
      <span className="node-card-summary">{data.summary ?? ''}</span>
      {data.kind === 'render' && <Handle type="target" position={Position.Left} />}
    </div>
  );
}

const nodeTypes = { graph: GraphNodeCard };

let nodeCounter = 0;
function nextNodeId(): string {
  nodeCounter += 1;
  return `n${Date.now().toString(36)}${nodeCounter.toString(36)}`;
}

export function NodeGraphView({ onNavigate }: NodeGraphViewProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const opened = store.state.opened;
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [graphName, setGraphName] = useState('Grafo');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const graph = useMemo<NodeGraph>(
    () => ({
      version: 1,
      name: graphName,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: (node.data.kind ?? 'input') as NodeKind,
        x: node.position.x,
        y: node.position.y,
        data: {
          kind: (node.data.kind ?? 'input') as NodeKind,
          label: node.data.label,
          assetId: node.data.assetId,
          atFrame: node.data.atFrame,
          durationFrames: node.data.durationFrames,
          manifestId: node.data.manifestId,
          params: node.data.params,
          text: node.data.text,
          offsetFrames: node.data.offsetFrames,
        },
      })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    }),
    [nodes, edges, graphName],
  );

  /** Aplica un grafo parseado al lienzo y deja el nombre visible en sync. */
  const applyGraph = useCallback((parsed: NodeGraph, source: string) => {
    setNodes(toFlowNodes(parsed));
    setEdges(
      parsed.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: true,
      })),
    );
    setGraphName(parsed.name);
    setSelectedId(null);
    setNotice(`Grafo «${parsed.name}» ${source}`);
  }, [setEdges, setNodes]);

  // Auto-carga al abrir la vista con proyecto: primero el documento
  // (`x-nodeGraphs`, lo último guardado) y, si no hay, el legado
  // `<proyecto>/graphs/*.json` para no perder grafos de versiones anteriores.
  const autoLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = project?.id ?? opened?.root ?? null;
    if (!key || nodes.length > 0 || autoLoadedFor.current === key) return;
    autoLoadedFor.current = key;

    const stored = readStoredGraphs(project);
    const latest = stored[stored.length - 1];
    if (latest) {
      applyGraph(latest.graph, 'restaurado del proyecto');
      return;
    }
    if (!opened) return;

    const dir = `${opened.root}\\graphs`;
    void (async () => {
      try {
        const listing = await store.service.listDirectory(dir);
        const files = listing.entries
          .filter((e) => e.kind === 'text' || e.name.endsWith('.json'))
          .filter((e) => e.name.endsWith('.json'))
          .sort((a, b) => b.name.localeCompare(a.name));
        const file = files[0];
        if (!file) return;
        const content = await store.service.readTextFile(file.path);
        applyGraph(graphFromJson(content.content), 'restaurado desde graphs/');
      } catch {
        // Sin carpeta graphs/ o archivo ilegible: se empieza con grafo vacío.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, opened, store.service]);

  const problems = useMemo(() => validateGraph(graph), [graph]);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNodeData>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...patch, summary: summarize({ ...node.data, ...patch } as GraphNodeData) } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const addNode = useCallback(
    (kind: NodeKind) => {
      const id = nextNodeId();
      const offset = nodes.length * 24;
      setNodes((current) => [
        ...current,
        {
          id,
          type: 'graph',
          position: { x: 80 + offset, y: 80 + offset },
          data: { kind, label: nodeKindLabel(kind), summary: summarize({ kind }) },
        },
      ]);
      setSelectedId(id);
    },
    [nodes.length, setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, animated: true }, current).slice(-64),
      );
    },
    [setEdges],
  );

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
    );
    setSelectedId(null);
  }, [selectedId, setEdges, setNodes]);

  /**
   * Guarda el grafo DENTRO del documento del proyecto (`x-nodeGraphs`), no en
   * un archivo suelto: viaja con el `.editoria.json` y lo restauran todas las
   * versiones de la app (las claves x-* se conservan al re-guardar).
   */
  const saveGraph = useCallback(async () => {
    if (!project) {
      setError('Abrí un proyecto para guardar el grafo dentro del documento.');
      return;
    }
    const name = graphName.trim() || 'Grafo';
    const entry: StoredGraph = {
      name,
      updatedAt: new Date().toISOString(),
      graph: { ...graph, name },
    };
    const applied = store.update(
      (doc) => upsertStoredGraph(doc, entry),
      { history: false },
    );
    if (!applied) {
      setError('El store rechazó el guardado del grafo.');
      return;
    }
    setError(null);
    // `stateRef` se actualiza de forma síncrona en `update`: `saveNow` ya ve
    // el grafo recién guardado sin ceder un tick al render.
    const saved = await store.saveNow();
    setNotice(
      saved
        ? `Grafo «${name}» guardado en el proyecto.`
        : `Grafo «${name}» actualizado; se escribirá con el autoguardado.`,
    );
  }, [graph, graphName, project, store]);

  const loadStoredGraph = useCallback(
    (entry: StoredGraph) => {
      applyGraph(entry.graph, 'cargado del proyecto');
      setError(null);
    },
    [applyGraph],
  );

  const loadGraph = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        applyGraph(graphFromJson(text), 'cargado desde archivo');
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'no se pudo leer el grafo');
      }
    },
    [applyGraph],
  );

  const runGraph = useCallback(async () => {
    if (!project) {
      setError('Abrí un proyecto antes de ejecutar el grafo.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = executeGraph(graph, project);
      const applied = store.update(() => result.project);
      if (!applied) {
        setError('El store rechazó la actualización del proyecto.');
        return;
      }
      const clipCount = result.results.reduce((sum, item) => sum + item.clipIds.length, 0);
      let message = `Grafo ejecutado: ${result.results.length} nodos, ${clipCount} clips en la timeline.`;
      if (result.renderRequested) {
        // `stateRef` refleja el `update` de forma síncrona: `saveNow` guarda
        // (y el render usa) el documento que ya incluye el grafo.
        const saved = await store.saveNow();
        if (!saved) {
          setError('El grafo editó el proyecto pero no se pudo guardar para renderizar.');
          return;
        }
        const profile = result.project.renderProfiles[0];
        const motionBundle = buildProjectMotionPlans(result.project);
        if (motionBundle.errors.length > 0) throw new Error(motionBundle.errors[0]);
        const started = await store.service.startRender(
          profile?.id ?? null,
          true,
          motionBundle.plans,
          null,
          undefined,
        );
        message += started ? ' Render iniciado.' : ' No se pudo iniciar el render.';
      }
      setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof GraphRunError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'el grafo falló',
      );
    } finally {
      setBusy(false);
    }
  }, [graph, project, store]);

  const videoEffects = useMemo(
    () => ALL_EFFECTS.filter((manifest) => !manifest.audio),
    [],
  );
  const audioEffects = useMemo(() => ALL_EFFECTS.filter((manifest) => manifest.audio), []);
  const assets = useMemo(
    () =>
      (project?.assets ?? []).filter(
        (asset) => asset.status === 'ready' && ['video', 'image', 'audio'].includes(asset.kind),
      ),
    [project],
  );

  // Grafos persistidos dentro del documento del proyecto (x-nodeGraphs).
  const storedGraphs = useMemo(() => readStoredGraphs(project), [project]);
  const storedNames = useMemo(() => new Set(storedGraphs.map((g) => g.name)), [storedGraphs]);

  return (
    <section className="nodes-view" aria-label="Editor de nodos">
      <header className="view-head">
        <div>
          <h1>Nodos</h1>
          <p>
            Grafo de procesamiento real: cada nodo ejecuta una operación del motor
            (clip, efecto, audio, subtítulo, render) sobre el proyecto abierto.
          </p>
        </div>
        <div className="actions compact">
          <button type="button" className="small" onClick={() => addNode('input')}>
            + Medio
          </button>
          <button type="button" className="small" onClick={() => addNode('effect')}>
            + Efecto
          </button>
          <button type="button" className="small" onClick={() => addNode('audio-fx')}>
            + Audio
          </button>
          <button type="button" className="small" onClick={() => addNode('caption')}>
            + Subtítulo
          </button>
          <button type="button" className="small" onClick={() => addNode('render')}>
            + Render
          </button>
          <button type="button" className="small" onClick={() => void saveGraph()}>
            Guardar
          </button>
          <button
            type="button"
            className="small"
            onClick={() => fileRef.current?.click()}
          >
            Cargar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadGraph(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="primary small"
            disabled={busy || problems.length > 0 || !project}
            onClick={() => void runGraph()}
          >
            {busy ? 'Ejecutando…' : 'Ejecutar grafo'}
          </button>
        </div>
      </header>

      <div className="nodes-graph-bar">
        <label className="field nodes-graph-name">
          <span>Nombre del grafo</span>
          <input
            value={graphName}
            placeholder="Grafo"
            onChange={(event) => setGraphName(event.target.value)}
          />
        </label>
        {storedGraphs.length > 1 ? (
          <label className="field nodes-graph-pick">
            <span>Guardados en el proyecto</span>
            <select
              value={storedNames.has(graphName) ? graphName : ''}
              onChange={(event) => {
                const entry = storedGraphs.find((item) => item.name === event.target.value);
                if (entry) loadStoredGraph(entry);
              }}
            >
              {!storedNames.has(graphName) ? (
                <option value="">{graphName.trim() || 'Grafo'} (sin guardar)</option>
              ) : null}
              {storedGraphs.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} · {entry.updatedAt.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul className="fine-print nodes-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {!project ? (
        <p className="fine-print">
          Abrí un proyecto para ejecutar grafos; los nodos de medio listan sus assets.
        </p>
      ) : null}

      <div className="nodes-layout">
        <div className="nodes-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              const removed = changes.find((change) => change.type === 'remove');
              if (removed) {
                const id = (removed as { id: string }).id;
                setEdges((current) =>
                  current.filter((edge) => edge.source !== id && edge.target !== id),
                );
              }
            }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            deleteKeyCode="Delete"
          >
            <Background gap={24} />
            <Controls />
          </ReactFlow>
        </div>

        <aside className="nodes-inspector card" aria-label="Configuración del nodo">
          {selected ? (
            <NodeInspector
              node={selected}
              project={project}
              assets={assets}
              videoEffects={videoEffects}
              audioEffects={audioEffects}
              onPatch={(patch) => patchNode(selected.id, patch)}
              onDelete={removeSelected}
            />
          ) : (
            <p className="fine-print">
              Seleccioná un nodo para configurarlo. Los nodos de efecto y audio se
              aplican en el orden en que llegan los clips por las conexiones.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

interface InspectorProps {
  readonly node: FlowNode;
  readonly project: ProjectDocument | null;
  readonly assets: readonly { id: string; label: string; kind: string }[];
  readonly videoEffects: readonly { id: string; name: string }[];
  readonly audioEffects: readonly { id: string; name: string }[];
  readonly onPatch: (patch: Partial<FlowNodeData>) => void;
  readonly onDelete: () => void;
}

function NodeInspector({
  node,
  project,
  assets,
  videoEffects,
  audioEffects,
  onPatch,
  onDelete,
}: InspectorProps) {
  const data = node.data;
  const manifest = data.manifestId ? effectRegistry.get(data.manifestId) : undefined;
  return (
    <div>
      <p className="eyebrow">{nodeKindLabel(data.kind)}</p>
      <label className="field">
        <span>Nombre</span>
        <input
          value={data.label ?? ''}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </label>

      {data.kind === 'input' ? (
        <>
          <label className="field">
            <span>Asset del proyecto</span>
            <select
              value={data.assetId ?? ''}
              onChange={(event) => onPatch({ assetId: event.target.value || undefined })}
            >
              <option value="">Elegir…</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label} ({asset.kind})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Frame inicial</span>
            <input
              type="number"
              min={0}
              value={data.atFrame ?? 0}
              onChange={(event) => onPatch({ atFrame: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
          <label className="field">
            <span>Duración (frames)</span>
            <input
              type="number"
              min={1}
              value={data.durationFrames ?? 90}
              onChange={(event) =>
                onPatch({ durationFrames: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </label>
        </>
      ) : null}

      {data.kind === 'effect' || data.kind === 'audio-fx' ? (
        <>
          <label className="field">
            <span>Efecto</span>
            <select
              value={data.manifestId ?? ''}
              onChange={(event) => onPatch({ manifestId: event.target.value || undefined })}
            >
              <option value="">Elegir…</option>
              {(data.kind === 'effect' ? videoEffects : audioEffects).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {manifest
            ? manifest.params.map((spec) => (
                <ParamInput
                  key={spec.id}
                  spec={spec}
                  value={(data.params ?? {})[spec.id]}
                  onChange={(value) =>
                    onPatch({ params: { ...(data.params ?? {}), [spec.id]: value } })
                  }
                />
              ))
            : null}
        </>
      ) : null}

      {data.kind === 'caption' ? (
        <>
          <label className="field">
            <span>Texto</span>
            <textarea
              rows={3}
              value={data.text ?? ''}
              onChange={(event) => onPatch({ text: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Frame inicial</span>
            <input
              type="number"
              min={0}
              value={data.atFrame ?? 0}
              onChange={(event) => onPatch({ atFrame: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
          <label className="field">
            <span>Duración (frames)</span>
            <input
              type="number"
              min={1}
              value={data.durationFrames ?? 90}
              onChange={(event) =>
                onPatch({ durationFrames: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </label>
        </>
      ) : null}

      {data.kind === 'render' ? (
        <p className="fine-print">
          Al ejecutar, el grafo guarda el proyecto y arranca el render con el
          primer perfil de exportación{project ? ` («${project.renderProfiles[0]?.name ?? 'perfil'}»)` : ''}.
        </p>
      ) : null}

      <div className="actions compact">
        <button type="button" className="small danger" onClick={onDelete}>
          Eliminar nodo
        </button>
      </div>
    </div>
  );
}

interface ParamInputProps {
  readonly spec: {
    readonly id: string;
    readonly label: string;
    readonly type: string;
    readonly min?: number;
    readonly max?: number;
    readonly default?: unknown;
    readonly options?: readonly string[];
    readonly unit?: string;
  };
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}

function ParamInput({ spec, value, onChange }: ParamInputProps) {
  const current = value ?? spec.default;
  if (spec.type === 'bool') {
    return (
      <label className="field compact-field">
        <span>
          {spec.label}
          {spec.unit ? ` (${spec.unit})` : ''}
        </span>
        <input
          type="checkbox"
          checked={Boolean(current)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  if (spec.type === 'enum') {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select
          value={String(current ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (spec.type === 'color') {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <input
          type="color"
          value={String(current ?? '#000000')}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  return (
    <label className="field">
      <span>
        {spec.label}
        {spec.unit ? ` (${spec.unit})` : ''}
      </span>
      <input
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.type === 'int' ? 1 : 'any'}
        value={typeof current === 'number' ? current : Number(current ?? 0)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
