/**
 * Cola de generación continua de Google Flow.
 *
 * Flow no tiene API oficial: el servidor MCP prepara el prompt en la interfaz
 * web y, con `auto_confirm`, consume créditos y descarga el resultado. Esta cola
 * encadena esa llamada N veces con una espera entre medio, repitiendo la lista
 * de prompts si se pide, y se detiene por límite de imágenes, por errores
 * consecutivos, por saldo cero o a pedido del usuario.
 *
 * Todo lo que decide *qué* hacer vive acá, sin React y sin red, para poder
 * probarlo. El proveedor (`FlowQueueProvider`) sólo ejecuta y persiste.
 */

export const FLOW_QUEUE_STORAGE_KEY = 'editoria.flow-queue.v1';

export const FLOW_IMAGE_MODELS = ['Nano Banana 2', 'Nano Banana Pro', 'Imagen 4'] as const;
export type FlowImageModel = (typeof FLOW_IMAGE_MODELS)[number];

export const FLOW_IMAGE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export type FlowImageRatio = (typeof FLOW_IMAGE_RATIOS)[number];

export const FLOW_QUEUE_BOUNDS = {
  imagesPerPrompt: { min: 1, max: 4, step: 1 },
  cooldownMs: { min: 0, max: 600_000, step: 5_000 },
  maxImages: { min: 1, max: 200, step: 1 },
  maxConsecutiveErrors: { min: 1, max: 10, step: 1 },
} as const;

export const MAX_PROMPTS = 200;
const MAX_LOG = 40;

export type FlowQueueStatus =
  | 'idle'
  | 'running'
  | 'stopped'
  | 'completed'
  | 'failed';

export type FlowItemStatus = 'pending' | 'running' | 'done' | 'failed';

export interface FlowQueueSettings {
  readonly version: 1;
  readonly model: FlowImageModel;
  readonly ratio: FlowImageRatio;
  /** Cuántas veces se repite cada prompt antes de pasar al siguiente. */
  readonly imagesPerPrompt: number;
  /** Espera entre generaciones para no saturar la interfaz de Flow. */
  readonly cooldownMs: number;
  /** Tope duro de imágenes en toda la corrida. */
  readonly maxImages: number;
  /** Corta la corrida tras esta cantidad de fallos seguidos. */
  readonly maxConsecutiveErrors: number;
  /** Al terminar la lista, vuelve a empezar hasta llegar al tope. */
  readonly repeatForever: boolean;
  /** Importa cada imagen a Medios del proyecto abierto. */
  readonly importToMedia: boolean;
  /** Consulta `flow_status` antes de cada imagen y corta si el saldo es cero. */
  readonly checkCredits: boolean;
}

