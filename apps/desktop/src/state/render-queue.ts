/**
 * Cola de entregas (Deliver).
 *
 * DaVinci encola renders y los procesa en orden aunque el usuario siga
 * editando. Acá la cola es un valor inmutable y puro: la UI la persiste en
 * `localStorage` y el runner del diálogo de exportación la drena de a una.
 * En el escritorio además se espeja al backend (`render_queue_*`), que guarda
 * la copia durable en app-data; esta capa sigue siendo la que manda en la UI.
 *
 * Reglas que importan:
 * - Un perfil sólo puede estar una vez pendiente o corriendo (evita duplicar
 *   un render de 20 minutos por un doble clic).
 * - Al cargar, lo que quedó `running` vuelve a `pending`: si la app se cerró a
 *   mitad de un render, ese archivo quedó incompleto y hay que repetirlo.
 * - La cola se capea para que un `localStorage` corrupto o gigante no frene
 *   el arranque.
 * - La cola es global pero cada entrada recuerda su proyecto (`projectId`):
 *   el runner, el orden y la limpieza filtran por `RenderQueueScope` para que
 *   un pendiente del proyecto A nunca se drene con el documento del B.
 */

export type RenderQueueStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface RenderQueueEntry {
  readonly id: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly includeCaptions: boolean;
  readonly status: RenderQueueStatus;
  readonly outputPath: string | null;
  readonly message: string | null;
  readonly queuedAt: string;
  /** Proyecto que encoló la entrega; ausente en colas persistidas antes del scope. */
  readonly projectId?: string;
  /** Nombre del proyecto al momento de encolar, sólo para mostrar en la lista. */
  readonly projectName?: string;
}

export type RenderQueue = readonly RenderQueueEntry[];

/**
 * A qué proyecto pertenece una entrada de la cola. La cola es global (una sola
 * clave de storage y un solo JSON del backend), así que el drenaje, el orden y
 * la limpieza tienen que filtrar por proyecto o un pendiente del proyecto A se
 * intentaría renderizar —y fallaría— con el documento del proyecto B.
 */
export interface RenderQueueScope {
  readonly projectId: string;
  /** Perfiles del proyecto actual: reclaman entradas legacy sin `projectId`. */
  readonly profileIds: ReadonlySet<string>;
}

export function renderQueueScope(project: {
  readonly id: string;
  readonly renderProfiles: readonly { readonly id: string }[];
}): RenderQueueScope {
  return {
    projectId: project.id,
    profileIds: new Set(project.renderProfiles.map((profile) => profile.id)),
  };
}

/**
 * true si la entrada pertenece al proyecto del scope. Las entradas nuevas llevan
 * `projectId`; las persistidas antes de este campo se reclaman sólo cuando su
 * `profileId` existe en el proyecto actual (los ids son UUID por documento, así
 * que un perfil ajeno nunca coincide).
 */
export function queueEntryInScope(entry: RenderQueueEntry, scope: RenderQueueScope): boolean {
  if (entry.projectId != null) return entry.projectId === scope.projectId;
  return scope.profileIds.has(entry.profileId);
}

export const RENDER_QUEUE_KEY = 'editor-ia.render-queue.v1';
export const RENDER_QUEUE_LIMIT = 50;

export interface QueueSummary {
  readonly pending: number;
  readonly running: number;
  readonly done: number;
  readonly error: number;
  readonly cancelled: number;
  readonly total: number;
}

/** Contrato mínimo de almacenamiento: `localStorage` en la app, un mapa en tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let sequence = 0;

function nextId(now: Date): string {
  sequence += 1;
  return `rq-${now.getTime().toString(36)}-${sequence.toString(36)}`;
}

export function enqueueProfiles(
  queue: RenderQueue,
  profiles: readonly { id: string; name: string }[],
  includeCaptions: boolean,
  project: { readonly id: string; readonly name: string },
  now: Date = new Date(),
): RenderQueue {
  // La deduplicación por profileId ya es segura entre proyectos: los ids son
  // UUID por documento, así que una entrada de otro proyecto nunca coincide.
  const busyIds = new Set(
    queue
      .filter((entry) => entry.status === 'pending' || entry.status === 'running')
      .map((entry) => entry.profileId),
  );
  const additions: RenderQueueEntry[] = [];
  for (const profile of profiles) {
    if (busyIds.has(profile.id)) continue;
    busyIds.add(profile.id);
    additions.push({
      id: nextId(now),
      profileId: profile.id,
      profileName: profile.name,
      includeCaptions,
      status: 'pending',
      outputPath: null,
      message: null,
      queuedAt: now.toISOString(),
      projectId: project.id,
      projectName: project.name,
    });
  }
  if (additions.length === 0) return queue;
  return [...queue, ...additions].slice(-RENDER_QUEUE_LIMIT);
}

/**
 * Primer pendiente del proyecto del scope. Sin scope devuelve el primer
 * pendiente global (compat con tests y llamadas sin proyecto abierto).
 */
