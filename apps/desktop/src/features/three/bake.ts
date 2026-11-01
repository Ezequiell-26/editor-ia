/**
 * Hornea una escena Three.js a un MP4 VP9 con WebCodecs + mp4-muxer.
 * El video resultante entra a Medios y se edita/exporta con el pipeline normal;
 * no se agrega un segundo renderizador al timeline.
 */
import {
  canvasVideoSize,
  encodeCanvasVideo,
  type CanvasVideoResult,
} from '../video/encode-canvas';
import { createThreeScene, type ThreePresetId } from './scene';

export interface Scene3DVideoOptions {
  readonly preset: ThreePresetId;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly durationSeconds?: number;
  readonly modelUrl?: string;
  readonly animation?: string;
  readonly text?: string;
  readonly textDepth?: number;
  readonly onProgress?: (progress: number) => void;
}

export interface Scene3DVideoResult extends CanvasVideoResult {
  readonly preset: ThreePresetId;
  readonly animation: { readonly name: string; readonly durationSeconds: number } | null;
  readonly animations: readonly string[];
}

export async function renderScene3DToVideo(
  options: Scene3DVideoOptions,
): Promise<Scene3DVideoResult> {
  const size = canvasVideoSize(options);
  const scene = await createThreeScene({
    preset: options.preset,
    width: size.width,
    height: size.height,
    ...(options.modelUrl ? { modelUrl: options.modelUrl } : {}),
    ...(options.animation ? { animation: options.animation } : {}),
    ...(options.text ? { text: options.text } : {}),
    ...(options.textDepth ? { textDepth: options.textDepth } : {}),
  });
  try {
    const video = await encodeCanvasVideo({
      ...size,
      renderFrame: (progress) => scene.renderAt(progress),
      onProgress: options.onProgress,
    });
    return {
      ...video,
      preset: options.preset,
      animation: scene.animation,
      animations: scene.animations,
    };
  } finally {
    scene.dispose();
  }
}
