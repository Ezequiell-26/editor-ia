import type { ProjectDocument } from '@editor-ia/project-schema';
import type { NodeGraph } from './graph-model';

/**
 * Persistencia de grafos DENTRO del documento del proyecto.
 *
 * Los grafos viven en la clave `x-nodeGraphs` del `.editoria.json`: el
 * namespace `x-` es la vía prevista por el formato para campos aditivos, así
 * el documento sigue siendo válido para el validador Zod, el de Rust y las
 * versiones anteriores de la app (que conservan las claves x-* al re-guardar).
 * Antes de este cambio los grafos eran archivos sueltos en `<proyecto>/graphs/`
 * que no viajaban con el proyecto.
 *
 * Cada entrada guarda el `NodeGraph` completo (nodos, posiciones y aristas)
 * más metadatos de listado. La escritura pasa por `store.update`, así el
 * guardado usa el mismo camino que cualquier otra edición del proyecto.
 */

export const GRAPH_DOC_KEY = 'x-nodeGraphs';

export interface StoredGraph {
  /** Nombre visible; también es la clave de upsert dentro del documento. */
  readonly name: string;
  readonly updatedAt: string;
  readonly graph: NodeGraph;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validación estructural mínima: misma barra que `graphFromJson`. */
function isNodeGraph(value: unknown): value is NodeGraph {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.name === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  );
}

/** Lee las entradas guardadas; una clave corrupta no rompe el proyecto. */
export function readStoredGraphs(project: ProjectDocument | null): StoredGraph[] {
  const raw = project?.[GRAPH_DOC_KEY];
  if (!Array.isArray(raw)) return [];
  const entries: StoredGraph[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { name, updatedAt, graph } = item;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof updatedAt !== 'string' || !isNodeGraph(graph)) continue;
    entries.push({ name, updatedAt, graph });
  }
  return entries;
}

/**
 * El documento del proyecto sólo admite JSON puro: los campos opcionales del
 * grafo pueden llegar como `undefined` desde el lienzo y `JsonValueSchema` los
 * rechaza. El round-trip por JSON elimina `undefined`/funciones y deja la
 * entrada exactamente como va a quedar en el archivo.
 */
function toJsonSafe(entry: StoredGraph): StoredGraph {
  return JSON.parse(JSON.stringify(entry)) as StoredGraph;
}

/**
 * Devuelve el documento con la entrada `name` reemplazada (o agregada al
 * final). El resto del documento queda intacto; la clave se omite si la
 * lista queda vacía para no dejar `x-nodeGraphs: []` innecesario.
 */
export function upsertStoredGraph(
  project: ProjectDocument,
  entry: StoredGraph,
): ProjectDocument {
  const clean = toJsonSafe(entry);
  const rest = readStoredGraphs(project).filter((item) => item.name !== clean.name);
  const next = [...rest, clean];
  const clone: Record<string, unknown> = { ...project };
  if (next.length === 0) {
    delete clone[GRAPH_DOC_KEY];
  } else {
    clone[GRAPH_DOC_KEY] = next;
  }
  return clone as ProjectDocument;
}
