/**
 * Conversión compartida de un Lottie ya parseado a un asset VP9 con alfa.
 *
 * La usan el importador de archivos y la biblioteca MIT: un solo camino de
 * rasterizado evita que la preview y el archivo final difieran. El caller es
 * dueño de agregar el asset al proyecto y de mostrar el aviso.
 */
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../../services/project-service';
import { newId } from '../../state/project-actions';
import {
  createLottieRasterizer,
  type LottieDocument,
  type LottieExportPlan,
} from './lottie';

const BATCH_SIZE = 8;

export interface RasterizeLottieInput {
  readonly service: DesktopService;
  readonly document: LottieDocument;
  readonly plan: LottieExportPlan;
  readonly label: string;
  readonly onProgress?: (percent: number) => void;
}

export async function rasterizeLottieToAsset(input: RasterizeLottieInput): Promise<Asset> {
  const { service, document, plan, label, onProgress } = input;
  const token = newId();
  let rasterizer: Awaited<ReturnType<typeof createLottieRasterizer>> | null = null;
  let wroteFrames = false;
  try {
    rasterizer = await createLottieRasterizer(document, plan);
    for (let start = 0; start < plan.frameCount; start += BATCH_SIZE) {
      const end = Math.min(plan.frameCount, start + BATCH_SIZE);
      const frames: string[] = [];
      for (let index = start; index < end; index += 1) {
        frames.push(await rasterizer.renderFrame(index));
      }
      await service.writeAlphaFrames({ token, startIndex: start, frames });
      wroteFrames = true;
      onProgress?.(Math.round((end / plan.frameCount) * 100));
    }
    return await service.alphaFramesToAsset({
      token,
      label,
      width: plan.width,
      height: plan.height,
      frameCount: plan.frameCount,
      fpsNum: plan.fpsNum,
      fpsDen: plan.fpsDen,
    });
  } catch (error) {
    if (wroteFrames) {
      await service.discardAlphaFrames(token).catch(() => {});
    }
    throw error;
  } finally {
    rasterizer?.dispose();
  }
}
