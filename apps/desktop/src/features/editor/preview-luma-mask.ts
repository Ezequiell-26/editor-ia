import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Asset, Clip, ProjectDocument } from '@editor-ia/project-schema';
import { useProjectStore } from '../../state/project-store';
import { previewTransitionLeadFrames, lumaWipeMateId } from './preview-transition';

/**
 * Máscara de luminancia del clip mate para `luma-wipe` en la preview DOM.
 *
 * El render (`luma_wipe_graph` en `render/ffmpeg.rs`) parte el clip entrante
 * por el lead y le copia el alfa desde la luma del mate (`scale2ref` +
 * `alphamerge`), cuadro a cuadro durante todo el solape. La preview no puede
 * correr ese filtergraph, así que este módulo reproduce la misma máscara con
 * canvas: dibuja el frame actual del mate en un lienzo chico, convierte cada
 * píxel a `(luma, luma, luma, luma)` — alfa = luminancia, así el PNG sirve
 * igual con `mask-mode` alpha o luminance— y lo expone como data URL para el
 * `mask-image` del wrapper de la transición.
 *
 * El tiempo del mate replica `src_at(t) = inFrame + (t - mateStart) * speed`
 * del renderer (el mate no admite speedCurve ni reverse, ver `luma_mate`).
 * Mate de imagen/freeze: un solo frame, la máscara es estática.
 *
 * Degradación honesta: si el mate no se puede decodificar (codec, CORS del
 * protocolo de medios, jsdom) no hay data URL y el caller deja la capa en
 * `opacity: 0` durante el lead — el mismo resultado visual que el corte
 * anterior, nunca una máscara inventada. La máscara puede llegar un frame
 * tarde respecto al playhead (el seek de `<video>` es asíncrono); durante
 * playback continuo queda a ≤1-2 frames del render.
 */

/** Resolución de la máscara: alcanza para el monitor y el PNG queda chico. */
const MASK_WIDTH = 160;
const MASK_HEIGHT = 90;

export interface LumaMaskSource {
  /** Clip entrante con `transitionIn.type === 'luma-wipe'`. */
  readonly clipId: string;
  readonly mateClipId: string;
  readonly asset: Asset;
  /** Segundos de fuente del mate en el frame del playhead (0 para imágenes). */
  readonly seconds: number;
  readonly isVideo: boolean;
}

/** `true` cuando el clip tiene `transitionIn` de tipo `luma-wipe`. */
export function isLumaWipeClip(clip: Clip): boolean {
  if (!('transitionIn' in clip)) return false;
  return (
    (clip as { transitionIn?: { type?: string } }).transitionIn?.type ===
    'luma-wipe'
  );
}

/**
 * Fuentes de máscara activas en el frame dado: clips con `luma-wipe` dentro
 * de su ventana de lead cuyo mate existe, está habilitado y apunta a un asset
 * listo. Fuera de la ventana no hay solicitud (la máscara no se usa).
 */
export function lumaMaskSources(
  project: ProjectDocument,
  playheadFrame: number,
  fps: number,
): LumaMaskSource[] {
  const clips = project.timeline.clips;
  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const sources: LumaMaskSource[] = [];
  for (const clip of clips) {
    const mateClipId = lumaWipeMateId(clip);
    if (!mateClipId) continue;
    const lead = previewTransitionLeadFrames(clip, fps);
    if (lead < 1) continue;
    if (playheadFrame < clip.startFrame - lead || playheadFrame >= clip.startFrame) {
      continue;
    }
    const mate = clips.find((candidate) => candidate.id === mateClipId);
    if (!mate || mate.enabled === false || mate.source.type !== 'asset') continue;
    const asset = assetById.get(mate.source.assetId);
    if (!asset || asset.status !== 'ready') continue;
    const isVideo = asset.kind === 'video';
    let seconds = 0;
    if (isVideo && 'inFrame' in mate.source) {
      const speed = 'speed' in mate ? mate.speed : undefined;
      const ratio = speed
        ? Math.max(0.01, speed.num / Math.max(1, speed.den))
        : 1;
      seconds = Math.max(
        0,
        (mate.source.inFrame + (playheadFrame - mate.startFrame) * ratio) / fps,
      );
    }
    sources.push({ clipId: clip.id, mateClipId, asset, seconds, isVideo });
  }
  return sources;
}

