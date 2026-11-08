
export interface RenderStarted {
  readonly jobId: string;
  readonly profileName: string;
}

/** Rango de frames del proyecto que se exporta; `end` es exclusivo. */
export interface RenderRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface RenderProgressEvent {
  readonly jobId: string;
  readonly percent: number;
  readonly processedSeconds: number;
  readonly totalSeconds: number;
  readonly phase: string;
}

export interface RenderFinishedEvent {
  readonly jobId: string;
  readonly status: 'completed' | 'failed' | 'cancelled' | string;
  readonly code: string | null;
  readonly message: string | null;
  readonly detail: string | null;
  readonly outputPath: string | null;
  readonly outputBytes: number | null;
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly elapsedMs: number;
  /** Reporte FFprobe del archivo entregado (sólo en `completed`). */
  readonly verification?: ExportVerification | null;
}

/** Exporta un rango de un asset como MP4 vertical 1080×1920. */
export interface ExportShortRequest {
  readonly path: string;
  readonly outputDir: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly label?: string;
  readonly smartReframe?: boolean;
}

export interface ExportShortResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly reframe: string;
  readonly facesDetected: number;
}

export interface ShortProgress {
  readonly percent: number;
}

/** Progreso en vivo de una compresión. */
export interface CompressProgress {
  readonly percent: number;
}

export interface ConversionResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number | null;
  readonly formatName: string;
  /** Tamaño del archivo de origen: con `bytes` da el ahorro logrado. */
  readonly sourceBytes: number;
  /** Encoder de video realmente usado (libx264, h264_nvenc, …). */
  readonly encoder: string;
}

export interface BatchConversionItem {
  readonly assetId: string;
  readonly label: string;
  readonly ok: boolean;
  readonly path?: string;
  readonly bytes?: number;
  readonly sourceBytes: number;
  readonly durationSeconds?: number | null;
  readonly formatName?: string;
  readonly encoder?: string;
  readonly message?: string;
}

export interface ConvertProgress {
  readonly index: number;
  readonly total: number;
  readonly label: string;
  readonly phase: 'start' | 'done';
  readonly ok: boolean;
}

/**
 * Reporte legible post-export, verificado con FFprobe (comando `verify_export`).
 * Se agrega a `RenderFinishedEvent.verification` cuando el render termina bien.
 */
export interface ExportVerification {
  readonly path: string;
  readonly container: string;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly pixelFormat: string | null;
  readonly videoBitrate: number | null;
  readonly audioBitrate: number | null;
  readonly colorSpace: string | null;
  readonly colorTransfer: string | null;
  readonly colorPrimaries: string | null;
  /** true sólo si el archivo reporta HDR (transfer PQ/HLG o 10-bit HDR). */
  readonly hdr: boolean;
  readonly durationSeconds: number | null;
  readonly bytes: number;
  readonly warnings: readonly string[];
}

export interface LosslessResult {
  readonly path: string;
  readonly bytes: number;
  readonly requestedSeconds: number;
  readonly actualSeconds: number;
  readonly startShiftSeconds: number;
}