export function nextPending(queue: RenderQueue, scope?: RenderQueueScope): RenderQueueEntry | null {
  return (
    queue.find(
      (entry) => entry.status === 'pending' && (!scope || queueEntryInScope(entry, scope)),
    ) ?? null
  );
}

function replace(
  queue: RenderQueue,
  id: string,
  patch: (entry: RenderQueueEntry) => RenderQueueEntry,
): RenderQueue {
  return queue.map((entry) => (entry.id === id ? patch(entry) : entry));
}

export function markRunning(queue: RenderQueue, id: string): RenderQueue {
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'running',
    message: null,
  }));
}

export function markDone(queue: RenderQueue, id: string, outputPath: string | null): RenderQueue {
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'done',
    outputPath,
    message: null,
  }));
}

export function markFailed(queue: RenderQueue, id: string, message: string): RenderQueue {
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'error',
    message,
  }));
}

/** Devuelve una entrada fallida o cancelada a `pending` conservando su posición. */
export function retryEntry(queue: RenderQueue, id: string): RenderQueue {
  return replace(queue, id, (entry) =>
    entry.status === 'error' || entry.status === 'done' || entry.status === 'cancelled'
      ? { ...entry, status: 'pending', outputPath: null, message: null }
      : entry,
  );
}

export function removeEntry(queue: RenderQueue, id: string): RenderQueue {
  return queue.filter((entry) => entry.id !== id);
}

/**
 * Quita las terminadas; con scope sólo las del proyecto indicado — las
 * pendientes/corriendo y las terminadas de otros proyectos se conservan.
 */
export function clearSettled(queue: RenderQueue, scope?: RenderQueueScope): RenderQueue {
  return queue.filter(
    (entry) =>
      entry.status === 'pending' ||
      entry.status === 'running' ||
      (scope != null && !queueEntryInScope(entry, scope)),
  );
}

/**
 * Mueve una entrada `pending` un lugar dentro del orden de pendientes.
 *
 * El runner drena `nextPending` en orden, así que permutar pendientes cambia
 * de verdad qué render sigue — no hace falta soporte del backend (que sólo ve
 * un render activo por vez). `done`/`error`/`running` no participan del
 * orden: se respeta su posición en el arreglo.
 */
export function movePending(
  queue: RenderQueue,
  id: string,
  direction: 'up' | 'down',
  scope?: RenderQueueScope,
): RenderQueue {
  const pendingIds = queue
    .filter(
      (entry) =>
        entry.status === 'pending' && (!scope || queueEntryInScope(entry, scope)),
    )
    .map((entry) => entry.id);
  const index = pendingIds.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= pendingIds.length) return queue;
  const otherId = pendingIds[target]!;
  const result = [...queue];
  const from = result.findIndex((entry) => entry.id === id);
  const to = result.findIndex((entry) => entry.id === otherId);
  const moved = result[from]!;
  result[from] = result[to]!;
  result[to] = moved;
  return result;
}

export function summarizeQueue(queue: RenderQueue): QueueSummary {
  const summary = {
    pending: 0,
    running: 0,
    done: 0,
    error: 0,
    cancelled: 0,
    total: queue.length,
  };
  for (const entry of queue) {
    summary[entry.status] += 1;
  }
  return summary;
}

function isEntry(value: unknown): value is RenderQueueEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.profileId === 'string' &&
    typeof record.profileName === 'string' &&
    typeof record.queuedAt === 'string' &&
    (record.status === 'pending' ||
      record.status === 'running' ||
      record.status === 'done' ||
      record.status === 'error' ||
      record.status === 'cancelled') &&
    (record.projectId === undefined || typeof record.projectId === 'string') &&
    (record.projectName === undefined || typeof record.projectName === 'string')
  );
}

/**
 * Lee la cola persistida. Tolera JSON inválido (devuelve vacía) y degrada las
 * entradas corruptas en vez de descartar toda la cola.
 */
export function loadRenderQueue(store: KeyValueStore): RenderQueue {
  let raw: string | null = null;
  try {
    raw = store.getItem(RENDER_QUEUE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: RenderQueueEntry[] = [];
  for (const item of parsed) {
    if (!isEntry(item)) continue;
    // Un render interrumpido quedó a medias: se vuelve a encolar.
    if (item.status === 'running') {
      entries.push({ ...item, status: 'pending', outputPath: null, message: null });
    } else {
      entries.push(item);
    }
  }
  return entries.slice(-RENDER_QUEUE_LIMIT);
}

export function saveRenderQueue(store: KeyValueStore, queue: RenderQueue): void {
  try {
    store.setItem(RENDER_QUEUE_KEY, JSON.stringify(queue.slice(-RENDER_QUEUE_LIMIT)));
  } catch {
    // Cuota llena o storage inhabilitado: la cola sigue viva en memoria.
  }
}

/** Nombre de archivo estable para una salida de la cola. */
export function queueFileName(projectName: string, profileName: string, extension = 'mp4'): string {
  const clean = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  const project = clean(projectName) || 'proyecto';
  const profile = clean(profileName) || 'perfil';
  return `${project}-${profile}.${extension}`;
}
