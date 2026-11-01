/**
 * Hornea un ciclo de rig 2D a MP4 VP9. Usa el mismo codificador compartido que
 * la escena 3D: el clip entra a Medios y el timeline/export no cambian.
 */
import {
  encodeCanvasVideo,
  type CanvasVideoResult,
} from '../video/encode-canvas';
import {
  drawRigFrame,
  rigPaletteById,
  type RigClipId,
} from './rig';

export interface RigVideoOptions {
  readonly clip: RigClipId;
  readonly paletteId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly durationSeconds?: number;
  readonly target?: { readonly x: number; readonly y: number };
  readonly onProgress?: (progress: number) => void;
}

export interface RigVideoResult extends CanvasVideoResult {
  readonly clip: RigClipId;
  readonly paletteId: string;
}

export async function renderRigToVideo(
  options: RigVideoOptions,
): Promise<RigVideoResult> {
  const palette = rigPaletteById(options.paletteId ?? 'cyan');
  const video = await encodeCanvasVideo({
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationSeconds: options.durationSeconds,
    onProgress: options.onProgress,
    renderFrame: (progress, _index, { canvas, context }) => {
      drawRigFrame(
        context,
        canvas.width,
        canvas.height,
        options.clip,
        progress,
        palette.palette,
        options.target ? { target: options.target } : {},
      );
    },
  });
  return { ...video, clip: options.clip, paletteId: palette.id };
}
