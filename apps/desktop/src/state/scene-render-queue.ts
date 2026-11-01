/**
 * Cola de render persistente por proyecto.
 *
 * Los segmentos de escena ya son reanudables por archivo; esta cola agrega el
 * orden, el estado y la supervivencia al cierre de la app. Vive fuera del
 * documento del proyecto para no cambiar su revisión (y no invalidar la caché de
 * segmentos) en cada transición.
 */

export type RenderQueueStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RenderQueueItem {
  readonly id: string;
  readonly projectRoot: string;
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly includeCaptions: boolean;
  /** Lote que se concatena automáticamente al terminar. */
  readonly batchId?: string;
  readonly status: RenderQueueStatus;
  readonly attempts: number;
  readonly outputPath?: string;
  readonly bytes?: number;
  readonly durationSeconds?: number;
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface RenderQueueFinal {
  readonly batchId: string;
  readonly projectRoot: string;
  readonly outputPath: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly createdAt: string;
}

export interface RenderQueueState {
  readonly version: 1;
  readonly paused: boolean;
  readonly items: readonly RenderQueueItem[];
  readonly finals: readonly RenderQueueFinal[];
}

export const RENDER_QUEUE_STORAGE_KEY = 'olyvia.render.queue.v1';
export const MAX_RENDER_QUEUE_ITEMS = 100;

export const EMPTY_RENDER_QUEUE: RenderQueueState = { version: 1, paused: false, items: [], finals: [] };

const STATUSES: readonly RenderQueueStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && 'randomUUID' in globalCrypto) return globalCrypto.randomUUID();
  return `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newBatchId(): string {
  return newId();
}

function isStatus(value: unknown): value is RenderQueueStatus {
  return typeof value === 'string' && STATUSES.includes(value as RenderQueueStatus);
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reconstruye desde disco; un trabajo “running” vuelve a “queued” (reanudación). */
export function restoreRenderQueue(raw: unknown): RenderQueueState {
  if (!raw || typeof raw !== 'object') return EMPTY_RENDER_QUEUE;
  const source = raw as Record<string, unknown>;
  const items: RenderQueueItem[] = [];
  if (Array.isArray(source.items)) {
    for (const entry of source.items.slice(0, MAX_RENDER_QUEUE_ITEMS)) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const projectRoot = typeof item.projectRoot === 'string' ? item.projectRoot.trim() : '';
      const sceneId = typeof item.sceneId === 'string' ? item.sceneId.trim() : '';
      if (!projectRoot || !sceneId || !isStatus(item.status)) continue;
      const status = item.status === 'running' ? 'queued' : item.status;
      items.push({
        id: typeof item.id === 'string' && item.id.trim() ? item.id : newId(),
        projectRoot,
        sceneId,
        sceneTitle: typeof item.sceneTitle === 'string' ? item.sceneTitle.slice(0, 200) : sceneId,
        includeCaptions: item.includeCaptions === true,
        ...(typeof item.batchId === 'string' && item.batchId.trim()
          ? { batchId: item.batchId }
          : {}),
        status,
        attempts: typeof item.attempts === 'number' && item.attempts >= 0 ? Math.floor(item.attempts) : 0,
        ...(typeof item.outputPath === 'string' ? { outputPath: item.outputPath } : {}),
        ...(typeof item.bytes === 'number' ? { bytes: item.bytes } : {}),
        ...(typeof item.durationSeconds === 'number' ? { durationSeconds: item.durationSeconds } : {}),
        ...(typeof item.error === 'string' ? { error: item.error.slice(0, 600) } : {}),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
        ...(typeof item.startedAt === 'string' ? { startedAt: item.startedAt } : {}),
        ...(typeof item.finishedAt === 'string' ? { finishedAt: item.finishedAt } : {}),
      });
    }
  }
  const finals: RenderQueueFinal[] = [];
  if (Array.isArray(source.finals)) {
    for (const entry of source.finals.slice(0, MAX_RENDER_QUEUE_ITEMS)) {
      if (!entry || typeof entry !== 'object') continue;
      const final = entry as Record<string, unknown>;
      if (
        typeof final.batchId !== 'string' ||
        typeof final.projectRoot !== 'string' ||
        typeof final.outputPath !== 'string' ||
        typeof final.bytes !== 'number' ||
        typeof final.durationSeconds !== 'number'
      ) {
        continue;
      }
      finals.push({
        batchId: final.batchId,
        projectRoot: final.projectRoot,
        outputPath: final.outputPath,
        bytes: final.bytes,
        durationSeconds: final.durationSeconds,
        createdAt: typeof final.createdAt === 'string' ? final.createdAt : nowIso(),
      });
    }
  }
  return { version: 1, paused: source.paused === true, items, finals };
}

export function loadRenderQueue(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): RenderQueueState {
  if (!storage) return EMPTY_RENDER_QUEUE;
  try {
    const text = storage.getItem(RENDER_QUEUE_STORAGE_KEY);
    if (!text) return EMPTY_RENDER_QUEUE;
    return restoreRenderQueue(JSON.parse(text));
  } catch {
    return EMPTY_RENDER_QUEUE;
  }
}

export function saveRenderQueue(
  state: RenderQueueState,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(
      RENDER_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        paused: state.paused,
        items: state.items.map((item) => ({ ...item })),
        finals: state.finals.map((final) => ({ ...final })),
      }),
    );
  } catch {
    // sin almacenamiento: la cola sigue en memoria durante la sesión
  }
}

export function enqueueScenes(
  state: RenderQueueState,
  input: {
    readonly projectRoot: string;
    readonly scenes: readonly { readonly id: string; readonly title: string }[];
    readonly includeCaptions: boolean;
    readonly batchId?: string;
  },
): { state: RenderQueueState; addedIds: string[] } {
  const projectRoot = input.projectRoot.trim();
  if (!projectRoot) throw new Error('la cola necesita un proyecto abierto');
  const active = new Set(
    state.items
      .filter(
        (item) =>
          item.projectRoot === projectRoot &&
          (item.status === 'queued' || item.status === 'running'),
      )
      .map((item) => item.sceneId),
  );
  const addedIds: string[] = [];
  const added: RenderQueueItem[] = [];
  for (const scene of input.scenes) {
    if (!scene.id || active.has(scene.id)) continue;
    active.add(scene.id);
    const item: RenderQueueItem = {
      id: newId(),
      projectRoot,
      sceneId: scene.id,
      sceneTitle: scene.title.slice(0, 200) || scene.id,
      includeCaptions: input.includeCaptions,
      ...(input.batchId ? { batchId: input.batchId } : {}),
      status: 'queued',
      attempts: 0,
      createdAt: nowIso(),
    };
    addedIds.push(item.id);
    added.push(item);
  }
  const items = [...state.items, ...added].slice(-MAX_RENDER_QUEUE_ITEMS);
  return { state: { ...state, items }, addedIds };
}

export function nextQueuedItem(
  state: RenderQueueState,
  projectRoot: string,
): RenderQueueItem | null {
  if (state.paused) return null;
  return (
    state.items.find(
      (item) => item.projectRoot === projectRoot && item.status === 'queued',
    ) ?? null
  );
}

type QueueItemPatch = {
  readonly [K in keyof Omit<RenderQueueItem, 'id' | 'createdAt'>]?:
    | Omit<RenderQueueItem, 'id' | 'createdAt'>[K]
    | undefined;
};

export function updateQueueItem(
  state: RenderQueueState,
  id: string,
  patch: QueueItemPatch,
): RenderQueueState {
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.id !== id) return item;
      const next: Record<string, unknown> = { ...item };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return next as unknown as RenderQueueItem;
    }),
  };
}

export function markQueueItemRunning(
  state: RenderQueueState,
  id: string,
): RenderQueueState {
  return updateQueueItem(state, id, {
    status: 'running',
    attempts: (state.items.find((item) => item.id === id)?.attempts ?? 0) + 1,
    startedAt: nowIso(),
    finishedAt: undefined,
    error: undefined,
  });
}

export function markQueueItemCompleted(
  state: RenderQueueState,
  id: string,
  result: { outputPath: string; bytes: number; durationSeconds: number },
): RenderQueueState {
  return updateQueueItem(state, id, {
    status: 'completed',
    outputPath: result.outputPath,
    bytes: result.bytes,
    durationSeconds: result.durationSeconds,
    finishedAt: nowIso(),
    error: undefined,
  });
}

export function markQueueItemFailed(
  state: RenderQueueState,
  id: string,
  error: string,
): RenderQueueState {
  return updateQueueItem(state, id, {
    status: 'failed',
    error: error.slice(0, 600),
    finishedAt: nowIso(),
  });
}

export function batchItems(
  state: RenderQueueState,
  batchId: string,
): readonly RenderQueueItem[] {
  return state.items.filter((item) => item.batchId === batchId);
}

export function batchReadyForFinalize(
  state: RenderQueueState,
  batchId: string,
): readonly RenderQueueItem[] | null {
  const items = batchItems(state, batchId);
  if (items.length < 2) return null;
  if (items.some((item) => item.status !== 'completed' || !item.outputPath)) return null;
  if (state.finals.some((final) => final.batchId === batchId)) return null;
  return items;
}

export function addQueueFinal(
  state: RenderQueueState,
  final: RenderQueueFinal,
): RenderQueueState {
  return {
    ...state,
    finals: [final, ...state.finals.filter((item) => item.batchId !== final.batchId)].slice(
      0,
      20,
    ),
  };
}

export type RenderQueueAction = 'pause' | 'resume' | 'cancel' | 'clear-finished';

export function applyQueueAction(
  state: RenderQueueState,
  action: RenderQueueAction,
  id?: string,
): RenderQueueState {
  if (action === 'pause') return { ...state, paused: true };
  if (action === 'resume') return { ...state, paused: false };
  if (action === 'clear-finished') {
    return {
      ...state,
      finals: [],
      items: state.items.filter(
        (item) => item.status === 'queued' || item.status === 'running',
      ),
    };
  }
  if (action === 'cancel') {
    if (id) {
      const target = state.items.find((item) => item.id === id);
      if (!target || target.status !== 'queued') return state;
      return updateQueueItem(state, id, {
        status: 'cancelled',
        finishedAt: nowIso(),
      });
    }
    return {
      ...state,
      paused: true,
      items: state.items.map((item) =>
        item.status === 'queued'
          ? { ...item, status: 'cancelled', finishedAt: nowIso() }
          : item,
      ),
    };
  }
  return state;
}