/**
 * Convierte píxeles RGBA en una máscara donde alfa = luminance Rec.601 (la
 * misma escala aproximada que `format=gray` de FFmpeg). Cada canal queda con
 * el valor de luminancia para que el PNG funcione con `mask-mode` alpha o
 * luminance.
 */
export function encodeLumaMask(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = Math.round(
      0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0),
    );
    out[i] = lum;
    out[i + 1] = lum;
    out[i + 2] = lum;
    out[i + 3] = lum;
  }
  return out;
}

/** Estilos `mask-image` para el wrapper de la transición con la data URL. */
export function lumaMaskStyle(url: string): CSSProperties {
  const mask = `url(${url})`;
  return {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  };
}

// ---- Muestreo en browser (canvas + elementos de media ocultos) ----

interface Canvases {
  readonly sample: CanvasRenderingContext2D;
  readonly mask: CanvasRenderingContext2D;
}

let canvases: Canvases | null = null;

function getCanvases(): Canvases | null {
  if (canvases) return canvases;
  if (typeof document === 'undefined') return null;
  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = MASK_WIDTH;
    sampleCanvas.height = MASK_HEIGHT;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = MASK_WIDTH;
    maskCanvas.height = MASK_HEIGHT;
    const sample = sampleCanvas.getContext('2d', { willReadFrequently: true });
    const mask = maskCanvas.getContext('2d');
    if (!sample || !mask) return null;
    canvases = { sample, mask };
    return canvases;
  } catch {
    return null;
  }
}

/** Dibuja el frame del mate y devuelve la máscara como data URL PNG. */
function drawLumaMask(source: CanvasImageSource): string | null {
  const ctx = getCanvases();
  if (!ctx) return null;
  try {
    ctx.sample.drawImage(source, 0, 0, MASK_WIDTH, MASK_HEIGHT);
    const image = ctx.sample.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT);
    const out = encodeLumaMask(image.data);
    ctx.mask.putImageData(new ImageData(out, MASK_WIDTH, MASK_HEIGHT), 0, 0);
    return ctx.mask.canvas.toDataURL('image/png');
  } catch {
    // Canvas tainted por CORS o codec no decodificable: sin máscara.
    return null;
  }
}

const MAX_POOL = 12;

interface VideoSlot {
  readonly video: HTMLVideoElement;
  want: number;
  busy: boolean;
  /** Se incrementa en cada pump: los timeouts viejos no matan seeks nuevos. */
  generation: number;
  waiters: Array<(url: string | null) => void>;
}

const videoSlots = new Map<string, VideoSlot>();
const imageMasks = new Map<string, string | null>();

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= MAX_POOL && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function pumpVideoSlot(url: string, slot: VideoSlot): void {
  if (slot.busy || slot.waiters.length === 0) return;
  const target = slot.want;
  const generation = ++slot.generation;
  // Sólo este lote se resuelve con el frame del seek actual; las peticiones
  // que lleguen durante el seek quedan para el próximo pump.
  const batch = slot.waiters.splice(0);
  slot.busy = true;
  const finish = (dataUrl: string | null) => {
    if (!slot.busy || slot.generation !== generation) return;
    slot.busy = false;
    for (const done of batch) done(dataUrl);
    pumpVideoSlot(url, slot);
  };
  const onSeeked = () => {
    slot.video.removeEventListener('seeked', onSeeked);
    finish(drawLumaMask(slot.video));
  };
  slot.video.addEventListener('seeked', onSeeked, { once: true });
  try {
    if (
      Math.abs(slot.video.currentTime - target) < 0.0005 &&
      slot.video.readyState >= 2
    ) {
      slot.video.removeEventListener('seeked', onSeeked);
      finish(drawLumaMask(slot.video));
      return;
    }
    slot.video.currentTime = target;
  } catch {
    slot.video.removeEventListener('seeked', onSeeked);
    finish(null);
    return;
  }
  // Red de seguridad: si el seek nunca resuelve (metadata rota), liberar.
  setTimeout(() => {
    if (slot.busy && slot.generation === generation) {
      slot.video.removeEventListener('seeked', onSeeked);
      finish(null);
    }
  }, 800);
}

