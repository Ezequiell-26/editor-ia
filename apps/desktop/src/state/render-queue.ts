/**
 * Cola de entregas (Deliver).
 *
 * DaVinci encola renders y los procesa en orden aunque el usuario siga
 * editando. Acá la cola es un valor inmutable y puro: la UI la persiste en
 * `localStorage` y el runner del diálogo de exportación la drena de a una.
 *
 * Reglas que importan:
 * - Un perfil sólo puede estar una vez pendiente o corriendo (evita duplicar
 *   un render de 20 minutos por un doble clic).
 * - Al cargar, lo que quedó `running` vuelve a `pending`: si la app se cerró a
 *   mitad de un render, ese archivo quedó incompleto y hay que repetirlo.
 * - La cola se capea para que un `localStorage` corrupto o gigante no frene
 *   el arranque.
 */

export type RenderQueueStatus = 'pending' | 'running' | 'done' | 'error';

export interface RenderQueueEntry {
  readonly id: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly includeCaptions: boolean;
  readonly status: RenderQueueStatus;
  readonly outputPath: string | null;
  readonly message: string | null;
  readonly queuedAt: string;
}

export type RenderQueue = readonly RenderQueueEntry[];

export const RENDER_QUEUE_KEY = 'editor-ia.render-queue.v1';
export const RENDER_QUEUE_LIMIT = 50;

export interface QueueSummary {
  readonly pending: number;
  readonly running: number;
  readonly done: number;
  readonly error: number;
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
  now: Date = new Date(),
): RenderQueue {
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
    });
  }
  if (additions.length === 0) return queue;
  return [...queue, ...additions].slice(-RENDER_QUEUE_LIMIT);
}

export function nextPending(queue: RenderQueue): RenderQueueEntry | null {
  return queue.find((entry) => entry.status === 'pending') ?? null;
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

/** Devuelve una entrada fallida a `pending` conservando su posición. */
export function retryEntry(queue: RenderQueue, id: string): RenderQueue {
  return replace(queue, id, (entry) =>
    entry.status === 'error' || entry.status === 'done'
      ? { ...entry, status: 'pending', outputPath: null, message: null }
      : entry,
  );
}

export function removeEntry(queue: RenderQueue, id: string): RenderQueue {
  return queue.filter((entry) => entry.id !== id);
}

export function clearSettled(queue: RenderQueue): RenderQueue {
  return queue.filter((entry) => entry.status === 'pending' || entry.status === 'running');
}

export function summarizeQueue(queue: RenderQueue): QueueSummary {
  const summary = { pending: 0, running: 0, done: 0, error: 0, total: queue.length };
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
      record.status === 'error')
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
