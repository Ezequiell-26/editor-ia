import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';

const DEFAULT_BUCKETS = 180;

export type Waveform = readonly number[];

const peakCache = new Map<string, Waveform>();
const pending = new Map<string, Promise<Waveform | null>>();
const failed = new Set<string>();

/**
 * Reduces a decoded channel into normalized peak buckets. Kept pure so the
 * timeline can be tested without Web Audio.
 */
export function computePeaks(samples: Float32Array, buckets = DEFAULT_BUCKETS): number[] {
  if (samples.length === 0 || buckets <= 0) return [];
  const peaks = new Array<number>(buckets).fill(0);
  const size = Math.max(1, Math.ceil(samples.length / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * size;
    if (start >= samples.length) break;
    const end = Math.min(samples.length, start + size);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[bucket] = peak;
  }
  const loudest = peaks.reduce((max, value) => (value > max ? value : max), 0);
  if (loudest <= 0.00001) return peaks;
  return peaks.map((value) => Math.min(1, Math.sqrt(value / loudest)));
}

/** Cuts the asset-level waveform down to the clip's source window. */
export function peaksForWindow(
  peaks: Waveform,
  inFrame: number,
  outFrame: number,
  totalFrames: number,
): number[] {
  if (peaks.length === 0) return [];
  if (totalFrames <= 0) return [...peaks];
  const from = Math.max(0, Math.min(peaks.length - 1, Math.floor((inFrame / totalFrames) * peaks.length)));
  const to = Math.max(
    from + 1,
    Math.min(peaks.length, Math.ceil((outFrame / totalFrames) * peaks.length)),
  );
  return peaks.slice(from, to);
}

function canDecode(): boolean {
  return typeof OfflineAudioContext !== 'undefined';
}

async function decodeWaveform(url: string, buckets: number): Promise<Waveform | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const context = new OfflineAudioContext(1, 1, 48_000);
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.numberOfChannels === 0) return null;
    const channel = buffer.getChannelData(0);
    return computePeaks(channel, buckets);
  } catch {
    return null;
  }
}

/**
 * Lazily decodes an audio asset once per URL and returns peak buckets for the
 * timeline. Failures are cached as null so a missing codec never retries on
 * every render.
 */
export function useWaveform(
  service: DesktopService,
  root: string | null,
  asset: Asset | null,
  buckets = DEFAULT_BUCKETS,
): Waveform | null {
  const media = asset && 'media' in asset ? asset.media : undefined;
  const mediaFrames = media && 'durationFrames' in media ? media.durationFrames : 0;
  const frameRate =
    media && 'frameRate' in media
      ? (media as { frameRate?: { num: number; den: number } }).frameRate
      : undefined;
  const mediaFps = frameRate ? frameRate.num / Math.max(1, frameRate.den) : 30;
  // Keep the WebView light: decoding ten-minute assets at native sample rate
  // costs hundreds of MB. Very long media simply renders without a waveform.
  const tooLong = mediaFrames > 0 && mediaFrames / mediaFps > 600;
  const relative =
    asset && !tooLong && (asset.kind === 'audio' || asset.kind === 'video')
      ? asset.source.path
      : null;
  const url = relative && root && service.available ? service.mediaUrl(root, relative) : '';
  const key = url ? `${url}:${buckets}` : '';
  const [peaks, setPeaks] = useState<Waveform | null>(() => (key ? peakCache.get(key) ?? null : null));

  useEffect(() => {
    if (!url || !canDecode()) {
      setPeaks(null);
      return;
    }
    const hit = peakCache.get(key);
    if (hit) {
      setPeaks(hit);
      return;
    }
    if (failed.has(key)) {
      setPeaks(null);
      return;
    }
    let active = true;
    let request = pending.get(key);
    if (!request) {
      request = decodeWaveform(url, buckets).then((result) => {
        if (result) peakCache.set(key, result);
        else failed.add(key);
        return result;
      });
      pending.set(key, request);
    }
    request
      .then((result) => {
        if (active) setPeaks(result);
      })
      .catch(() => {
        if (active) setPeaks(null);
      })
      .finally(() => {
        pending.delete(key);
      });
    return () => {
      active = false;
    };
  }, [buckets, key, url]);

  return peaks;
}