function requestVideoMask(
  url: string,
  seconds: number,
  done: (dataUrl: string | null) => void,
): void {
  if (typeof document === 'undefined') {
    done(null);
    return;
  }
  let slot = videoSlots.get(url);
  if (!slot) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;
    slot = { video, want: seconds, busy: false, generation: 0, waiters: [] };
    remember(videoSlots, url, slot);
  }
  slot.want = seconds;
  slot.waiters.push(done);
  pumpVideoSlot(url, slot);
}

function requestImageMask(url: string, done: (dataUrl: string | null) => void): void {
  if (typeof document === 'undefined') {
    done(null);
    return;
  }
  if (imageMasks.has(url)) {
    done(imageMasks.get(url) ?? null);
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const dataUrl = img.naturalWidth > 0 ? drawLumaMask(img) : null;
    remember(imageMasks, url, dataUrl);
    done(dataUrl);
  };
  img.onerror = () => {
    remember(imageMasks, url, null);
    done(null);
  };
  img.src = url;
}

/** Path del medio del mate: proxy cuando existe (misma regla que VideoLayer). */
function mateMediaPath(asset: Asset): string | null {
  if (asset.source.type !== 'local') return null;
  const path = asset.source.path;
  if (!path) return null;
  if (asset.kind !== 'video') return path;
  const alpha = asset.media?.alpha === true;
  const proxy =
    !alpha && 'proxy' in asset
      ? (asset as Asset & { proxy?: { path?: string } }).proxy?.path
      : undefined;
  return proxy ?? path;
}

/**
 * Devuelve `clipId → dataURL` de la máscara de luminancia para los clips con
 * `luma-wipe` cuyo lead cubre el playhead. La máscara se mantiene entre
 * frames (el seek es asíncrono): puede quedar 1-2 frames por detrás del
 * render, nunca inventada.
 */
export function useLumaWipeMasks(
  project: ProjectDocument | null,
  playheadFrame: number,
  fps: number,
): ReadonlyMap<string, string> {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const service = store.service;
  const [masks, setMasks] = useState<ReadonlyMap<string, string>>(() => new Map());

  const sources = useMemo(
    () => (project ? lumaMaskSources(project, playheadFrame, fps) : []),
    [project, playheadFrame, fps],
  );

  useEffect(() => {
    if (sources.length === 0) return;
    let alive = true;
    const apply = (entries: ReadonlyArray<readonly [string, string]>) => {
      if (!alive || entries.length === 0) return;
      setMasks((previous) => {
        const next = new Map(previous);
        let changed = false;
        for (const [clipId, url] of entries) {
          if (next.get(clipId) !== url) {
            next.set(clipId, url);
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    };
    // Un mismo mate+frame puede alimentar varios clips: se agrupa por
    // medio y segundo para no duplicar seeks ni canvas.
    const groups = new Map<
      string,
      { url: string; isVideo: boolean; seconds: number; clipIds: string[] }
    >();
    for (const source of sources) {
      const path = mateMediaPath(source.asset);
      if (!path) continue;
      const url = service.mediaUrl(root, path);
      const key = `${source.isVideo ? 'v' : 'i'}|${url}|${Math.round(source.seconds * fps)}`;
      const group = groups.get(key);
      if (group) {
        group.clipIds.push(source.clipId);
      } else {
        groups.set(key, {
          url,
          isVideo: source.isVideo,
          seconds: source.seconds,
          clipIds: [source.clipId],
        });
      }
    }
    for (const group of groups.values()) {
      const done = (dataUrl: string | null) => {
        if (!dataUrl) return;
        apply(group.clipIds.map((clipId) => [clipId, dataUrl] as const));
      };
      if (group.isVideo) {
        requestVideoMask(group.url, group.seconds, done);
      } else {
        requestImageMask(group.url, done);
      }
    }
    return () => {
      alive = false;
    };
  }, [sources, service, root, fps]);

  return masks;
}
