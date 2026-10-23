// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
import { useWaveform } from './useWaveform';
import {
  MAX_CACHED_WAVEFORMS,
  clearWaveformCache,
  readWaveformCache,
  waveformCacheKey,
  writeWaveformCache,
  type WaveformStorage,
} from './waveform-cache';

const PREFIX = 'editor-ia.waveform.v1.';
const PEAKS = Array.from({ length: 180 }, (_, index) => (index % 10) / 10);

const ASSET = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'audio',
  label: 'voz.wav',
  source: { type: 'local', path: 'media/voz.wav' },
  status: 'ready',
  integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
  rights: {
    license: { id: 'owned', commercialUse: 'allowed' },
    provenance: { origin: 'user-imported', acquiredAt: '2026-10-20T00:00:00Z' },
  },
  media: { sampleRate: 48_000, channels: 1, durationFrames: 90 },
} as Asset;

beforeEach(() => {
  clearWaveformCache();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('waveform cache', () => {
  it('roundtrips peaks and uses the content hash, not the URL', () => {
    const first = waveformCacheKey(ASSET, 'asset://one.wav', 180);
    const second = waveformCacheKey(ASSET, 'asset://two.wav', 180);
    expect(first).toBe(second);
    writeWaveformCache(first, PEAKS);
    expect(readWaveformCache(first, 180)).toEqual(PEAKS);
    expect(readWaveformCache(first, 90)).toBeNull();
  });

  it('rejects old or corrupted entries', () => {
    const key = waveformCacheKey(ASSET, 'asset://one.wav', 180);
    localStorage.setItem(key, JSON.stringify({ version: 0, updatedAt: 1, peaks: PEAKS }));
    expect(readWaveformCache(key, 180)).toBeNull();
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, updatedAt: 1, peaks: [0, 2] }),
    );
    expect(readWaveformCache(key, 2)).toBeNull();
  });

  it('prunes the oldest entries past the cap', () => {
    for (let index = 0; index < MAX_CACHED_WAVEFORMS + 3; index += 1) {
      writeWaveformCache(`${PREFIX}entry-${index}:180`, PEAKS);
    }
    let count = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.startsWith(PREFIX)) count += 1;
    }
    expect(count).toBeLessThanOrEqual(MAX_CACHED_WAVEFORMS);
  });

  it('does not throw when storage rejects the write', () => {
    const storage: WaveformStorage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(() => writeWaveformCache('key', PEAKS, storage)).not.toThrow();
  });
});

describe('useWaveform cache hit', () => {
  it('uses the persisted waveform without decoding or fetching', () => {
    const url = 'asset://voz.wav';
    const key = waveformCacheKey(ASSET, url, 180);
    writeWaveformCache(key, PEAKS);
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no debería bajar')));
    vi.stubGlobal('fetch', fetchSpy);
    const service = {
      available: true,
      mediaUrl: () => url,
    } as unknown as DesktopService;

    const { result } = renderHook(() => useWaveform(service, 'C:/obra', ASSET));

    expect(result.current).toEqual(PEAKS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
