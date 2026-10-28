import type {
  DownloadOutcome,
  DownloadProbe,
  DownloadRequest,
} from '../../services/project-service';

export type DownloadJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled';

export interface DownloadJob {
  readonly id: string;
  readonly runId: string;
  readonly url: string;
  readonly title: string;
  readonly thumbnail: string | null;
  readonly kind: DownloadProbe['kind'];
  readonly durationSeconds: number | null;
  readonly request: DownloadRequest;
  readonly denoise: boolean;
  readonly createdAt: string;
  /** ISO de inicio programado; null o ausente = lo antes posible. */
  readonly scheduledFor?: string | null;
  /** Repetición automática al completar. */
  readonly repeat?: 'none' | 'hourly' | 'daily' | 'weekly';
  /** Ventana horaria local HH:MM; fuera de ella el trabajo espera. */
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  /** Días permitidos (0=domingo); vacío = todos. */
  readonly windowDays?: readonly number[];
  /** ISO del momento en que empezó a correr. */
  readonly startedAt?: string | null;
  /** Traducción automática de subtítulos al descargar. */
  readonly translateSubtitles?: boolean;
  readonly translateTo?: string | null;
  /** Idiomas adicionales además del principal. */
  readonly translateExtras?: readonly string[];
  /** Autoriza costo si el proveedor de traducción es remoto. */
  readonly translateApproveCost?: boolean;
  /** Quema los subtítulos en el video descargado. */
  readonly burnSubtitles?: boolean;
  readonly status: DownloadJobStatus;
  readonly attempts?: number;
  readonly error?: string | null;
  readonly outcome?: DownloadOutcome | null;
}

export interface DownloadHistoryEntry {
  readonly id: string;
  readonly runId: string;
  readonly title: string;
  readonly url: string;
  readonly thumbnail: string | null;
  readonly kind: DownloadProbe['kind'];
  readonly durationSeconds: number | null;
  readonly request: DownloadRequest;
  readonly denoise: boolean;
  readonly at: string;
  readonly status: 'done' | 'error' | 'cancelled';
  readonly directory: string | null;
  readonly files: readonly {
    name: string;
    bytes: number;
    path: string;
    md5?: string | null;
    sha256?: string | null;
  }[];
  readonly warnings: readonly string[];
  readonly error: string | null;
  readonly elapsedSeconds?: number | null;
  readonly averageBytesPerSecond?: number | null;
}

const QUEUE_KEY = 'editor-ia.download-queue.v1';
const HISTORY_KEY = 'editor-ia.download-history.v1';
const PARALLEL_KEY = 'editor-ia.download-parallel.v1';
const WATCH_KEY = 'editor-ia.download-watch.v1';
const WATCH_SEEN_KEY = 'editor-ia.download-watch-seen.v1';
const FEEDS_KEY = 'editor-ia.download-feeds.v1';
const RSS_FILTER_KEY = 'editor-ia.download-rss-filter.v1';
const ENGINE_CHECK_KEY = 'editor-ia.engine-last-check.v1';
const ENGINE_AUTO_KEY = 'editor-ia.engine-auto.v1';
const MAX_HISTORY = 12;

export interface FeedConfig {
  readonly url: string;
  readonly title: string;
  readonly seen: readonly string[];
}

export function loadWatchFolder(): { dir: string; enabled: boolean } {
  return readJson(WATCH_KEY, { dir: '', enabled: false });
}

export function saveWatchFolder(dir: string, enabled: boolean): void {
  writeJson(WATCH_KEY, { dir, enabled });
}

export function loadWatchSeen(): Record<string, number> {
  return readJson(WATCH_SEEN_KEY, {});
}

export function saveWatchSeen(seen: Record<string, number>): void {
  const entries = Object.entries(seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 500);
  writeJson(WATCH_SEEN_KEY, Object.fromEntries(entries));
}

export function loadEngineCheck(): number {
  return readJson<number>(ENGINE_CHECK_KEY, 0);
}

export function saveEngineCheck(at: number): void {
  writeJson(ENGINE_CHECK_KEY, at);
}

export function loadEngineAuto(): boolean {
  return readJson<boolean>(ENGINE_AUTO_KEY, true);
}

export function saveEngineAuto(enabled: boolean): void {
  writeJson(ENGINE_AUTO_KEY, enabled);
}

export function loadRssFilter(): { include: string; exclude: string } {
  return readJson(RSS_FILTER_KEY, { include: '', exclude: '' });
}

export function saveRssFilter(include: string, exclude: string): void {
  writeJson(RSS_FILTER_KEY, { include, exclude });
}

export function loadFeeds(): FeedConfig[] {
  return readJson<FeedConfig[]>(FEEDS_KEY, []).slice(0, 20);
}

export function saveFeeds(feeds: readonly FeedConfig[]): void {
  writeJson(FEEDS_KEY, feeds.slice(0, 20));
}
export const MIN_PARALLEL = 1;
export const MAX_PARALLEL = 512;
/** Rango seguro para conexiones domésticas; 512 queda en modo avanzado. */
export const RECOMMENDED_PARALLEL_MAX = 8;
export const DEFAULT_PARALLEL = 6;

export function clampParallel(value: number, advanced = false): number {
  const max = advanced ? MAX_PARALLEL : RECOMMENDED_PARALLEL_MAX;
  if (!Number.isFinite(value)) return DEFAULT_PARALLEL;
  return Math.min(max, Math.max(MIN_PARALLEL, Math.trunc(value)));
}

