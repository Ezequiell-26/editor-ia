import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
import {
  readWaveformCache,
  waveformCacheKey,
  writeWaveformCache,
} from './waveform-cache';

// 600 buckets ≈ 32 KB de JSON y sobra para el ancho de un clip; el backend
// (FFmpeg) tarda casi lo mismo con 600 que con 4000, pero el payload y la
// memoria no. Denominador común para timeline y beats.
const DEFAULT_BUCKETS = 600;

// El decode nativo usa FFmpeg compartido: limitar a 2 pedidos simultáneos
// evita que 4+ assets largos se ralenticen entre sí (medido por workspace:
// 4×10 min en paralelo ≈ 2 s c/u vs 528 ms en solitario).
const NATIVE_PEAK_CONCURRENCY = 2;
let activeNativeRequests = 0;
const nativeRequestQueue: Array<() => void> = [];

async function withNativePeakSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeNativeRequests >= NATIVE_PEAK_CONCURRENCY) {
    await new Promise<void>((resolve) => nativeRequestQueue.push(resolve));
  }
  activeNativeRequests += 1;
  try {
    return await task();
  } finally {
    activeNativeRequests -= 1;
    nativeRequestQueue.shift()?.();
  }
}

export type Waveform = readonly number[];

const MAX_PEAK_CACHE = 80;
const peakCache = new Map<string, Waveform>();

function cacheWaveformPeaks(key: string, value: Waveform): void {
  if (peakCache.size >= MAX_PEAK_CACHE) {
    const oldest = peakCache.keys().next().value;
    if (oldest !== undefined) {
      peakCache.delete(oldest);
    }
  }
  peakCache.set(key, value);
}

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
 * Picos reales decodificados por FFmpeg en el backend (`audio_peaks`).
 *
 * Es la fuente de verdad en la app nativa: evita el `fetch(asset://)` que el
 * protocolo de Tauri puede restringir y entrega min/max por bucket del audio
 * real, normalizados a [-1, 1]. Acá se colapsa a una envolvente de amplitud y
 * se normaliza con la misma curva que `computePeaks` para que el render
 * simétrico de la timeline muestre la forma de onda verdadera del medio.
 */
async function decodeNativePeaks(
  service: DesktopService,
  assetId: string,
  buckets: number,
): Promise<Waveform | null> {
  try {
    const result = await withNativePeakSlot(() => service.audioPeaks(assetId, buckets));
    // `result.buckets` es el efectivo del backend (clamp [16, 4000]); los picos
    // ya vienen con ese tamaño y son los que se dibujan.
    if (result.peaks.length === 0) return null;
    const amplitudes = result.peaks.map((peak) =>
      Math.min(1, Math.max(Math.abs(peak.min), Math.abs(peak.max))),
    );
    const loudest = amplitudes.reduce((max, value) => (value > max ? value : max), 0);
    if (loudest <= 0.00001) return amplitudes;
    return amplitudes.map((value) => Math.min(1, Math.sqrt(value / loudest)));
  } catch {
    // Asset no listo, sin FFmpeg o sin stream de audio: cae al fallback
    // WebAudio (navegador) o al render sin onda (honesto).
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
  const durationSeconds =
    mediaFrames > 0 && mediaFps > 0 ? mediaFrames / mediaFps : Number.POSITIVE_INFINITY;
  // Dos límites distintos: el nativo (FFmpeg, ~1,45 s para 30 min) puede con
  // assets largos; el fallback WebAudio decodifica PCM en el WebView
  // (~23 MB/min mono f32 a 48 kHz) y por eso se corta en 10 min.
  const tooLongForNative = durationSeconds > 1_800;
  const tooLongForWebAudio = durationSeconds > 600;
  // El backend clampa buckets a [16, 4000]; normalizar antes de usarlo en la
  // clave y en el cache para que lo pedido coincida con lo persistido.
  const bucketCount = Math.min(4_000, Math.max(16, Math.round(buckets)));
  const relative =
    asset && !tooLongForNative && (asset.kind === 'audio' || asset.kind === 'video')
      ? asset.source.path
      : null;
  const url = relative && root && service.available ? service.mediaUrl(root, relative) : '';
  // Fuente principal en nativo: FFmpeg (audio_peaks) con min/max reales. En
  // navegador puro (service.available=false) o sin audio decodificable se
  // intenta WebAudio; si tampoco hay datos la timeline dibuja el clip sin onda
  // (nunca picos inventados).
  const nativeEligible = Boolean(asset?.id) && service.available && !tooLongForNative;
  const webAudioEligible = canDecode() && Boolean(url) && !tooLongForWebAudio;
  // Con URL hay cache persistente content-addressed (digest); sin URL el
  // resultado nativo queda sólo en memoria para no escribir claves sin prefijo
  // en localStorage (que prune() no limpiaría).
  const persistable = Boolean(asset && url);
  const cacheKey =
    asset && url
      ? waveformCacheKey(asset, url, bucketCount)
      : nativeEligible && asset
        ? `native:${asset.id}:${bucketCount}`
        : '';
  const [peaks, setPeaks] = useState<Waveform | null>(() => {
    if (!cacheKey) return null;
    const memory = peakCache.get(cacheKey);
    if (memory) return memory;
    const stored = persistable ? readWaveformCache(cacheKey, bucketCount) : null;
    if (stored) peakCache.set(cacheKey, stored);
    return stored;
  });

  useEffect(() => {
    if (!cacheKey) {
      setPeaks(null);
      return;
    }
    const hit = peakCache.get(cacheKey);
    if (hit) {
      setPeaks(hit);
      return;
    }
    if (!nativeEligible && !webAudioEligible) {
      setPeaks(null);
      return;
    }
    if (failed.has(cacheKey)) {
      setPeaks(null);
      return;
    }
    let active = true;
    let request = pending.get(cacheKey);
    if (!request) {
      // Nativo: FFmpeg primero; si falla (asset sin audio, sin FFmpeg), se
      // intenta WebAudio sólo si hay URL, decoder y el asset no es demasiado
      // largo para decodificarlo en memoria.
      const primary: Promise<Waveform | null> =
        nativeEligible && asset
          ? decodeNativePeaks(service, asset.id, bucketCount).then((native) =>
              native ?? (webAudioEligible ? decodeWaveform(url, bucketCount) : null),
            )
          : webAudioEligible
            ? decodeWaveform(url, bucketCount)
            : Promise.resolve(null);
      request = primary.then((result) => {
        if (result) {
          cacheWaveformPeaks(cacheKey, result);
          if (persistable) writeWaveformCache(cacheKey, result);
        } else {
          failed.add(cacheKey);
        }
        return result;
      });
      pending.set(cacheKey, request);
    }
    request
      .then((result) => {
        if (active) setPeaks(result);
      })
      .catch(() => {
        if (active) setPeaks(null);
      })
      .finally(() => {
        pending.delete(cacheKey);
      });
    return () => {
      active = false;
    };
  }, [
    asset,
    bucketCount,
    cacheKey,
    nativeEligible,
    persistable,
    service,
    url,
    webAudioEligible,
  ]);

  return peaks;
}