export interface FlowQueueItem {
  readonly id: string;
  readonly prompt: string;
  readonly status: FlowItemStatus;
  readonly attempts: number;
  readonly artifacts: readonly string[];
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface FlowQueueLogEntry {
  readonly at: string;
  readonly prompt: string;
  readonly artifacts: readonly string[];
  readonly error: string | null;
  readonly cycle: number;
}

export interface FlowQueueState {
  readonly version: 1;
  readonly settings: FlowQueueSettings;
  readonly items: readonly FlowQueueItem[];
  readonly log: readonly FlowQueueLogEntry[];
  readonly cycles: number;
  readonly imagesGenerated: number;
  readonly consecutiveErrors: number;
  readonly startedAt: string | null;
  readonly status: FlowQueueStatus;
  readonly stopReason: string | null;
}

export const DEFAULT_FLOW_QUEUE_SETTINGS: FlowQueueSettings = {
  version: 1,
  model: 'Nano Banana 2',
  ratio: '16:9',
  imagesPerPrompt: 1,
  cooldownMs: 20_000,
  maxImages: 12,
  maxConsecutiveErrors: 3,
  repeatForever: false,
  importToMedia: true,
  checkCredits: true,
};

export const EMPTY_FLOW_QUEUE: FlowQueueState = {
  version: 1,
  settings: DEFAULT_FLOW_QUEUE_SETTINGS,
  items: [],
  log: [],
  cycles: 0,
  imagesGenerated: 0,
  consecutiveErrors: 0,
  startedAt: null,
  status: 'idle',
  stopReason: null,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function model(value: unknown): FlowImageModel {
  return FLOW_IMAGE_MODELS.includes(value as FlowImageModel)
    ? (value as FlowImageModel)
    : DEFAULT_FLOW_QUEUE_SETTINGS.model;
}

function ratio(value: unknown): FlowImageRatio {
  return FLOW_IMAGE_RATIOS.includes(value as FlowImageRatio)
    ? (value as FlowImageRatio)
    : DEFAULT_FLOW_QUEUE_SETTINGS.ratio;
}

export function normalizeFlowQueueSettings(raw: unknown): FlowQueueSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bounds = FLOW_QUEUE_BOUNDS;
  return {
    version: 1,
    model: model(source.model),
    ratio: ratio(source.ratio),
    imagesPerPrompt: clamp(
      source.imagesPerPrompt,
      bounds.imagesPerPrompt.min,
      bounds.imagesPerPrompt.max,
      DEFAULT_FLOW_QUEUE_SETTINGS.imagesPerPrompt,
    ),
    cooldownMs: clamp(
      source.cooldownMs,
      bounds.cooldownMs.min,
      bounds.cooldownMs.max,
      DEFAULT_FLOW_QUEUE_SETTINGS.cooldownMs,
    ),
    maxImages: clamp(
      source.maxImages,
      bounds.maxImages.min,
      bounds.maxImages.max,
      DEFAULT_FLOW_QUEUE_SETTINGS.maxImages,
    ),
    maxConsecutiveErrors: clamp(
      source.maxConsecutiveErrors,
      bounds.maxConsecutiveErrors.min,
      bounds.maxConsecutiveErrors.max,
      DEFAULT_FLOW_QUEUE_SETTINGS.maxConsecutiveErrors,
    ),
    repeatForever: bool(source.repeatForever, DEFAULT_FLOW_QUEUE_SETTINGS.repeatForever),
    importToMedia: bool(source.importToMedia, DEFAULT_FLOW_QUEUE_SETTINGS.importToMedia),
    checkCredits: bool(source.checkCredits, DEFAULT_FLOW_QUEUE_SETTINGS.checkCredits),
  };
}

/**
 * Convierte el texto del cuadro de prompts en una lista.
 *
 * Una línea por prompt, se ignoran vacías y las que empiezan con `#` (para poder
 * dejar notas en el borrador). Se eliminan duplicados sin distinguir mayúsculas
 * y se conserva el orden original.
 */
export function parseFlowPrompts(text: string): string[] {
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    prompts.push(trimmed);
    if (prompts.length >= MAX_PROMPTS) break;
  }
  return prompts;
}

/** Estado inicial: cada prompt se repite `imagesPerPrompt` veces. */
export function createFlowQueue(
  prompts: readonly string[],
  settings: FlowQueueSettings,
  now: number = Date.now(),
): FlowQueueState {
  const normalized = normalizeFlowQueueSettings(settings);
  const items: FlowQueueItem[] = [];
  let index = 0;
  for (const prompt of prompts) {
    for (let copy = 0; copy < normalized.imagesPerPrompt; copy += 1) {
      index += 1;
      items.push({
        id: `flow-${index}`,
        prompt,
        status: 'pending',
        attempts: 0,
        artifacts: [],
        error: null,
        startedAt: null,
        finishedAt: null,
      });
    }
  }
  return {
    ...EMPTY_FLOW_QUEUE,
    settings: normalized,
    items,
    startedAt: new Date(now).toISOString(),
    status: 'running',
    stopReason: null,
  };
}