export function loadMaxParallel(): number {
  const raw = readJson<number>(PARALLEL_KEY, DEFAULT_PARALLEL);
  if (!Number.isFinite(raw)) return DEFAULT_PARALLEL;
  return clampParallel(raw, true);
}

export function saveMaxParallel(value: number): void {
  writeJson(PARALLEL_KEY, clampParallel(value, true));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin cuota: la cola sigue viva en memoria.
  }
}

export function loadQueue(): DownloadJob[] {
  const stored = readJson<DownloadJob[]>(QUEUE_KEY, []);
  // Un trabajo que estaba corriendo cuando se cerró la app se reencola y
  // conserva su runId para reanudar los .part en la misma carpeta. Un trabajo
  // pausado a propósito sigue pausado.
  return stored.map((job) =>
    job.status === 'running' ? { ...job, status: 'pending' as const } : job,
  );
}

export function saveQueue(queue: readonly DownloadJob[]): void {
  writeJson(QUEUE_KEY, queue);
}

export function loadHistory(): DownloadHistoryEntry[] {
  return readJson<DownloadHistoryEntry[]>(HISTORY_KEY, []).slice(0, MAX_HISTORY);
}

export function saveHistory(history: readonly DownloadHistoryEntry[]): void {
  writeJson(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

export function newJobId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Un proxy por línea; la cola rota entre ellos trabajo a trabajo. */
export function parseProxyPool(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function pickProxy(pool: readonly string[], index: number): string | null {
  if (pool.length === 0) return null;
  return pool[Math.abs(index) % pool.length] ?? null;
}

export function nextRepeatTime(
  repeat: DownloadJob['repeat'],
  base: number,
  now = Date.now(),
): number | null {
  if (!repeat || repeat === 'none') return null;
  const step =
    repeat === 'hourly' ? 3_600_000 : repeat === 'daily' ? 86_400_000 : 604_800_000;
  let at = (Number.isFinite(base) ? base : now) + step;
  while (at <= now) at += step;
  return at;
}

export function makeJob(input: {
  probe: DownloadProbe;
  request: DownloadRequest;
  denoise: boolean;
  runId?: string;
  scheduledFor?: string | null;
  repeat?: DownloadJob['repeat'];
  windowStart?: string | null;
  windowEnd?: string | null;
  windowDays?: readonly number[];
  translateSubtitles?: boolean;
  translateTo?: string | null;
  translateExtras?: readonly string[];
  translateApproveCost?: boolean;
  burnSubtitles?: boolean;
}): DownloadJob {
  const id = newJobId();
  const runId = input.runId ?? newJobId();
  return {
    id,
    runId,
    url: input.probe.url,
    title: input.probe.title,
    thumbnail: input.probe.thumbnail,
    kind: input.probe.kind,
    durationSeconds: input.probe.durationSeconds,
    request: { ...input.request, runId },
    denoise: input.denoise,
    createdAt: new Date().toISOString(),
    scheduledFor: input.scheduledFor ?? null,
    repeat: input.repeat ?? 'none',
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    windowDays: input.windowDays ?? [],
    startedAt: null,
    translateSubtitles: input.translateSubtitles ?? false,
    translateTo: input.translateTo ?? null,
    translateExtras: input.translateExtras ?? [],
    translateApproveCost: input.translateApproveCost ?? false,
    burnSubtitles: input.burnSubtitles ?? false,
    status: 'pending',
    attempts: 0,
    error: null,
    outcome: null,
  };
}

export function historyFromJob(
  job: DownloadJob,
  status: DownloadHistoryEntry['status'],
  error: string | null,
  metrics?: { elapsedSeconds?: number | null; averageBytesPerSecond?: number | null },
): DownloadHistoryEntry {
  const outcome = job.outcome ?? null;
  return {
    id: job.id,
    runId: job.runId,
    title: job.title,
    url: job.url,
    thumbnail: job.thumbnail,
    kind: job.kind,
    durationSeconds: job.durationSeconds,
    request: job.request,
    denoise: job.denoise,
    at: new Date().toISOString(),
    status,
    directory: outcome?.directory ?? null,
    files: (outcome?.files ?? []).map((file) => ({
      name: file.name,
      bytes: file.bytes,
      path: file.path,
      md5: file.md5 ?? null,
      sha256: file.sha256 ?? null,
    })),
    warnings: outcome?.warnings ?? [],
    error,
    elapsedSeconds: metrics?.elapsedSeconds ?? null,
    averageBytesPerSecond: metrics?.averageBytesPerSecond ?? null,
  };
}


function windowMinute(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function windowAllows(
  start: string | null | undefined,
  end: string | null | undefined,
  now = Date.now(),
  days: readonly number[] = [],
): boolean {
  if (days.length > 0 && !days.includes(new Date(now).getDay())) return false;
  const startMinute = windowMinute(start);
  const endMinute = windowMinute(end);
  if (startMinute === null && endMinute === null) return true;
  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  const from = startMinute ?? 0;
  const to = endMinute ?? 1_439;
  if (from === to) return true;
  if (from < to) return current >= from && current <= to;
  return current >= from || current <= to;
}

export function nextWindowOpen(start: string | null | undefined, end: string | null | undefined, now = Date.now()): number | null {
  if (windowAllows(start, end, now)) return null;
  const startMinute = windowMinute(start) ?? 0;
  const date = new Date(now);
  date.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
  let candidate = date.getTime();
  if (candidate <= now) {
    date.setDate(date.getDate() + 1);
    candidate = date.getTime();
  }
  return candidate;
}
