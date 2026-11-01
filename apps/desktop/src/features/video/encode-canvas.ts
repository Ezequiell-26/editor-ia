/**
 * Codifica una secuencia de canvas a MP4 VP9 con WebCodecs + mp4-muxer.
 * Lo comparten el horneado 3D y el rig 2D: el MP4 resultante entra a Medios y
 * se edita/exporta con el pipeline normal, sin un segundo renderizador.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

const VP9_CODEC = 'vp09.00.10.08';

export interface CanvasFrameTarget {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

export interface CanvasVideoOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fps?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly bitrate?: number | undefined;
  /**
   * Dibuja el frame `progress` (0..1). Puede dibujar en el contexto provisto o
   * devolver otra fuente (por ejemplo el canvas de Three.js).
   */
  readonly renderFrame: (
    progress: number,
    index: number,
    target: CanvasFrameTarget,
  ) => CanvasImageSource | void;
  readonly onProgress?: ((progress: number) => void) | undefined;
}

export interface CanvasVideoResult {
  readonly blob: Blob;
  readonly url: string;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly fps: number;
}

function even(value: number, minimum: number, maximum: number): number {
  const clamped = Math.min(maximum, Math.max(minimum, Math.round(value)));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

/** Dimensiones/fps/duración efectivos que usará `encodeCanvasVideo`. */
export function canvasVideoSize(options: {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fps?: number | undefined;
  readonly durationSeconds?: number | undefined;
}): { width: number; height: number; fps: number; durationSeconds: number } {
  return {
    width: even(options.width ?? 1280, 320, 1920),
    height: even(options.height ?? 720, 180, 1080),
    fps: Math.min(30, Math.max(10, Math.round(options.fps ?? 24))),
    durationSeconds: Math.min(10, Math.max(1, options.durationSeconds ?? 4)),
  };
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function previewProgress(index: number, total: number): number {
  return total > 1 ? index / (total - 1) : 1;
}

export async function encodeCanvasVideo(
  options: CanvasVideoOptions,
): Promise<CanvasVideoResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Este WebView2 no soporta WebCodecs; no se puede hornear el video.');
  }
  const { width, height, fps, durationSeconds } = canvasVideoSize(options);
  const bitrate = Math.round(options.bitrate ?? 6_000_000);
  const support = await VideoEncoder.isConfigSupported({
    codec: VP9_CODEC,
    width,
    height,
    bitrate,
    framerate: fps,
  }).catch(() => null);
  if (!support?.supported) {
    throw new Error('Este equipo no puede codificar VP9 con WebCodecs.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('El canvas 2D no está disponible; no se puede hornear el video.');
  }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'vp9', width, height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({
    codec: VP9_CODEC,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
  });
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const frameMicros = Math.round(1_000_000 / fps);
  try {
    for (let index = 0; index < totalFrames; index += 1) {
      if (encodeError) throw encodeError;
      const progress = totalFrames > 1 ? index / (totalFrames - 1) : 0;
      const source = options.renderFrame(progress, index, { canvas, context }) ?? canvas;
      const frame = new VideoFrame(source, {
        timestamp: index * frameMicros,
        duration: frameMicros,
      });
      encoder.encode(frame, { keyFrame: index % fps === 0 });
      frame.close();
      options.onProgress?.(previewProgress(index, totalFrames));
      while (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    await encoder.flush();
    muxer.finalize();
    const buffer = target.buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    return {
      blob,
      url: URL.createObjectURL(blob),
      base64: bufferToBase64(buffer),
      width,
      height,
      durationSeconds,
      fps,
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}
