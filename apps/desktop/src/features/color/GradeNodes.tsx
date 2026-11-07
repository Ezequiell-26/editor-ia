import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
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
import {
  COLOR_GRADE_OUTPUT_ID,
  COLOR_GRADE_SOURCE_ID,
  MAX_COLOR_LINKS,
  MAX_COLOR_NODES,
  createNeutralLayer,
  type ColorGrade,
  type ColorNode,
  type ColorNodeKind,
} from '@editor-ia/project-schema';

/**
 * Visual Color node editor. The graph IS the processing order: `compileGrade`
 * walks these links, so reconnecting a node genuinely changes the output, not
 * just the drawing. Serial nodes chain; nodes feeding the same target are
 * parallel branches blended by their mix.
 */

const CANVAS_W = 620;
const CANVAS_H = 190;

interface GradeNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: ColorNodeKind;
  readonly enabled: boolean;
  readonly mix: number;
  readonly active: boolean;
  readonly summary: string;
  readonly onToggle: (id: string) => void;
  readonly onRename: (id: string, label: string) => void;
}

type FlowNode = Node<GradeNodeData, 'grade'>;

function GradeNodeCard({ id, data }: NodeProps<FlowNode>): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  return (
    <div
      className={`cg-node cg-node-${data.kind}${data.enabled ? '' : ' disabled'}${data.active ? ' active' : ''}`}
      title={data.summary}
    >
      <Handle type="target" position={Position.Left} className="cg-node-handle" />
      <div className="cg-node-top">
        {editing ? (
          <input
            className="cg-node-input"
            autoFocus
            value={draft}
            aria-label="Nombre del nodo"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { setEditing(false); data.onRename(id, draft.trim() || data.label); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { setEditing(false); data.onRename(id, draft.trim() || data.label); }
              if (event.key === 'Escape') { setEditing(false); setDraft(data.label); }
            }}
          />
        ) : (
          <button type="button" className="cg-node-label" onDoubleClick={() => setEditing(true)}
            title="Doble clic para renombrar">{data.label}</button>
        )}
        <button
          type="button"
          className="cg-node-power"
          aria-label={data.enabled ? 'Desactivar nodo' : 'Activar nodo'}
          aria-pressed={data.enabled}
          onClick={() => data.onToggle(id)}
        >
          {data.enabled ? '●' : '○'}
        </button>
      </div>
      <div className="cg-node-meta">
        <span>{data.kind === 'source' ? 'IN' : data.kind === 'output' ? 'OUT' : data.kind === 'parallel' ? 'PAR' : 'SER'}</span>
        <span>{Math.round(data.mix * 100)}%</span>
      </div>
      <Handle type="source" position={Position.Right} className="cg-node-handle" />
    </div>
  );
}

const NODE_TYPES = { grade: GradeNodeCard };

function toFlow(grade: ColorGrade, activeNodeId: string | undefined, handlers: Pick<GradeNodeData, 'onToggle' | 'onRename'>): FlowNode[] {
  return grade.nodes.map((node) => ({
    id: node.id,
    type: 'grade' as const,
    position: { x: node.x * CANVAS_W, y: node.y * CANVAS_H },
    data: {
      label: node.label,
      kind: node.kind,
      enabled: node.enabled,
      mix: node.layer.mix,
      active: node.id === activeNodeId,
      summary: nodeSummary(grade, node),
      ...handlers,
    },
    draggable: true,
  }));
}

function nodeSummary(_grade: ColorGrade, node: ColorNode): string {
  if (node.kind === 'source' || node.kind === 'output') return 'Terminal del grafo';
  const p = node.layer.primaries;
  return `L ${p.lift.r.toFixed(2)} · G ${p.gamma.g.toFixed(2)} · contraste ${p.contrast.toFixed(2)} · sat ${p.saturation.toFixed(2)}`;
}