/**
 * Toma el siguiente pendiente. Si no queda ninguno y la corrida es continua,
 * recicla los completados y suma un ciclo. Los fallidos no se reintentan solos:
 * un prompt que rompe Flow volvería a romperlo.
 */
export function takeNextItem(
  state: FlowQueueState,
  now: number = Date.now(),
): { readonly state: FlowQueueState; readonly item: FlowQueueItem | null } {
  let current = state;
  let index = current.items.findIndex((item) => item.status === 'pending');

  if (index < 0 && current.settings.repeatForever && current.imagesGenerated < current.settings.maxImages) {
    const recyclable = current.items.some((item) => item.status === 'done');
    if (recyclable) {
      current = {
        ...current,
        cycles: current.cycles + 1,
        items: current.items.map((item) =>
          item.status === 'done'
            ? {
                ...item,
                status: 'pending' as const,
                attempts: 0,
                artifacts: [],
                error: null,
                startedAt: null,
                finishedAt: null,
              }
            : item,
        ),
      };
      index = current.items.findIndex((item) => item.status === 'pending');
    }
  }

  if (index < 0) return { state: current, item: null };

  const base = current.items[index];
  if (!base) return { state: current, item: null };
  const running: FlowQueueItem = {
    ...base,
    status: 'running',
    attempts: base.attempts + 1,
    startedAt: new Date(now).toISOString(),
    error: null,
  };
  return {
    state: {
      ...current,
      items: current.items.map((item, position) => (position === index ? running : item)),
    },
    item: running,
  };
}

export type FlowItemOutcome =
  | { readonly ok: true; readonly artifacts: readonly string[] }
  | { readonly ok: false; readonly error: string };

export function finishFlowItem(
  state: FlowQueueState,
  id: string,
  outcome: FlowItemOutcome,
  now: number = Date.now(),
): FlowQueueState {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return state;
  const at = new Date(now).toISOString();
  const artifacts = outcome.ok ? outcome.artifacts : [];
  const error = outcome.ok ? null : outcome.error;
  const generated = outcome.ok ? Math.max(1, artifacts.length) : 0;

  return {
    ...state,
    items: state.items.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status: outcome.ok ? 'done' : 'failed',
            artifacts,
            error,
            finishedAt: at,
          }
        : entry,
    ),
    log: [
      { at, prompt: item.prompt, artifacts, error, cycle: state.cycles },
      ...state.log,
    ].slice(0, MAX_LOG),
    imagesGenerated: state.imagesGenerated + generated,
    consecutiveErrors: outcome.ok ? 0 : state.consecutiveErrors + 1,
  };
}

/** Motivo por el que la corrida no debe pedir otra imagen, o `null`. */
export function flowQueueStopReason(state: FlowQueueState): string | null {
  if (state.status !== 'running') {
    return state.stopReason ?? 'La corrida no está activa.';
  }
  if (state.imagesGenerated >= state.settings.maxImages) {
    return `Se alcanzó el tope de ${state.settings.maxImages} imagen(es).`;
  }
  if (state.consecutiveErrors >= state.settings.maxConsecutiveErrors) {
    return `Se cortó tras ${state.consecutiveErrors} fallo(s) seguido(s).`;
  }
  const hasPending = state.items.some((item) => item.status === 'pending');
  if (!hasPending && !state.settings.repeatForever) {
    return 'Se terminó la lista de prompts.';
  }
  return null;
}

export function haltFlowQueue(
  state: FlowQueueState,
  reason: string,
  status: FlowQueueStatus = 'stopped',
): FlowQueueState {
  return { ...state, status, stopReason: reason };
}

/** Estado final que corresponde al motivo de corte. */
export function flowQueueStopStatus(state: FlowQueueState): FlowQueueStatus {
  if (state.status !== 'running') return state.status;
  if (state.consecutiveErrors >= state.settings.maxConsecutiveErrors) return 'failed';
  return 'completed';
}

