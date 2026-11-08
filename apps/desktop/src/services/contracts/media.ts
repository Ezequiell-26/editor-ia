import type { AudioPeaks, AudioScopeData, AudioScopeRange, AudioTrack, CloneEngine, CloneProgress, CloneVoiceRequest, CloneVoiceResult, DialoguePreset, DialogueProgress, DialogueRequest, DialogueResult, DiarizeProviderInfo, DiarizeResult, DubCue, DubProgress, DubResult, FileLoudness, LipSyncProgress, LipSyncRequest, LipSyncResult, LoudnessAnalysisProgress, LoudnessSummary, MixLoudnessReport, MixLoudnessSample, SynthesizeDubRequest, VoiceIsolationOutcome, VoiceIsolationStatus } from './audio';
import type { AudioProviderInfo, CapabilityInfo, EncoderPreference, ExecutableInfo, ExportCapabilities, HardwareEncoders, ModelInfo, ProviderInfo, ProviderTestResult, ProviderTestStatus, SystemInfo } from './providers';
import type { Asset, Clip, Track } from '@editor-ia/project-schema';

export interface ProxyInfo {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export interface SampledColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// ───────────────────────── Fase 1 · Proxies ─────────────────────────
// Contrato nativo: comandos `proxy_status`, `ensure_proxy`, `cancel_proxy`,
// `cleanup_proxies` (evento `proxy-progress`). El proxy es un MP4 H.264 de
// vista previa guardado en `<root>/media/proxies/` y cacheado por asset,
// calidad y huella del origen (mtime + bytes). Navegador: rechazo con
// NATIVE_UNAVAILABLE_REASON. El fake devuelve estados deterministas.

export type ProxyQuality = '540p' | '720p';

export type ProxyState =
  | 'missing'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'cancelled'
  | 'failed';

export interface ProxyStatus {
  readonly assetId: string;
  readonly state: ProxyState;
  /** Calidad del proxy actual o de la generación en curso. */
  readonly quality: ProxyQuality | null;
  /** Ruta relativa al proyecto (`media/proxies/...`); null si no hay proxy. */
  readonly path: string | null;
  /** Hay un proxy verificado para este asset. */
  readonly exists: boolean;
  /** El proxy corresponde al origen actual (mtime+bytes del medio). */
  readonly upToDate: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly bytes: number | null;
  readonly durationSeconds: number | null;
  /** 0–100; 100 cuando está listo. */
  readonly percent: number;
  /** `queued` | `encoding` | `verifying` | `ready` | `failed` | `cancelled`. */
  readonly phase: string;
  readonly error: string | null;
  readonly sourceMtimeMs: number | null;
  readonly updatedAtMs: number;
}

export interface ProxyProgressEvent {
  readonly assetId: string;
  readonly quality: ProxyQuality;
  readonly state: ProxyState;
  readonly percent: number;
  readonly phase: string;
}

export interface ProxyCleanupResult {
  readonly removed: number;
  readonly bytesFreed: number;
}

export interface SceneCut {
  readonly frame: number;
  readonly seconds: number;
}

export interface SceneDetection {
  readonly cuts: SceneCut[];
  readonly durationFrames: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly threshold: number;
}

export interface StabilizationAnalysis {
  readonly path: string;
  readonly smoothing: number;
  readonly inFrame: number;
  readonly outFrame: number;
}

export interface AnalysisRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface MediaAnalysis {
  readonly assetId: string;
  readonly kind: 'video' | 'audio';
  readonly durationSeconds: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly hasAudio: boolean;
  readonly scenes: readonly number[];
  readonly silences: readonly AnalysisRange[];
  readonly blacks: readonly AnalysisRange[];
  readonly freezes: readonly AnalysisRange[];
  readonly loudness: LoudnessSummary | null;
  readonly lumaAverage: number | null;
  readonly saturationAverage: number | null;
  readonly warnings: readonly string[];
}

export type ConversionTarget =
  | 'png'
  | 'jpg'
  | 'webp'
  | 'bmp'
  | 'tiff'
  | 'mp4'
  | 'mkv'
  | 'webm'
  | 'mov'
  | 'avi'
  | 'flv'
  | 'ts'
  | 'gif'
  | 'hevc'
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'aac'
  | 'ogg'
  | 'opus'
  | 'flac';

export interface EnhanceOptions {
  readonly denoise?: boolean;
  readonly sharpen?: boolean;
  readonly normalizeAudio?: boolean;
}

export interface ConversionRequest {
  readonly assetId: string;
  readonly target: ConversionTarget;
  readonly outputDir: string;
  readonly quality?: number;
  readonly maxWidth?: number;
  readonly encoder?: EncoderPreference;
  readonly enhance?: EnhanceOptions;
}

/** Resultado del sondeo completo de un archivo (inspector de medios). */
export interface MediaProbe {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number | null;
  readonly formatName: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  /** Timecode SMPTE de inicio (NDF) de la fuente; null si no lo trae. */
  readonly timecode: string | null;
}

/** Compresión de un archivo suelto del disco, sin proyecto abierto. */
export interface CompressAnyRequest {
  readonly inputPath: string;
  readonly outputDir: string;
  /** mp4, mkv o hevc. */
  readonly target: 'mp4' | 'mkv' | 'hevc';
  /** quality o size. */
  readonly mode: 'quality' | 'size';
  readonly quality?: number;
  readonly targetMegabytes?: number;
  readonly maxWidth?: number;
  readonly audioKbps?: number;
}

export interface VisualEffectParameter {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit: string;
}

export interface VisualEffectSpec {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly filters: readonly string[];
  readonly available: boolean;
  readonly parameters: readonly VisualEffectParameter[];
}

export interface VisualPresetSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly settings: Record<string, unknown>;
}