export function GradeNodes({
  grade, onChange, activeNodeId, onSelectNode,
}: {
  readonly grade: ColorGrade;
  readonly onChange: (next: ColorGrade) => void;
  readonly activeNodeId: string | undefined;
  readonly onSelectNode: (id: string) => void;
}) {
  const onToggle = useCallback((id: string) => {
    onChange({
      ...grade,
      nodes: grade.nodes.map((node) => (node.id === id ? { ...node, enabled: !node.enabled } : node)),
    });
  }, [grade, onChange]);
  const onRename = useCallback((id: string, label: string) => {
    onChange({
      ...grade,
      nodes: grade.nodes.map((node) => (node.id === id ? { ...node, label } : node)),
    });
  }, [grade, onChange]);
  const handlers = useMemo(() => ({ onToggle, onRename }), [onToggle, onRename]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(toFlow(grade, activeNodeId, handlers));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    grade.links.map((link) => ({
      id: link.id,
      source: link.from,
      target: link.to,
      animated: true,
      className: 'cg-node-edge',
    })),
  );

  // Re-sync only on structural changes (not on every position drag), so undo,
  // paste and preset loads are reflected without fighting the user's drag.
  const signature = useMemo(
    () => grade.nodes.map((n) => `${n.id}:${n.label}:${n.enabled}:${n.kind}:${n.layer.mix}`).join('|') +
      '#' + grade.links.map((l) => `${l.from}>${l.to}`).join('|') + '#' + (activeNodeId ?? ''),
    [grade.nodes, grade.links, activeNodeId],
  );
  useEffect(() => {
    setNodes(toFlow(grade, activeNodeId, handlers));
    setEdges(grade.links.map((link) => ({
      id: link.id, source: link.from, target: link.to, animated: true, className: 'cg-node-edge',
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const persist = (nextNodes: FlowNode[], nextEdges: Edge[]) => {
    const flowMap = new Map(nextNodes.map((node) => [node.id, node]));
    onChange({
      ...grade,
      nodes: grade.nodes.map((original) => {
        const flow = flowMap.get(original.id);
        return flow
          ? {
              ...original,
              x: Math.min(1, Math.max(0, flow.position.x / CANVAS_W)),
              y: Math.min(1, Math.max(0, flow.position.y / CANVAS_H)),
            }
          : original;
      }),
      links: nextEdges.slice(0, MAX_COLOR_LINKS).map((edge) => ({
        id: edge.id, from: edge.source, to: edge.target,
      })),
    });
  };

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setEdges((current) => {
      // One incoming edge per target keeps the graph a proper processing DAG;
      // a second source turns the branch into a parallel mix instead.
      const filtered = current.filter((edge) => edge.target !== connection.target || connection.source === COLOR_GRADE_SOURCE_ID);
      const next = addEdge({ ...connection, id: `cg-${Date.now().toString(36)}`, animated: true, className: 'cg-node-edge' }, filtered);
      return next.slice(-MAX_COLOR_LINKS);
    });
  }, [setEdges]);

  // Edge changes (including deletion) are structural: persist them.
  useEffect(() => {
    const ids = edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}`).join('|');
    const expected = grade.links.map((link) => `${link.id}:${link.from}>${link.to}`).join('|');
    if (ids === expected) return;
    onChange({
      ...grade,
      links: edges.slice(0, MAX_COLOR_LINKS).map((edge) => ({ id: edge.id, from: edge.source, to: edge.target })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);

  const addNode = (kind: ColorNodeKind) => {
    if (grade.nodes.length >= MAX_COLOR_NODES) return;
    const id = `cg-node-${Date.now().toString(36)}`;
    const target = grade.nodes.find((node) => node.kind === 'output')?.id ?? COLOR_GRADE_OUTPUT_ID;
    const node: ColorNode = {
      id,
      label: kind === 'parallel' ? 'Paralelo' : `Corrección ${grade.nodes.length - 1}`,
      kind,
      enabled: true,
      layer: createNeutralLayer(),
      x: 0.45,
      y: kind === 'parallel' ? 0.24 : 0.72,
    };
    onChange({
      ...grade,
      nodes: [
        ...grade.nodes.filter((item) => item.kind !== 'output'),
        node,
        ...grade.nodes.filter((item) => item.kind === 'output'),
      ],
      links: [
        ...grade.links.filter((link) => link.to !== target),
        { id: `cg-link-${Date.now().toString(36)}`, from: grade.nodes.find((n) => n.kind !== 'output' && n.kind !== 'source')?.id ?? COLOR_GRADE_SOURCE_ID, to: id },
        { id: `cg-link-out-${Date.now().toString(36)}`, from: id, to: target },
      ].slice(-MAX_COLOR_LINKS),
      activeNodeId: id,
    });
    onSelectNode(id);
  };

  const duplicateNode = () => {
    const source = grade.nodes.find((node) => node.id === activeNodeId);
    if (!source || source.kind === 'source' || source.kind === 'output' || grade.nodes.length >= MAX_COLOR_NODES) return;
    const id = `cg-node-${Date.now().toString(36)}`;
    onChange({
      ...grade,
      nodes: [...grade.nodes, {
        ...source,
        id,
        label: `${source.label} copia`.slice(0, 60),
        layer: JSON.parse(JSON.stringify(source.layer)) as ColorNode['layer'],
        x: Math.min(1, source.x + 0.05),
        y: Math.min(1, source.y + 0.18),
      }],
      activeNodeId: id,
    });
    onSelectNode(id);
  };

  const deleteNode = () => {
    const target = grade.nodes.find((node) => node.id === activeNodeId);
    if (!target || target.kind === 'source' || target.kind === 'output') return;
    const parents = grade.links.filter((link) => link.to === target.id).map((link) => link.from);
    const children = grade.links.filter((link) => link.from === target.id).map((link) => link.to);
    const fallback = parents[0] ?? COLOR_GRADE_SOURCE_ID;
    onChange({
      ...grade,
      nodes: grade.nodes.filter((node) => node.id !== target.id),
      links: [
        ...grade.links.filter((link) => link.from !== target.id && link.to !== target.id),
        ...children.flatMap((child) => grade.links.some((link) => link.from === fallback && link.to === child)
          ? []
          : [{ id: `cg-relink-${Date.now().toString(36)}-${child}`, from: fallback, to: child }]),
      ].slice(-MAX_COLOR_LINKS),
      activeNodeId: fallback,
    });
    onSelectNode(fallback);
  };

  return (
    <div className="cg-nodes">
      <div className="cg-nodes-toolbar">
        <button type="button" className="cg-btn" onClick={() => addNode('serial')}>+ Serial</button>
        <button type="button" className="cg-btn" onClick={() => addNode('parallel')}>+ Paralelo</button>
        <button type="button" className="cg-btn" onClick={duplicateNode} disabled={!activeNodeId}>Duplicar</button>
        <button type="button" className="cg-btn" onClick={deleteNode} disabled={!activeNodeId}>Eliminar</button>
      </div>
      <div className="cg-nodes-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          onNodeDragStop={(_, node) => {
            const next = nodes.map((item) => (item.id === node.id ? node : item));
            persist(next, edges);
          }}
          onEdgesDelete={() => undefined}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.4}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          nodesConnectable
          elementsSelectable
        >
          <Background gap={12} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="cg-nodes-foot">Arrastrá para reordenar · conectá los puntos laterales · doble clic para renombrar</div>
    </div>
  );
}
