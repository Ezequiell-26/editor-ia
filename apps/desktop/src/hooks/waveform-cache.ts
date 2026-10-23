import type { Asset } from '@editor-ia/project-schema';

const PREFIX = 'editor-ia.waveform.v1.';
const VERSION = 1;

export const MAX_CACHED_WAVEFORMS = 48;

export interface WaveformStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredWaveform {
  readonly version: number;
  readonly updatedAt: number;
  readonly peaks: number[];
}

function defaultStorage(): WaveformStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Content-addressed key: two imports or variants of the same audio share the
 * cache even when their paths differ. Falls back to the asset URL when the
 * project has no hash yet.
 */
export function waveformCacheKey(
  asset: Asset,
  url: string,
  buckets: number,
): string {
  const digest = asset.integrity?.sha256?.trim();
  const basis = digest || url;
  if (!basis || buckets <= 0) return '';
  return `${PREFIX}${basis}:${buckets}`;
}

export function readWaveformCache(
  key: string,
  expectedBuckets?: number,
  storage: WaveformStorage | null = defaultStorage(),
): number[] | null {
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWaveform>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.peaks)) return null;
    const peaks = parsed.peaks;
    if (peaks.length === 0 || peaks.length > 4_096) return null;
    if (expectedBuckets !== undefined && peaks.length !== expectedBuckets) return null;
    for (const value of peaks) {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      ) {
        return null;
      }
    }
    return peaks;
  } catch {
    return null;
  }
}

function prune(
  storage: WaveformStorage,
  maxEntries: number,
  keepKey: string,
): void {
  const entries: { key: string; updatedAt: number }[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(PREFIX) || key === keepKey) continue;
    let updatedAt = 0;
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? '{}') as {
        updatedAt?: unknown;
      };
      if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) {
        updatedAt = parsed.updatedAt;
      }
    } catch {
      // A malformed entry is pruned first.
    }
    entries.push({ key, updatedAt });
  }
  entries.sort((a, b) => a.updatedAt - b.updatedAt);
  const allowed = Math.max(0, maxEntries - 1);
  while (entries.length > allowed) {
    const oldest = entries.shift();
    if (!oldest) break;
    storage.removeItem(oldest.key);
  }
}

export function writeWaveformCache(
  key: string,
  peaks: readonly number[],
  storage: WaveformStorage | null = defaultStorage(),
  maxEntries = MAX_CACHED_WAVEFORMS,
): void {
  if (!key || !storage || peaks.length === 0) return;
  const payload = JSON.stringify({
    version: VERSION,
    updatedAt: Date.now(),
    peaks: [...peaks],
  } satisfies StoredWaveform);
  try {
    storage.setItem(key, payload);
  } catch {
    try {
      prune(storage, Math.max(1, Math.floor(maxEntries / 2)), key);
      storage.setItem(key, payload);
    } catch {
      return;
    }
  }
  prune(storage, maxEntries, key);
}

export function clearWaveformCache(
  storage: WaveformStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