export interface VisualTransitionSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultFrames: number;
  readonly maxFrames: number;
  readonly overlapsPrevious: boolean;
  readonly available: boolean;
}

export interface VisualFilterSupport {
  readonly name: string;
  readonly label: string;
  readonly available: boolean;
}

export interface VisualCatalog {
  readonly ffmpegAvailable: boolean;
  readonly effects: readonly VisualEffectSpec[];
  readonly presets: readonly VisualPresetSpec[];
  readonly transitions: readonly VisualTransitionSpec[];
  readonly filters: readonly VisualFilterSupport[];
}

export interface VisualFinding {
  readonly severity: 'error' | 'warning' | 'info' | string;
  readonly code: string;
  readonly message: string;
  readonly clipId: string | null;
  readonly clipLabel: string | null;
}

export interface VisualAudit {
  readonly clipsScanned: number;
  readonly transitions: number;
  readonly effectsClips: number;
  readonly findings: readonly VisualFinding[];
}

/** Resultado del upscale ×4. */
export interface UpscaleResult {
  readonly path: string;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly tiles: number;
}

/** Resultado del upscale ×4 de video (Real-ESRGAN frame a frame). */
export interface UpscaleVideoResult {
  readonly path: string;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly frames: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

/** Progreso del upscale de video (0–100, por frame procesado). */
export interface UpscaleProgress {
  readonly percent: number;
  readonly frame?: number;
  readonly total?: number;
}

/** Resultado de quitar el fondo de una imagen. */
export interface BackgroundRemoval {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

/** Progreso del recorte automático de fondo en video (0–100). */
export interface BackgroundProgress {
  readonly percent: number;
}

export interface BackgroundRemovalRequest {
  readonly path: string;
  readonly kind: 'image' | 'video';
  readonly inFrame: number;
  readonly outFrame: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

/** Lote de PNG RGBA (base64) que el motor Lottie rasteriza para una secuencia. */
export interface AlphaFramesRequest {
  readonly token: string;
  readonly startIndex: number;
  readonly frames: readonly string[];
}

/** Cierra una secuencia temporal: la codifica con alfa y la importa a Medios. */
export interface AlphaSequenceRequest {
  readonly token: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

/** Modo y preajuste de Denoise Studio. */
export type DenoiseMode = 'video' | 'image';

export type DenoisePreset = 'fast' | 'balanced' | 'quality';

/** Pedido de reducción de ruido de imagen o video. */
export interface DenoiseRequest {
  readonly inputPath: string;
  readonly outputDir?: string | null;
  readonly mode: DenoiseMode;
  readonly preset: DenoisePreset;
  readonly strength?: number;
  readonly temporal?: boolean;
  readonly preserveDetail?: boolean;
}

/** Resultado del render de Denoise Studio. */
export interface DenoiseResult {
  readonly path: string;
  readonly bytes: number;
  readonly sourceBytes: number;
  readonly filter: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSeconds: number | null;
}

/** Progreso en vivo del render de denoise. */
export interface DenoiseProgress {
  readonly percent: number;
}

/** Modo de la cadena de definición. */
export type SharpenMode = 'video' | 'image';

/**
 * Pedido de definición: las cinco etapas ya resueltas. El preset lo resuelve la
 * vista para que los controles muestren el valor real que se va a aplicar.
 */
export interface SharpenRequest {
  readonly inputPath: string;
  readonly outputDir?: string | null;
  readonly mode: SharpenMode;
  /** Limpieza temporal, 0–100. 0 apaga el suavizado. */
  readonly denoise?: number;
  /** De-blocking de compresión, independiente de `denoise`. */
  readonly deblock?: boolean;
  /** Altura destino; 0 deja la resolución original. */
  readonly targetHeight?: number;
  /** Escalar en un espacio de trabajo de 16 bits por canal. */
  readonly highPrecision?: boolean;
  /** Cantidad de la máscara de enfoque, 0–3. */
  readonly unsharpAmount?: number;
  /** Tamaño de la matriz de la máscara: 3, 5, 7 o 9. */
  readonly unsharpSize?: number;
  /** Fuerza de la curva S, 0–100. */
  readonly curve?: number;
  /** Intensidad del grano, 0–3 (%). */
  readonly grain?: number;
  readonly preset?: string | null;
}

/** Resultado del render de definición. */
export interface SharpenResult {
  readonly path: string;
  readonly bytes: number;
  readonly sourceBytes: number;
  readonly filter: string;
  readonly encoder: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly sourceWidth: number | null;
  readonly sourceHeight: number | null;
  readonly durationSeconds: number | null;
  readonly preset: string | null;
}

/** Progreso en vivo del render de definición. */
export interface SharpenProgress {
  readonly percent: number;
}

/** Exportación de una miniatura compuesta en el canvas. */
export interface ThumbnailExportRequest {
  readonly dataUrl: string;
  readonly outputDir: string;
  readonly fileName?: string;
}

export interface ThumbnailExportResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface BestFrameRequest {
  readonly path: string;
}

export interface FcpxmlRequest {
  readonly project: unknown;
  readonly outputDir: string;
}

export interface FcpxmlResult {
  readonly path: string;
  readonly bytes: number;
  readonly clips: number;
  readonly warnings: readonly string[];
}

export interface OtioRequest {
  readonly project: unknown;
  readonly outputDir: string;
}

export interface OtioResult {
  readonly path: string;
  readonly bytes: number;
  readonly tracks: number;
  readonly clips: number;
  readonly warnings: readonly string[];
}

export interface EdlRequest {
  readonly project: unknown;
  readonly outputDir: string;
}

export interface EdlResult {
  readonly path: string;
  readonly bytes: number;
  readonly events: number;
  readonly warnings: readonly string[];
}

export interface TimelineImportRequest {
  readonly project: unknown;
  readonly path: string;
  readonly confirmRights: boolean;
}

export interface TimelineImportResult {
  readonly format: 'edl' | 'otio' | 'fcpxml';
  readonly path: string;
  readonly assets: readonly Asset[];
  readonly tracks: readonly Track[];
  readonly clips: readonly Clip[];
  readonly warnings: readonly string[];
  readonly importedClips: number;
  readonly newAssets: number;
  readonly reusedAssets: number;
}

export interface LookLutRequest {
  readonly outputDir: string;
  readonly title?: string;
  readonly effects: unknown;
}

export interface LookLutResult {
  readonly path: string;
  readonly bytes: number;
  readonly size: number;
}

export interface ScopeGrid {
  readonly columns: number;
  readonly rows: number;
  readonly data: readonly number[];
}

export interface ScopeFrameResult {
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  readonly waveform: ScopeGrid;
  readonly vectorscope: ScopeGrid;
  readonly histogram: readonly [readonly number[], readonly number[], readonly number[]];
  readonly histogramY: readonly number[];
  readonly meanCbCr: readonly [number, number];
}

export interface PreviewFrameRequest {
  readonly project: unknown;
  readonly clipId: string;
  readonly frame: number;
  /** Pide el PNG a la resolución nativa del medio, no a la del lienzo. */
  readonly native?: boolean;
  /** Compone todas las pistas; `false` fuerza el clip aislado. */
  readonly composite?: boolean;
}

export interface PreviewFrameResult {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly timeSeconds: number;
  readonly clipId: string;
  readonly clipLabel: string;
  readonly native: boolean;
  readonly decoder: 'video-rs' | 'ffmpeg';
  /** Compuesto de todas las pistas visibles, subtítulos y look global. */
  readonly composite?: boolean;
  /** `window` renderiza sólo el frame; `full` recorre la timeline; `none` es el clip suelto. */
  readonly compositeMode?: 'window' | 'full' | 'none';
  readonly visibleTracks?: number;
  readonly captionsBurned?: boolean;
  /** Motivo por el que se devolvió el clip suelto en lugar del compuesto. */
  readonly fallbackReason?: string;
}

export interface BestThumbnailFrame {
  readonly path: string;
  readonly score: number;
  readonly timeSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface FaceTrackRequest {
  readonly path: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface FaceSample {
  readonly time: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly size: number;
}

export interface FaceTrackPoint {
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

export interface FaceTrackResult {
  readonly model: string;
  readonly durationSeconds: number;
  readonly detections: number;
  readonly samples: readonly FaceSample[];
  readonly track: readonly FaceTrackPoint[];
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  readonly xExpression: string;
  readonly yExpression: string;
}

export interface CompressRequest {
  readonly assetId: string;
  readonly outputDir: string;
  readonly target: 'mp4' | 'mkv' | 'hevc';
  /** `quality` usa CRF; `size` apunta a un tamaño en megabytes. */
  readonly mode: 'quality' | 'size';
  readonly quality?: number;
  readonly targetMegabytes?: number;
  readonly maxWidth?: number;
  readonly audioKbps?: number;
  readonly encoder?: EncoderPreference;
  readonly enhance?: EnhanceOptions;
}

export interface FlowGenerateFile {
  readonly path: string;
  readonly bytes?: number;
  readonly ext?: string;
}

export interface FlowGenerateResult {
  readonly ok: boolean;
  readonly files: readonly FlowGenerateFile[];
  readonly url?: string;
  readonly error?: string;
  readonly timedOut?: boolean;
}

export interface MatchMediaPlanResult {
  readonly assignments: readonly number[];
  readonly model: string;
}

/**
 * Contenido medido de una imagen por el backend (`commands/image_sense.rs`).
 * Es la materia prima del montaje inteligente: sin esto el emparejamiento sólo
 * puede mirar el nombre del archivo.
 */
export interface ImageContent {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  readonly orientation: 'landscape' | 'portrait' | 'square';
  readonly lumaMean: number;
  readonly lumaStd: number;
  readonly saturationMean: number;
  readonly colorfulness: number;
  readonly dominantHue: number;
  readonly hueConcentration: number;
  readonly temperature: 'warm' | 'cool' | 'neutral';
  readonly edgeDensity: number;
  readonly sharpness: number;
  readonly skyBias: number;
  readonly faceCount: number;
  readonly faceCenterX: number | null;
  readonly faceCenterY: number | null;
  readonly faceSize: number | null;
  readonly palette: readonly string[];
  /** Solo videos: segundo del que salió el cuadro analizado. */
  readonly sampledAtSeconds?: number | undefined;
  readonly warnings: readonly string[];
}
