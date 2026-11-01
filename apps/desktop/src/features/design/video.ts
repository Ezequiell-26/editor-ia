import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { DesignFormat } from '../../services/project-service';
import {
  captureDesignElement,
  captureDesignFrame,
  designFormatSize,
  mountDesign,
  type MountedDesign,
} from './rasterize';

/**
 * Convierte un diseño HTML seguro en un MP4 corto con WebCodecs del WebView2
 * y mp4-muxer (MIT). Soporta animaciones CSS (se pausan y se avanzan frame a
 * frame) y agrega una entrada de opacidad para que un diseño estático también
 * tenga movimiento. No ejecuta scripts ni usa Chrome/GSAP.
 */
export interface DesignVideoOptions {
  readonly durationSeconds?: number;
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly frameCapture?: (
    mounted: MountedDesign,
    animationTimeMs: number,
  ) => Promise<HTMLCanvasElement>;
}

export interface DesignVideoResult {
  readonly blob: Blob;
  readonly url: string;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly scenes: number;
}

const VP9_CODEC = 'vp09.00.10.08';

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function nextFrame(window: Window): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export async function renderDesignToVideo(
  html: string,
  format: DesignFormat,
  options: DesignVideoOptions = {},
): Promise<DesignVideoResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Este WebView2 no soporta WebCodecs; no se puede crear el video.');
  }
  const durationSeconds = Math.min(30, Math.max(1, options.durationSeconds ?? 3));
  const fps = Math.min(60, Math.max(10, Math.round(options.fps ?? 15)));
  const mounted = await mountDesign(html, format, {
    width: Math.max(64, Math.round(options.width ?? designFormatSize(format).width)),
    height: Math.max(64, Math.round(options.height ?? designFormatSize(format).height)),
  });
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: VP9_CODEC,
      width: mounted.width,
      height: mounted.height,
      bitrate: 4_000_000,
      framerate: fps,
    }).catch(() => null);
    if (!support?.supported) {
      throw new Error('Este equipo no puede codificar VP9 con WebCodecs.');
    }
    // Las animaciones CSS del diseño (si existen) se avanzan con el reloj del
    // video. El zoom de entrada se compone en canvas para que también se mueva
    // un diseño estático.
    const animations = mounted.frameDocument.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    await nextFrame(mounted.frameWindow);

    const config = {
      codec: VP9_CODEC,
      width: mounted.width,
      height: mounted.height,
      bitrate: 4_000_000,
      framerate: fps,
      latencyMode: 'quality' as const,
    };
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'vp9',
        width: mounted.width,
        height: mounted.height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });
    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encodeError = error instanceof Error ? error : new Error(String(error));
      },
    });
    encoder.configure(config);
    const slideNodes =
      format === 'deck'
        ? [...mounted.frameDocument.querySelectorAll<HTMLElement>('[data-slide], .slide')]
        : [];
    const slideFrames: HTMLCanvasElement[] = [];
    for (const slide of slideNodes) {
      slideFrames.push(await captureDesignElement(mounted, slide));
    }
    const scenes = Math.max(1, slideFrames.length);
    const secondsPerScene = durationSeconds / scenes;
    const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
    const frameDuration = Math.round(1_000_000 / fps);
    for (let index = 0; index < totalFrames; index += 1) {
      if (encodeError) throw encodeError;
      const timeSeconds = index / fps;
      let captured: HTMLCanvasElement;
      let progress: number;
      if (slideFrames.length > 0) {
        const scene = Math.min(
          slideFrames.length - 1,
          Math.floor(timeSeconds / secondsPerScene),
        );
        const sceneStart = scene * secondsPerScene;
        progress = Math.min(
          1,
          Math.max(0, (timeSeconds - sceneStart) / Math.max(secondsPerScene, 1 / fps)),
        );
        captured = slideFrames[scene]!;
      } else {
        const timeMs = timeSeconds * 1000;
        for (const animation of animations) {
          try {
            animation.currentTime = timeMs;
          } catch {
            // Una animación ya cancelada no debe romper el video.
          }
        }
        await nextFrame(mounted.frameWindow);
        captured = options.frameCapture
          ? await options.frameCapture(mounted, timeMs)
          : await captureDesignFrame(mounted, timeMs);
        progress = totalFrames > 1 ? index / (totalFrames - 1) : 0;
      }
      const canvas = document.createElement('canvas');
      canvas.width = mounted.width;
      canvas.height = mounted.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar el frame del video.');
      const source = captured.getContext('2d');
      const corner = source?.getImageData(0, 0, 1, 1).data;
      context.fillStyle = corner
        ? `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})`
        : '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const drawZoomed = (
        source: HTMLCanvasElement,
        sceneProgress: number,
        offsetX = 0,
      ) => {
        const eased = sceneProgress * sceneProgress * (3 - 2 * sceneProgress);
        // Zoom out muy leve por escena: mueve el diseño sin recortar los bordes.
        const scale = 1.015 - 0.015 * eased;
        const drawWidth = canvas.width * scale;
        const drawHeight = canvas.height * scale;
        context.drawImage(
          source,
          (canvas.width - drawWidth) / 2 + offsetX,
          (canvas.height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
      };
      const nextSlide =
        slideFrames.length > 0 && timeSeconds < durationSeconds
          ? slideFrames[Math.min(
              slideFrames.length - 1,
              Math.floor(timeSeconds / secondsPerScene) + 1,
            )]
          : undefined;
      const transition = Math.min(0.35, secondsPerScene * 0.3);
      const sceneEnd = (Math.floor(timeSeconds / secondsPerScene) + 1) * secondsPerScene;
      const inTransition =
        slideFrames.length > 1 &&
        nextSlide !== captured &&
        transition > 0 &&
        timeSeconds >= sceneEnd - transition;
      if (inTransition && nextSlide) {
        // Deslizamiento lateral: evita el texto fantasma de un crossfade.
        const progressTransition = (timeSeconds - (sceneEnd - transition)) / transition;
        drawZoomed(nextSlide, 0, canvas.width * (1 - progressTransition));
        drawZoomed(captured, progress, -canvas.width * progressTransition);
      } else {
        drawZoomed(captured, progress);
      }
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((index * 1_000_000) / fps),
        duration: frameDuration,
      });
      encoder.encode(frame, { keyFrame: index % fps === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    return {
      blob,
      url: URL.createObjectURL(blob),
      base64: bufferToBase64(target.buffer),
      width: mounted.width,
      height: mounted.height,
      durationSeconds,
      fps,
      scenes,
    };
  } finally {
    mounted.dispose();
  }
}
