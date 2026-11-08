import type { ExportVerification, LosslessResult, RenderFinishedEvent, RenderProgressEvent, RenderRange, RenderStarted } from '../render';
import type { ExportCapabilities, HardwareEncoders } from '../providers';
import type { VariantRendered } from '../projects';
import type { RenderQueueEntry } from '../../../state/render-queue';
import type { UnlistenFn } from '../events';

export interface DesktopServiceRender {
/** Corta un rango de un archivo sin recodificar (copia de paquetes). */
  exportLossless(input: {
    input: string;
    output: string;
    startSeconds: number;
    endSeconds: number;
    exact?: boolean;
  }): Promise<LosslessResult>;

hardwareEncoders(): Promise<HardwareEncoders>;

/** Matriz real de contenedores/cÃ³decs/pixel format que este FFmpeg soporta. */
  exportCapabilities(): Promise<ExportCapabilities>;

/** Verifica un archivo exportado con FFprobe y devuelve un reporte legible. */
  verifyExport(path: string): Promise<ExportVerification>;

renderProjectVariant(input: {
    projectPath: string;
    profileId: string;
    outputPath: string;
    includeCaptions: boolean;
    motionPlans?: Record<string, unknown>;
  }): Promise<VariantRendered>;

startRender(
    profileId: string | null,
    includeCaptions: boolean,
    motionPlans?: Record<string, unknown>,
    hardwareEncoder?: string | null,
    range?: RenderRange,
  ): Promise<RenderStarted | null>;

startRenderTo(
    profileId: string,
    outputPath: string,
    includeCaptions: boolean,
    motionPlans?: Record<string, unknown>,
    hardwareEncoder?: string | null,
    range?: RenderRange,
  ): Promise<RenderStarted | null>;

chooseExportDirectory(): Promise<string | null>;

cancelRender(jobId: string): Promise<void>;

activeRender(): Promise<string | null>;

pruneRenderCache(): Promise<number>;

/**
   * Cola de entregas persistida en el backend (JSON en app-data). `null`
   * cuando el runtime no la soporta; la UI conserva localStorage como respaldo.
   */
  renderQueueLoad(): Promise<RenderQueueEntry[] | null>;

renderQueueSave(queue: readonly RenderQueueEntry[]): Promise<void>;

renderQueueClearFinished(): Promise<RenderQueueEntry[] | null>;

onRenderProgress(handler: (event: RenderProgressEvent) => void): Promise<UnlistenFn>;

onRenderFinished(handler: (event: RenderFinishedEvent) => void): Promise<UnlistenFn>;
}