export interface FlowQueueProgress {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly pending: number;
  readonly images: number;
  readonly cycles: number;
  readonly runningPrompt: string | null;
}

export function flowQueueProgress(state: FlowQueueState): FlowQueueProgress {
  const running = state.items.find((item) => item.status === 'running');
  return {
    total: state.items.length,
    done: state.items.filter((item) => item.status === 'done').length,
    failed: state.items.filter((item) => item.status === 'failed').length,
    pending: state.items.filter((item) => item.status === 'pending').length,
    images: state.imagesGenerated,
    cycles: state.cycles,
    runningPrompt: running?.prompt ?? null,
  };
}

/**
 * Saldo de créditos que reporta `flow_status`. El servidor devuelve un texto
 * con la telemetría de la sesión; se buscan números junto a la palabra
 * "credit". Si no se puede leer, devuelve `null` y la corrida no se corta.
 */
export function readFlowCredits(payload: unknown): number | null {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  if (!text) return null;
  const match = /credit[^0-9-]{0,40}(-?\d+(?:[.,]\d+)?)/i.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function loadFlowQueue(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): FlowQueueState {
  if (!storage) return EMPTY_FLOW_QUEUE;
  try {
    const text = storage.getItem(FLOW_QUEUE_STORAGE_KEY);
    if (!text) return EMPTY_FLOW_QUEUE;
    return restoreFlowQueue(JSON.parse(text));
  } catch {
    return EMPTY_FLOW_QUEUE;
  }
}

/** Reconstruye desde disco sin confiar en nada y sin reanudar sola. */
export function restoreFlowQueue(raw: unknown): FlowQueueState {
  if (!raw || typeof raw !== 'object') return EMPTY_FLOW_QUEUE;
  const source = raw as Record<string, unknown>;
  const settings = normalizeFlowQueueSettings(source.settings);
  const items: FlowQueueItem[] = [];
  if (Array.isArray(source.items)) {
    for (const [index, entry] of source.items.slice(0, MAX_PROMPTS * 4).entries()) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
      if (!prompt) continue;
      const status = item.status;
      items.push({
        id: typeof item.id === 'string' && item.id ? item.id : `flow-${index + 1}`,
        prompt,
        // Una corrida guardada no puede seguir viva: lo que estaba en curso
        // vuelve a pendiente para que el usuario decida reanudar.
        status: status === 'done' || status === 'failed' ? status : 'pending',
        attempts: clamp(item.attempts, 0, 99, 0),
        artifacts: Array.isArray(item.artifacts)
          ? item.artifacts.filter((path): path is string => typeof path === 'string').slice(0, 20)
          : [],
        error: typeof item.error === 'string' ? item.error : null,
        startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
        finishedAt: typeof item.finishedAt === 'string' ? item.finishedAt : null,
      });
    }
  }
  return {
    version: 1,
    settings,
    items,
    log: [],
    cycles: clamp(source.cycles, 0, 9_999, 0),
    imagesGenerated: clamp(source.imagesGenerated, 0, 100_000, 0),
    consecutiveErrors: 0,
    startedAt: typeof source.startedAt === 'string' ? source.startedAt : null,
    status: items.length > 0 ? 'stopped' : 'idle',
    stopReason:
      items.length > 0
        ? 'Plan recuperado de la sesión anterior; reanudar consume créditos y requiere autorización.'
        : null,
  };
}

export function saveFlowQueue(
  state: FlowQueueState,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(
      FLOW_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        settings: state.settings,
        items: state.items.map((item) => ({
          id: item.id,
          prompt: item.prompt,
          status: item.status,
          attempts: item.attempts,
          artifacts: item.artifacts,
          error: item.error,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
        })),
        cycles: state.cycles,
        imagesGenerated: state.imagesGenerated,
        startedAt: state.startedAt,
      }),
    );
  } catch {
    // Sin almacenamiento: la cola vive sólo en memoria.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
