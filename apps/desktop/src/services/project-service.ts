import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AssetSchema,
  parseProject,
  type Asset,
  type Clip,
  type ProjectDocument,
  type Track,
} from '@editor-ia/project-schema';

/**
 * The UI's only door to the native side.
 *
 * The webview never touches the filesystem, a shell or a credential. It calls
 * typed methods; every project document returned by Rust is parsed with the
 * canonical schema before it can reach a screen, and every native error is
 * stripped of absolute paths before it is rendered.
 */

export interface OpenedProject {
  readonly project: ProjectDocument;
  readonly label: string;
  readonly path: string;
  readonly root: string;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

export interface ImportOutcome {
  readonly assets: Asset[];
  readonly warnings: string[];
}

export interface ExecutableInfo {
  readonly available: boolean;
  readonly path: string | null;
  readonly version: string | null;
  readonly hint: string | null;
}

export interface SystemInfo {
  readonly appVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly ffmpeg: ExecutableInfo;
  readonly ffprobe: ExecutableInfo;
  readonly powershell: ExecutableInfo;
  readonly hardware: HardwareEncoders;
  readonly configDir: string;
  readonly cacheDir: string;
}

export interface ProviderInfo {
  readonly kind: 'openai-compatible' | 'mock' | string;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly keyringAvailable: boolean;
}

export interface ScriptScenePlan {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly intent: 'hook' | 'context' | 'explainer' | 'demo' | 'proof' | 'cta' | 'outro';
  readonly narration: string;
  readonly visual: string;
  readonly estimatedSeconds: number;
}

export interface ScriptPlan {
  readonly title: string;
  readonly scenes: ScriptScenePlan[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly costDisclosed: boolean;
  readonly costApproved: boolean;
}

export interface EffectRequest {
  readonly prompt: string;
  readonly approvedCost?: boolean;
}

export interface EffectRecipe {
  readonly name: string;
  readonly description: string;
  readonly effects: Record<string, unknown>;
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface GenerateScriptRequest {
  readonly brief: string;
  readonly sceneCount: number;
  readonly language: string;
  readonly approvedCost: boolean;
}

export interface GenerateMotionRequest {
  readonly brief: string;
  readonly templateId: string;
  readonly approvedCost: boolean;
}

export interface MotionSuggestion {
  readonly templateId: string;
  readonly props: Record<string, unknown>;
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface AssistantMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export type AssistantAction =
  | { readonly kind: 'navigate'; readonly view: string }
  | { readonly kind: 'play' | 'pause' | 'save' | 'export' | 'status' | 'undo' | 'redo' }
  | {
      readonly kind: 'motion';
      readonly templateId: string;
      readonly text: string;
      readonly secondary?: string;
    };

export interface AssistantChatRequest {
  readonly messages: readonly AssistantMessage[];
  readonly context?: Record<string, unknown>;
  readonly approvedCost: boolean;
}

export interface AssistantChatReply {
  readonly reply: string;
  readonly action: AssistantAction | null;
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly culture: string;
  readonly gender: string;
}

export interface NarrationResult {
  readonly asset: Asset;
  readonly voice: string;
  readonly provider: string;
}

export interface AudioProviderInfo {
  readonly kind: 'windows-sapi' | 'elevenlabs' | 'external-web' | string;
  readonly voiceId: string;
  readonly modelId: string;
  readonly approved: boolean;
  readonly externalUrl: string;
  readonly hasKey: boolean;
  readonly keyringAvailable: boolean;
}

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
}

export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly envKeys: readonly string[];
  readonly workingDir: string | null;
  readonly enabled: boolean;
}

export interface McpServerInput {
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly key: string; readonly value?: string }[];
  readonly workingDir?: string;
  readonly enabled: boolean;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: unknown;
}

export interface McpProbeResult {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  readonly tools: readonly McpToolInfo[];
  readonly elapsedMs: number;
}

export interface McpCallResult {
  readonly serverId: string;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError: boolean;
  readonly elapsedMs: number;
}

/**
 * Sesión MCP viva. Un servidor que maneja un navegador conserva ahí su estado
 * (página abierta, perfil, cookies) entre llamadas; `idleMs` dice cuánto hace
 * que no se usa y el proceso se cierra solo a los 10 minutos.
 */
export interface McpSessionInfo {
  readonly serverId: string;
  readonly pid: number;
  readonly calls: number;
  readonly startedAtMs: number;
  readonly idleMs: number;
}

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

export interface AssetFileInfo {
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
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

export interface LoudnessSummary {
  readonly integratedLufs: number | null;
  readonly truePeakDb: number | null;
  readonly lraDb: number | null;
  readonly noiseFloorDb: number | null;
}

/** Avance del análisis de loudness de la mezcla. */
export interface LoudnessAnalysisProgress {
  readonly percent: number;
  readonly seconds: number;
  readonly totalSeconds: number;
}

/** Una muestra del medidor cada 100 ms de audio. */
export interface MixLoudnessSample {
  readonly seconds: number;
  readonly momentaryLufs: number;
  readonly shortTermLufs: number;
}

/** Medición EBU R128 de la mezcla completa (previa a loudnorm). */
export interface MixLoudnessReport {
  readonly durationSeconds: number;
  readonly integratedLufs: number;
  readonly loudnessRangeLu: number;
  readonly maxMomentaryLufs: number;
  readonly maxShortTermLufs: number;
  readonly samplePeakDbfs: number;
  readonly truePeakDbtp: number;
  readonly targetLufs: number | null;
  readonly targetDeltaDb: number | null;
  readonly samples: readonly MixLoudnessSample[];
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

/** Automático (GPU si existe), hardware forzado o software. */
export type EncoderPreference = 'auto' | 'hardware' | 'software';

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

/** Un modelo de IA local: peso, licencia y estado de descarga. */
export interface ModelInfo {
  readonly id: string;
  readonly capability: string;
  readonly purpose: string;
  readonly bytes: number;
  readonly downloaded: boolean;
  readonly license: { readonly id: string; readonly detail: string; readonly url: string };
  readonly sourceUrl: string;
}

/** Una capacidad de la app y sus backends, con estado medido. */
export interface CapabilityInfo {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly backends: readonly {
    readonly id: string;
    readonly kind: string;
    readonly detail: string;
    readonly available: boolean;
    readonly reason: string | null;
  }[];
  readonly available: boolean;
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

export type DialoguePreset = 'dialogo' | 'voz' | 'podcast' | 'suave';

/** Mejora de voz con la cadena DSP local de FilmCraft. */
export interface DialogueRequest {
  readonly inputPath: string;
  readonly outputDir?: string | null;
  readonly preset?: DialoguePreset;
}

export interface DialogueResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly preset: string;
  readonly effects: readonly string[];
}

export interface DialogueProgress {
  readonly percent: number;
  readonly stage: string;
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

/** Traducción de un lote acotado de subtítulos con el proveedor configurado. */
export interface TranslateSubtitlesRequest {
  readonly texts: readonly string[];
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly glossary?: string;
  readonly approvedCost?: boolean;
}

export interface TranslatedTexts {
  readonly texts: string[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface SaveLocalizedSubtitleRequest {
  readonly content: string;
  readonly outputDir: string;
  readonly baseName: string;
  readonly language: string;
  readonly format: 'srt' | 'vtt';
}

export interface SaveLocalizedSubtitleResult {
  readonly path: string;
  readonly bytes: number;
  readonly format: string;
  readonly language: string;
}

export interface DubCue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface SynthesizeDubRequest {
  readonly path: string;
  readonly outputDir: string;
  readonly language: string;
  readonly voice?: string;
  readonly cues: readonly DubCue[];
  readonly endSeconds?: number;
  readonly bedVolume?: number;
}

export interface DubResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly language: string;
  readonly voice: string;
  readonly cues: number;
  readonly replacedOriginalAudio: boolean;
  readonly originalAudioVolume: number;
  readonly warnings: readonly string[];
}

export interface DubProgress {
  readonly percent: number;
}

export type CloneEngine = 'xtts' | 'gpt-sovits';

export interface CloneVoiceRequest {
  readonly text: string;
  readonly referencePath: string;
  readonly engineUrl: string;
  readonly engine?: CloneEngine;
  readonly language: string;
  readonly promptText?: string;
  readonly apiKey?: string;
}

export interface CloneVoiceResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly language: string;
  readonly engine: string;
  readonly referenceSha256: string;
}

export interface CloneProgress {
  readonly percent: number;
  readonly stage?: string;
}

export interface LipSyncRequest {
  readonly videoPath: string;
  readonly audioPath: string;
  readonly outputDir: string;
  readonly engineUrl: string;
  readonly engine?: string;
  readonly apiKey?: string;
}

export interface LipSyncResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly engine: string;
}

export interface LipSyncProgress {
  readonly percent: number;
  readonly stage?: string;
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

export interface ToolResult {
  readonly path: string;
  readonly bytes: number;
  readonly message: string;
}

export interface AudioPeaks {
  readonly assetId: string;
  readonly durationSeconds: number;
  readonly buckets: number;
  readonly peaks: readonly { readonly min: number; readonly max: number }[];
}

export interface HardwareEncoders {
  readonly h264: string | null;
  readonly hevc: string | null;
  readonly checked: boolean;
}

export interface VariantWritten {
  readonly path: string;
  readonly bytes: number;
  readonly copiedAssets: number;
}

export interface VariantRendered {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface TranscriptionWord {
  readonly start: number;
  readonly end: number;
  readonly word: string;
  readonly probability: number;
}

export interface TranscriptionSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words: readonly TranscriptionWord[];
}

export interface TranscriptionResult {
  readonly language: string;
  readonly languageProbability: number;
  readonly durationSeconds: number;
  readonly model: string;
  readonly segments: readonly TranscriptionSegment[];
}

export interface DownloaderStatus {
  readonly available: boolean;
  readonly version: string | null;
  readonly path: string | null;
  readonly managed: boolean;
  readonly canInstall: boolean;
  readonly hint: string | null;
}

export interface DownloadQuality {
  readonly height: number;
  readonly label: string;
  readonly width: number | null;
  readonly fps: number | null;
  readonly ext: string | null;
  readonly vcodec: string | null;
  readonly filesize: number | null;
}

export interface DownloadProbe {
  readonly url: string;
  readonly title: string;
  readonly uploader: string | null;
  readonly durationSeconds: number | null;
  readonly thumbnail: string | null;
  readonly kind: 'video' | 'image' | 'audio' | 'gallery';
  readonly entryCount: number;
  readonly maxHeight: number | null;
  readonly estimatedBytes: number | null;
  readonly qualities: readonly DownloadQuality[];
}

export interface DownloadRequest {
  readonly url: string;
  readonly maxHeight?: number | null;
  readonly compression: 'none' | 'high' | 'balanced' | 'compact';
  readonly codec: 'h265' | 'h264';
  readonly kind: DownloadProbe['kind'];
  readonly playlist?: boolean;
  readonly cookiesFile?: string | null;
  readonly format?: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
  /** Save permanently to Descargas/Videos descargados/<platform>. */
  readonly saveToDownloads?: boolean;
  /** `best`, `worst`, or `height` when maxHeight carries the exact cap. */
  readonly quality?: 'best' | 'worst' | 'height';
  /** Absolute folder chosen by the person; defaults to Downloads/Videos descargados. */
  readonly destinationRoot?: string | null;
}

export interface DownloadedFile {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly kind: 'video' | 'image' | 'audio' | 'other';
}

export interface DownloadOutcome {
  readonly runId: string;
  readonly directory: string;
  readonly files: readonly DownloadedFile[];
  readonly compressed: boolean;
  readonly warnings: readonly string[];
}

export interface DownloadProgressEvent {
  readonly stage: 'engine' | 'probing' | 'downloading' | 'compressing' | 'done';
  readonly percent: number | null;
  readonly message: string;
}

export interface DownloaderBridgeInfo {
  readonly port: number;
  readonly token: string;
  readonly downloadsDir: string;
  readonly running: boolean;
}

export interface ExtensionInstallStatus {
  readonly available: boolean;
  readonly prepared: boolean;
  readonly sourcePath: string | null;
  readonly preparedPath: string | null;
  readonly hint: string | null;
}

export type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PickedSubtitleFile {
  readonly name: string;
  readonly text: string;
}

export interface DesktopService {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  createProject(input: CreateProjectRequest): Promise<OpenedProject | null>;
  openProject(): Promise<OpenedProject | null>;
  openProjectAt(path: string): Promise<OpenedProject>;
  adoptProject(path: string): Promise<OpenedProject>;
  saveProject(project: ProjectDocument): Promise<OpenedProject>;
  saveProjectAs(project: ProjectDocument): Promise<OpenedProject | null>;
  /** Save the delivery `.zip` built by the interface. Null means cancelled. */
  saveDeliveryPackage(bytes: Uint8Array, fileName: string): Promise<string | null>;
  closeProject(): Promise<void>;
  importAssets(fpsNum: number, fpsDen: number): Promise<ImportOutcome | null>;
  importMediaPaths(input: {
    paths: readonly string[];
    fpsNum: number;
    fpsDen: number;
    confirmRights?: boolean;
    provider?: string;
  }): Promise<ImportOutcome>;
  importLut(): Promise<{ readonly path: string; readonly name: string } | null>;
  chooseSubtitleFile(): Promise<PickedSubtitleFile | null>;
  chooseTimelineFile(): Promise<string | null>;
  extractFreezeFrame(input: {
    readonly path: string;
    readonly seconds: number;
    readonly fpsNum: number;
    readonly fpsDen: number;
  }): Promise<Asset | null>;
  createVideoProxy(input: { readonly path: string }): Promise<ProxyInfo>;
  sampleAssetColor(input: {
    readonly path: string;
    readonly seconds: number;
  }): Promise<SampledColor>;
  mediaThumbnail(path: string, isImage: boolean): Promise<string>;
  recentProjectThumbnail(path: string): Promise<string | null>;
  checkAssetFiles(paths: string[]): Promise<AssetFileInfo[]>;
  detectScenes(assetId: string, threshold: number): Promise<SceneDetection>;
  analyzeStabilization(
    assetId: string,
    inFrame: number,
    outFrame: number,
    smoothing: number,
  ): Promise<StabilizationAnalysis>;
  analyzeMedia(
    assetId: string,
    sceneThreshold?: number,
    silenceDb?: number,
    minSilenceSeconds?: number,
  ): Promise<MediaAnalysis>;
  convertMedia(request: ConversionRequest): Promise<ConversionResult>;
  convertMediaBatch(
    assetIds: readonly string[],
    target: ConversionTarget,
    outputDir: string,
    quality?: number,
    maxWidth?: number,
    encoder?: EncoderPreference,
    enhance?: EnhanceOptions,
  ): Promise<BatchConversionItem[]>;
  compressMedia(request: CompressRequest): Promise<ConversionResult>;
  onConvertProgress(handler: (event: ConvertProgress) => void): Promise<UnlistenFn>;
  mergeVideos(assetIds: string[], outputDir: string): Promise<ToolResult>;
  trimVideo(
    assetId: string,
    startSeconds: number,
    endSeconds: number,
    outputDir: string,
  ): Promise<ToolResult>;
  watermarkVideo(
    assetId: string,
    text: string,
    position: string,
    outputDir: string,
  ): Promise<ToolResult>;
  setMetadata(
    assetId: string,
    title: string,
    artist: string,
    comment: string,
    outputDir: string,
  ): Promise<ToolResult>;
  audioPeaks(assetId: string, buckets?: number): Promise<AudioPeaks>;
  /**
   * Mide el loudness de la mezcla del proyecto guardado (BS.1770-4 / EBU R128)
   * con el grafo de audio real del export, previo a la normalización.
   */
  analyzeMixLoudness(profileId?: string): Promise<MixLoudnessReport>;
  onLoudnessAnalysisProgress(
    handler: (event: LoudnessAnalysisProgress) => void,
  ): Promise<UnlistenFn>;
  hardwareEncoders(): Promise<HardwareEncoders>;
  downloaderStatus(): Promise<DownloaderStatus>;
  downloaderBridgeInfo(): Promise<DownloaderBridgeInfo>;
  installDownloader(): Promise<DownloaderStatus>;
  chooseDownloadDirectory(): Promise<string | null>;
  extensionStatus(): Promise<ExtensionInstallStatus>;
  prepareExtension(): Promise<ExtensionInstallStatus>;
  probeDownload(url: string, cookiesFile?: string | null): Promise<DownloadProbe>;
  chooseCookiesFile(): Promise<string | null>;
  downloadMedia(request: DownloadRequest): Promise<DownloadOutcome>;
  cleanupDownload(runId: string): Promise<void>;
  onDownloadProgress(handler: (event: DownloadProgressEvent) => void): Promise<UnlistenFn>;
  fetchPlatformRules(): Promise<unknown>;
  listMcpServers(): Promise<McpServerConfig[]>;
  saveMcpServer(input: McpServerInput): Promise<McpServerConfig>;
  deleteMcpServer(id: string): Promise<void>;
  probeMcpServer(id: string): Promise<McpProbeResult>;
  callMcpTool(id: string, tool: string, args: unknown): Promise<McpCallResult>;
  /** Cierra la sesión viva de un servidor y devuelve si había una abierta. */
  closeMcpSession(id: string): Promise<boolean>;
  /** Sesiones vivas ahora mismo. */
  mcpSessionStatus(): Promise<McpSessionInfo[]>;
  writeProjectVariant(input: {
    directory: string;
    fileName: string;
    project: unknown;
  }): Promise<VariantWritten>;
  renderProjectVariant(input: {
    projectPath: string;
    profileId: string;
    outputPath: string;
    includeCaptions: boolean;
    motionPlans?: Record<string, unknown>;
  }): Promise<VariantRendered>;
  loadDirectorMemory(): Promise<unknown | null>;
  saveDirectorMemory(memory: unknown): Promise<void>;
  transcribeAsset(
    assetId: string,
    language?: string,
    model?: string,
  ): Promise<TranscriptionResult>;
  systemInfo(): Promise<SystemInfo>;
  chooseTool(tool: 'ffmpeg' | 'ffprobe'): Promise<SystemInfo | null>;
  revealOutput(path: string): Promise<void>;
  getProvider(): Promise<ProviderInfo>;
  saveProvider(input: {
    kind: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Promise<ProviderInfo>;
  clearProviderKey(): Promise<ProviderInfo>;
  getAudioProvider(): Promise<AudioProviderInfo>;
  saveAudioProvider(input: {
    kind: string;
    voiceId: string;
    modelId: string;
    externalUrl: string;
    approved: boolean;
    apiKey?: string;
  }): Promise<AudioProviderInfo>;
  clearAudioProviderKey(): Promise<AudioProviderInfo>;
  openExternalUrl(url: string): Promise<void>;
  savePublicationManifest(manifest: unknown): Promise<string | null>;
  generateScript(request: GenerateScriptRequest): Promise<ScriptPlan>;
  generateVideoEffect(request: EffectRequest): Promise<EffectRecipe>;
  generateMotion(request: GenerateMotionRequest): Promise<MotionSuggestion>;
  assistantChat(request: AssistantChatRequest): Promise<AssistantChatReply>;
  listVoices(): Promise<VoiceInfo[]>;
  synthesizeNarration(input: {
    text: string;
    voice?: string;
    fpsNum: number;
    fpsDen: number;
    provider?: 'windows-sapi';
  }): Promise<NarrationResult>;
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
  onRenderProgress(handler: (event: RenderProgressEvent) => void): Promise<UnlistenFn>;
  onRenderFinished(handler: (event: RenderFinishedEvent) => void): Promise<UnlistenFn>;
  mediaUrl(root: string, relativePath: string): string;
  /** Selector nativo de imágenes sueltas (comparador antes/después). */
  chooseImageFile(title?: string): Promise<string | null>;
  /** Selector nativo de videos sueltos (compresión, inspección). */
  chooseVideoFile(title?: string): Promise<string | null>;
  /** Selector nativo de audio suelto (voz, transcripción, análisis). */
  chooseAudioFile(title?: string): Promise<string | null>;
  /** Selector nativo de carpeta, sin proyecto abierto. */
  chooseDownloadDirectory(): Promise<string | null>;
  /** Inspección completa por contenido: acepta cualquier archivo que FFmpeg lea. */
  probeMediaFile(path: string): Promise<MediaProbe>;
  /** Comprime un archivo suelto del disco y devuelve el antes/después de bytes. */
  compressAnyFile(request: CompressAnyRequest): Promise<ConversionResult>;
  /** Progreso porcentual de la compresión en curso. */
  onCompressProgress(handler: (event: CompressProgress) => void): Promise<UnlistenFn>;
  listModels(): Promise<ModelInfo[]>;
  downloadModel(id: string): Promise<ModelInfo>;
  deleteModel(id: string): Promise<boolean>;
  listCapabilities(): Promise<CapabilityInfo[]>;
  listVisualCatalog(): Promise<VisualCatalog>;
  auditVisuals(project: unknown): Promise<VisualAudit>;
  removeBackground(inputPath: string): Promise<BackgroundRemoval>;
  /** Recorta el fondo de un asset del proyecto y lo devuelve ya importado. */
  removeBackgroundAsset(request: BackgroundRemovalRequest): Promise<Asset>;
  onBackgroundProgress(handler: (event: BackgroundProgress) => void): Promise<UnlistenFn>;
  upscaleImage(inputPath: string): Promise<UpscaleResult>;
  denoiseMedia(request: DenoiseRequest): Promise<DenoiseResult>;
  onDenoiseProgress(handler: (event: DenoiseProgress) => void): Promise<UnlistenFn>;
  enhanceDialogue(request: DialogueRequest): Promise<DialogueResult>;
  onDialogueProgress(handler: (event: DialogueProgress) => void): Promise<UnlistenFn>;
  saveThumbnail(request: ThumbnailExportRequest): Promise<ThumbnailExportResult>;
  pickThumbnailFrames(request: BestFrameRequest): Promise<readonly BestThumbnailFrame[]>;
  renderPreviewFrame(request: PreviewFrameRequest): Promise<PreviewFrameResult>;
  analyzeScopesFrame(request: { readonly path: string }): Promise<ScopeFrameResult>;
  exportLookLut(request: LookLutRequest): Promise<LookLutResult>;
  exportEdl(request: EdlRequest): Promise<EdlResult>;
  exportOtio(request: OtioRequest): Promise<OtioResult>;
  exportFcpxml(request: FcpxmlRequest): Promise<FcpxmlResult>;
  importTimeline(request: TimelineImportRequest): Promise<TimelineImportResult>;
  translateSubtitles(request: TranslateSubtitlesRequest): Promise<TranslatedTexts>;
  saveLocalizedSubtitle(
    request: SaveLocalizedSubtitleRequest,
  ): Promise<SaveLocalizedSubtitleResult>;
  synthesizeDub(request: SynthesizeDubRequest): Promise<DubResult>;
  onDubProgress(handler: (event: DubProgress) => void): Promise<UnlistenFn>;
  cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResult>;
  onCloneProgress(handler: (event: CloneProgress) => void): Promise<UnlistenFn>;
  lipSync(request: LipSyncRequest): Promise<LipSyncResult>;
  onLipSyncProgress(handler: (event: LipSyncProgress) => void): Promise<UnlistenFn>;
  exportShort(request: ExportShortRequest): Promise<ExportShortResult>;
  onShortProgress(handler: (event: ShortProgress) => void): Promise<UnlistenFn>;
  analyzeFaceTrack(request: FaceTrackRequest): Promise<FaceTrackResult>;
  /**
   * Mide VMAF entre el original y el comprimido (0–100). `null` si el build de
   * FFmpeg no trae libvmaf: la UI lo muestra como no disponible.
   */
  measureVmaf(original: string, compressed: string): Promise<number | null>;
  /** Convierte una ruta absoluta en URL cargable. Vacía fuera de la app nativa. */
  absoluteFileUrl(path: string): string;
  joinPath(root: string, relativePath: string): string;
}

export const PROJECT_COMMANDS = {
  create: 'create_project',
  open: 'open_project',
  openAt: 'open_project_at',
  adopt: 'adopt_project',
  save: 'save_project',
  saveAs: 'save_project_as',
  saveDeliveryPackage: 'save_delivery_package',
  close: 'close_project',
  importAssets: 'import_assets',
  importMediaPaths: 'import_media_paths',
  importLut: 'import_lut',
  chooseSubtitleFile: 'choose_subtitle_file',
  chooseTimelineFile: 'choose_timeline_file',
  extractFreezeFrame: 'extract_freeze_frame',
  createVideoProxy: 'create_video_proxy',
  sampleAssetColor: 'sample_asset_color',
  thumbnail: 'media_thumbnail',
  recentProjectThumbnail: 'recent_project_thumbnail',
  checkAssets: 'check_asset_files',
  detectScenes: 'detect_scenes',
  analyzeStabilization: 'analyze_stabilization',
  analyzeMedia: 'analyze_media',
  convertMedia: 'convert_media',
  convertMediaBatch: 'convert_media_batch',
  compressMedia: 'compress_media',
  mergeVideos: 'merge_videos',
  trimVideo: 'trim_video',
  watermarkVideo: 'watermark_video',
  setMetadata: 'set_metadata',
  audioPeaks: 'audio_peaks',
  analyzeMixLoudness: 'analyze_mix_loudness',
  hardwareEncoders: 'hardware_encoders',
  downloaderStatus: 'downloader_status',
  downloaderBridgeInfo: 'downloader_bridge_info',
  installDownloader: 'install_downloader',
  chooseDownloadDirectory: 'choose_download_directory',
  extensionStatus: 'extension_status',
  prepareExtension: 'prepare_extension',
  probeDownload: 'probe_download',
  chooseCookiesFile: 'choose_cookies_file',
  chooseImageFile: 'choose_image_file',
  chooseVideoFile: 'choose_video_file',
  chooseAudioFile: 'choose_audio_file',
  probeMediaFile: 'probe_any_file',
  compressAnyFile: 'compress_any_file',
  measureVmaf: 'measure_vmaf',
  listModels: 'list_models',
  downloadModel: 'download_model',
  deleteModel: 'delete_model',
  listCapabilities: 'list_capabilities',
  listVisualCatalog: 'list_visual_catalog',
  auditVisuals: 'audit_visuals',
  removeBackground: 'remove_background',
  removeBackgroundAsset: 'remove_background_asset',
  upscaleImage: 'upscale_image',
  denoiseMedia: 'denoise_media',
  enhanceDialogue: 'enhance_dialogue',
  saveThumbnail: 'save_thumbnail',
  pickThumbnailFrames: 'pick_thumbnail_frames',
  renderPreviewFrame: 'render_preview_frame',
  analyzeScopesFrame: 'analyze_scopes_frame',
  exportLookLut: 'export_look_lut',
  exportEdl: 'export_edl',
  exportOtio: 'export_otio',
  exportFcpxml: 'export_fcpxml',
  importTimeline: 'import_timeline',
  translateSubtitles: 'translate_subtitles',
  saveLocalizedSubtitle: 'save_localized_subtitle',
  synthesizeDub: 'synthesize_dub',
  cloneVoice: 'clone_voice',
  lipSync: 'lip_sync',
  exportShort: 'export_short',
  analyzeFaceTrack: 'analyze_face_track',
  downloadMedia: 'download_media',
  cleanupDownload: 'cleanup_download',
  fetchPlatformRules: 'fetch_platform_rules',
  listMcpServers: 'list_mcp_servers',
  saveMcpServer: 'save_mcp_server',
  deleteMcpServer: 'delete_mcp_server',
  probeMcpServer: 'probe_mcp_server',
  callMcpTool: 'call_mcp_tool',
  closeMcpSession: 'close_mcp_session',
  mcpSessionStatus: 'mcp_session_status',
  writeProjectVariant: 'write_project_variant',
  renderProjectVariant: 'render_project_variant',
  loadDirectorMemory: 'load_director_memory',
  saveDirectorMemory: 'save_director_memory',
  transcribeAsset: 'transcribe_asset',
  systemInfo: 'system_info',
  chooseTool: 'choose_tool',
  revealOutput: 'reveal_output',
  getProvider: 'get_provider',
  saveProvider: 'save_provider',
  clearProviderKey: 'clear_provider_key',
  getAudioProvider: 'get_audio_provider',
  saveAudioProvider: 'save_audio_provider',
  clearAudioProviderKey: 'clear_audio_provider_key',
  openExternalUrl: 'open_external_url',
  savePublicationManifest: 'save_publication_manifest',
  generateScript: 'generate_script',
  generateVideoEffect: 'generate_video_effect',
  generateMotion: 'generate_motion',
  assistantChat: 'assistant_chat',
  listVoices: 'list_voices',
  synthesizeNarration: 'synthesize_narration',
  startRender: 'start_render',
  startRenderTo: 'start_render_to',
  chooseExportDirectory: 'choose_export_directory',
  cancelRender: 'cancel_render',
  activeRender: 'active_render',
  pruneRenderCache: 'prune_render_cache',
} as const;

export const NATIVE_UNAVAILABLE_REASON =
  'Abrí la app de escritorio de Olyvia para crear, importar y exportar. Esta ventana del navegador no tiene acceso al sistema de archivos.';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke?: NativeInvoke };
  }
}

export function detectNativeRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__?.invoke === 'function';
}

const FAILED_PHRASE: Record<string, string> = {
  create: 'crear el proyecto',
  open: 'abrir el proyecto',
  save: 'guardar el proyecto',
  import: 'importar los medios',
  render: 'exportar el video',
  provider: 'contactar al proveedor',
};

export function sanitizeForUi(message: string): string {
  const withoutDrivePaths = message.replace(/[A-Za-z]:[\\/][^\s,;)"']*/g, (match) =>
    baseName(match),
  );
  const withoutAbsolutePaths = withoutDrivePaths.replace(/(?:[\\/][^\s,;)"'\\/]+){2,}/g, (match) =>
    baseName(match),
  );
  return withoutAbsolutePaths.slice(0, 400);
}

export function baseName(value: string): string {
  const segments = value.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? value;
}

/** Loopback is the only place a plain-http provider is accepted. Parse the URL
 * and compare the host exactly; a prefix check would accept
 * 127.0.0.1.evil.example and leak the API key over plain http. */
export function isLocalProviderUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function providerUrlProblem(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return 'La URL base no es una URL válida.';
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return 'La URL base debe usar http o https.';
  }
  if (url.username || url.password) {
    return 'La URL base no puede incluir usuario ni contraseña.';
  }
  if (!isLocalProviderUrl(baseUrl) && url.protocol !== 'https:') {
    return 'Los proveedores remotos deben usar https para no enviar la clave en claro.';
  }
  return null;
}

export const safeDisplayLabel = baseName;

export function describeFailure(op: string, reason: string, keepsChanges = false): string {
  const what = FAILED_PHRASE[op] ?? op;
  const tail = keepsChanges ? ' Los cambios siguen sin guardar.' : '';
  return `Falló ${what}: ${sanitizeForUi(reason)}.${tail}`;
}

export function joinProjectPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/\//g, separator)}`;
}

function nativeError(error: unknown): Error {
  if (typeof error === 'string') {
    return new Error(sanitizeForUi(error));
  }
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown; issues?: unknown };
    const message =
      typeof record.message === 'string'
        ? record.message
        : 'la operación nativa falló sin detalle';
    const issues = Array.isArray(record.issues)
      ? record.issues
          .slice(0, 2)
          .map((issue) =>
            issue && typeof issue === 'object' && 'message' in issue
              ? String((issue as { message: unknown }).message)
              : '',
          )
          .filter(Boolean)
      : [];
    const code = typeof record.code === 'string' ? `[${record.code}] ` : '';
    return new Error(sanitizeForUi(`${code}${message}${issues.length ? ` · ${issues.join(' · ')}` : ''}`));
  }
  return new Error('la operación nativa falló sin detalle');
}

function requireOpened(raw: unknown): OpenedProject | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || !('project' in raw) || !('path' in raw)) {
    throw new Error('el comando nativo devolvió un proyecto sin ruta');
  }
  const { project, path, root, label } = raw as {
    project: unknown;
    path: unknown;
    root?: unknown;
    label?: unknown;
  };
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(sanitizeForUi(parsed.message));
  }
  return {
    project: parsed.project,
    path: typeof path === 'string' ? path : '',
    root: typeof root === 'string' ? root : '',
    label: typeof label === 'string' ? label : parsed.project.name,
  };
}

function parseAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item, index) => {
    const parsed = AssetSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error(
        sanitizeForUi(
          `el material ${index + 1} no cumple el formato de assets: ${parsed.error.issues[0]?.message ?? 'forma inválida'}`,
        ),
      );
    }
    return parsed.data;
  });
}

export function createNativeDesktopService(invoke: NativeInvoke = tauriInvoke as NativeInvoke): DesktopService {
  const call = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    try {
      return await invoke(command, args);
    } catch (error) {
      throw nativeError(error);
    }
  };

  return {
    available: true,
    unavailableReason: null,
    async createProject(input) {
      return requireOpened(
        await call(PROJECT_COMMANDS.create, {
          name: input.name,
          video: {
            width: input.width,
            height: input.height,
            frameRate: { num: input.fpsNum, den: input.fpsDen },
            backgroundColor: '#0b0e13',
          },
        }),
      );
    },
    async openProject() {
      return requireOpened(await call(PROJECT_COMMANDS.open));
    },
    async openProjectAt(path) {
      const opened = requireOpened(await call(PROJECT_COMMANDS.openAt, { path }));
      if (!opened) {
        throw new Error('el proyecto no se pudo abrir');
      }
      return opened;
    },
    async adoptProject(path) {
      const opened = requireOpened(await call(PROJECT_COMMANDS.adopt, { path }));
      if (!opened) {
        throw new Error('el proyecto no se pudo adoptar en la sesión nativa');
      }
      return opened;
    },
    async saveProject(project) {
      const opened = requireOpened(await call(PROJECT_COMMANDS.save, { project }));
      if (!opened) {
        throw new Error('el guardado no devolvió el proyecto');
      }
      return opened;
    },
    async saveProjectAs(project) {
      return requireOpened(await call(PROJECT_COMMANDS.saveAs, { project }));
    },
    async saveDeliveryPackage(bytes, fileName) {
      const raw = await call(PROJECT_COMMANDS.saveDeliveryPackage, {
        bytesBase64: bytesToBase64(bytes),
        fileName,
      });
      return typeof raw === 'string' ? raw : null;
    },
    async closeProject() {
      await call(PROJECT_COMMANDS.close);
    },
    async importAssets(fpsNum, fpsDen) {
      const raw = await call(PROJECT_COMMANDS.importAssets, { fpsNum, fpsDen });
      if (raw === null || raw === undefined) {
        return null;
      }
      const record = raw as { assets?: unknown; warnings?: unknown };
      return {
        assets: parseAssets(record.assets),
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
      };
    },
    async importMediaPaths(input) {
      const raw = await call(PROJECT_COMMANDS.importMediaPaths, {
        paths: [...input.paths],
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
        confirmRights: input.confirmRights ?? false,
        provider: input.provider ?? null,
      });
      const record = (raw ?? {}) as { assets?: unknown; warnings?: unknown };
      return {
        assets: parseAssets(record.assets),
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
      };
    },
    async importLut() {
      const raw = await call(PROJECT_COMMANDS.importLut);
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as { path?: unknown; name?: unknown };
      if (typeof record.path !== 'string' || !record.path) return null;
      return {
        path: record.path,
        name: typeof record.name === 'string' ? record.name : 'LUT',
      };
    },
    async chooseImageFile(title) {
      const raw = await call(PROJECT_COMMANDS.chooseImageFile, {
        title: title ?? null,
      });
      return typeof raw === 'string' && raw ? raw : null;
    },
    absoluteFileUrl(path) {
      if (!path) return '';
      if (!detectNativeRuntime()) return '';
      try {
        return convertFileSrc(path);
      } catch {
        return '';
      }
    },
    async chooseVideoFile(title) {
      const raw = await call(PROJECT_COMMANDS.chooseVideoFile, { title: title ?? null });
      return typeof raw === 'string' && raw ? raw : null;
    },
    async chooseAudioFile(title) {
      const raw = await call(PROJECT_COMMANDS.chooseAudioFile, { title: title ?? null });
      return typeof raw === 'string' && raw ? raw : null;
    },
    async chooseDownloadDirectory() {
      const raw = await call(PROJECT_COMMANDS.chooseDownloadDirectory);
      return typeof raw === 'string' && raw ? raw : null;
    },
    async probeMediaFile(path) {
      return (await call(PROJECT_COMMANDS.probeMediaFile, { path })) as MediaProbe;
    },
    async compressAnyFile(request) {
      return (await call(PROJECT_COMMANDS.compressAnyFile, {
        request,
      })) as ConversionResult;
    },
    async onCompressProgress(handler) {
      return listen<CompressProgress>('compress-progress', (event) => handler(event.payload));
    },
    async measureVmaf(original, compressed) {
      const raw = await call(PROJECT_COMMANDS.measureVmaf, { original, compressed });
      return typeof raw === 'number' ? raw : null;
    },
    async listModels() {
      return (await call(PROJECT_COMMANDS.listModels)) as ModelInfo[];
    },
    async downloadModel(id) {
      return (await call(PROJECT_COMMANDS.downloadModel, { id })) as ModelInfo;
    },
    async deleteModel(id) {
      return (await call(PROJECT_COMMANDS.deleteModel, { id })) === true;
    },
    async listCapabilities() {
      return (await call(PROJECT_COMMANDS.listCapabilities)) as CapabilityInfo[];
    },
    async listVisualCatalog() {
      return (await call(PROJECT_COMMANDS.listVisualCatalog)) as VisualCatalog;
    },
    async auditVisuals(project) {
      return (await call(PROJECT_COMMANDS.auditVisuals, { project })) as VisualAudit;
    },
    async removeBackground(inputPath) {
      return (await call(PROJECT_COMMANDS.removeBackground, {
        inputPath,
      })) as BackgroundRemoval;
    },
    async removeBackgroundAsset(request) {
      const raw = await call(PROJECT_COMMANDS.removeBackgroundAsset, {
        path: request.path,
        kind: request.kind,
        inFrame: request.inFrame,
        outFrame: request.outFrame,
        fpsNum: request.fpsNum,
        fpsDen: request.fpsDen,
      });
      const asset = parseAssets([raw])[0];
      if (!asset) {
        throw new Error('el recorte no devolvió un asset válido');
      }
      return asset;
    },
    async onBackgroundProgress(handler) {
      return listen<BackgroundProgress>('background-progress', (event) =>
        handler(event.payload),
      );
    },
    async upscaleImage(inputPath) {
      return (await call(PROJECT_COMMANDS.upscaleImage, {
        inputPath,
      })) as UpscaleResult;
    },
    async denoiseMedia(request) {
      return (await call(PROJECT_COMMANDS.denoiseMedia, {
        request,
      })) as DenoiseResult;
    },
    async onDenoiseProgress(handler) {
      return listen<DenoiseProgress>('denoise-progress', (event) => handler(event.payload));
    },
    async enhanceDialogue(request) {
      return (await call(PROJECT_COMMANDS.enhanceDialogue, {
        request,
      })) as DialogueResult;
    },
    async onDialogueProgress(handler) {
      return listen<DialogueProgress>('dialogue-progress', (event) =>
        handler(event.payload),
      );
    },
    async saveThumbnail(request) {
      return (await call(PROJECT_COMMANDS.saveThumbnail, {
        request,
      })) as ThumbnailExportResult;
    },
    async pickThumbnailFrames(request) {
      return (await call(PROJECT_COMMANDS.pickThumbnailFrames, {
        request,
      })) as BestThumbnailFrame[];
    },
    async renderPreviewFrame(request) {
      return (await call(PROJECT_COMMANDS.renderPreviewFrame, {
        request,
      })) as PreviewFrameResult;
    },
    async analyzeScopesFrame(request) {
      return (await call(PROJECT_COMMANDS.analyzeScopesFrame, {
        request,
      })) as ScopeFrameResult;
    },
    async exportLookLut(request) {
      return (await call(PROJECT_COMMANDS.exportLookLut, {
        request,
      })) as LookLutResult;
    },
    async exportEdl(request) {
      return (await call(PROJECT_COMMANDS.exportEdl, {
        request,
      })) as EdlResult;
    },
    async exportOtio(request) {
      return (await call(PROJECT_COMMANDS.exportOtio, {
        request,
      })) as OtioResult;
    },
    async exportFcpxml(request) {
      return (await call(PROJECT_COMMANDS.exportFcpxml, {
        request,
      })) as FcpxmlResult;
    },
    async importTimeline(request) {
      return (await call(PROJECT_COMMANDS.importTimeline, {
        request,
      })) as TimelineImportResult;
    },
    async translateSubtitles(request) {
      return (await call(PROJECT_COMMANDS.translateSubtitles, {
        request,
      })) as TranslatedTexts;
    },
    async saveLocalizedSubtitle(request) {
      return (await call(PROJECT_COMMANDS.saveLocalizedSubtitle, {
        request,
      })) as SaveLocalizedSubtitleResult;
    },
    async synthesizeDub(request) {
      return (await call(PROJECT_COMMANDS.synthesizeDub, {
        request,
      })) as DubResult;
    },
    async onDubProgress(handler) {
      return listen<DubProgress>('dub-progress', (event) => handler(event.payload));
    },
    async cloneVoice(request) {
      return (await call(PROJECT_COMMANDS.cloneVoice, { request })) as CloneVoiceResult;
    },
    async onCloneProgress(handler) {
      return listen<CloneProgress>('clone-progress', (event) => handler(event.payload));
    },
    async lipSync(request) {
      return (await call(PROJECT_COMMANDS.lipSync, { request })) as LipSyncResult;
    },
    async onLipSyncProgress(handler) {
      return listen<LipSyncProgress>('lipsync-progress', (event) => handler(event.payload));
    },
    async exportShort(request) {
      return (await call(PROJECT_COMMANDS.exportShort, {
        request,
      })) as ExportShortResult;
    },
    async onShortProgress(handler) {
      return listen<ShortProgress>('short-progress', (event) => handler(event.payload));
    },
    async analyzeFaceTrack(request) {
      return (await call(PROJECT_COMMANDS.analyzeFaceTrack, {
        request,
      })) as FaceTrackResult;
    },
    async chooseSubtitleFile() {
      const raw = await call(PROJECT_COMMANDS.chooseSubtitleFile);
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as { name?: unknown; text?: unknown };
      if (typeof record.text !== 'string') return null;
      return {
        name: typeof record.name === 'string' ? record.name : 'subtitulos.srt',
        text: record.text,
      };
    },
    async chooseTimelineFile() {
      const raw = await call(PROJECT_COMMANDS.chooseTimelineFile);
      return typeof raw === 'string' ? raw : null;
    },
    async extractFreezeFrame(input) {
      const raw = await call(PROJECT_COMMANDS.extractFreezeFrame, {
        path: input.path,
        seconds: input.seconds,
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
      });
      const asset = parseAssets([raw])[0];
      return asset ?? null;
    },
    async createVideoProxy(input) {
      const raw = await call(PROJECT_COMMANDS.createVideoProxy, {
        path: input.path,
      });
      const record = (raw ?? {}) as Record<string, unknown>;
      return {
        path: typeof record.path === 'string' ? record.path : '',
        width: typeof record.width === 'number' ? record.width : 0,
        height: typeof record.height === 'number' ? record.height : 0,
        bytes: typeof record.bytes === 'number' ? record.bytes : 0,
      };
    },
    async sampleAssetColor(input) {
      const raw = await call(PROJECT_COMMANDS.sampleAssetColor, {
        path: input.path,
        seconds: input.seconds,
      });
      const record = (raw ?? {}) as Record<string, unknown>;
      return {
        r: typeof record.r === 'number' ? record.r : 0,
        g: typeof record.g === 'number' ? record.g : 0,
        b: typeof record.b === 'number' ? record.b : 0,
      };
    },
    async mediaThumbnail(path, isImage) {
      const raw = await call(PROJECT_COMMANDS.thumbnail, { path, isImage });
      if (typeof raw !== 'string') {
        throw new Error('la miniatura no llegó como imagen');
      }
      return raw;
    },
    async recentProjectThumbnail(path) {
      const raw = await call(PROJECT_COMMANDS.recentProjectThumbnail, { path });
      return typeof raw === 'string' ? raw : null;
    },
    async checkAssetFiles(paths) {
      const raw = await call(PROJECT_COMMANDS.checkAssets, { paths });
      return Array.isArray(raw) ? (raw as AssetFileInfo[]) : [];
    },
    async detectScenes(assetId, threshold) {
      return (await call(PROJECT_COMMANDS.detectScenes, {
        assetId,
        threshold,
      })) as SceneDetection;
    },
    async analyzeStabilization(assetId, inFrame, outFrame, smoothing) {
      return (await call(PROJECT_COMMANDS.analyzeStabilization, {
        assetId,
        inFrame,
        outFrame,
        smoothing,
      })) as StabilizationAnalysis;
    },
    async analyzeMedia(assetId, sceneThreshold, silenceDb, minSilenceSeconds) {
      return (await call(PROJECT_COMMANDS.analyzeMedia, {
        assetId,
        sceneThreshold: sceneThreshold ?? null,
        silenceDb: silenceDb ?? null,
        minSilenceSeconds: minSilenceSeconds ?? null,
      })) as MediaAnalysis;
    },
    async convertMedia(request) {
      return (await call(PROJECT_COMMANDS.convertMedia, {
        assetId: request.assetId,
        target: request.target,
        outputDir: request.outputDir,
        quality: request.quality ?? null,
        maxWidth: request.maxWidth ?? null,
        encoder: request.encoder ?? null,
        enhance: request.enhance ?? null,
      })) as ConversionResult;
    },
    async convertMediaBatch(assetIds, target, outputDir, quality, maxWidth, encoder, enhance) {
      return (await call(PROJECT_COMMANDS.convertMediaBatch, {
        assetIds: [...assetIds],
        target,
        outputDir,
        quality: quality ?? null,
        maxWidth: maxWidth ?? null,
        encoder: encoder ?? null,
        enhance: enhance ?? null,
      })) as BatchConversionItem[];
    },
    async compressMedia(request) {
      return (await call(PROJECT_COMMANDS.compressMedia, {
        assetId: request.assetId,
        outputDir: request.outputDir,
        target: request.target,
        mode: request.mode,
        quality: request.quality ?? null,
        targetMegabytes: request.targetMegabytes ?? null,
        maxWidth: request.maxWidth ?? null,
        audioKbps: request.audioKbps ?? null,
        encoder: request.encoder ?? null,
        enhance: request.enhance ?? null,
      })) as ConversionResult;
    },
    async mergeVideos(assetIds, outputDir) {
      return (await call(PROJECT_COMMANDS.mergeVideos, {
        assetIds,
        outputDir,
      })) as ToolResult;
    },
    async trimVideo(assetId, startSeconds, endSeconds, outputDir) {
      return (await call(PROJECT_COMMANDS.trimVideo, {
        assetId,
        startSeconds,
        endSeconds,
        outputDir,
      })) as ToolResult;
    },
    async watermarkVideo(assetId, text, position, outputDir) {
      return (await call(PROJECT_COMMANDS.watermarkVideo, {
        assetId,
        text,
        position,
        outputDir,
      })) as ToolResult;
    },
    async setMetadata(assetId, title, artist, comment, outputDir) {
      return (await call(PROJECT_COMMANDS.setMetadata, {
        assetId,
        title,
        artist,
        comment,
        outputDir,
      })) as ToolResult;
    },
    async audioPeaks(assetId, buckets) {
      return (await call(PROJECT_COMMANDS.audioPeaks, {
        assetId,
        buckets: buckets ?? 600,
      })) as AudioPeaks;
    },
    async analyzeMixLoudness(profileId) {
      return (await call(PROJECT_COMMANDS.analyzeMixLoudness, {
        profileId: profileId ?? null,
      })) as MixLoudnessReport;
    },
    async onLoudnessAnalysisProgress(handler) {
      return listen<LoudnessAnalysisProgress>('loudness-analysis-progress', (event) =>
        handler(event.payload),
      );
    },
    async hardwareEncoders() {
      return (await call(PROJECT_COMMANDS.hardwareEncoders)) as HardwareEncoders;
    },
    async downloaderStatus() {
      return (await call(PROJECT_COMMANDS.downloaderStatus)) as DownloaderStatus;
    },
    async downloaderBridgeInfo() {
      return (await call(PROJECT_COMMANDS.downloaderBridgeInfo)) as DownloaderBridgeInfo;
    },
    async installDownloader() {
      return (await call(PROJECT_COMMANDS.installDownloader)) as DownloaderStatus;
    },
    async extensionStatus() {
      return (await call(PROJECT_COMMANDS.extensionStatus)) as ExtensionInstallStatus;
    },
    async prepareExtension() {
      return (await call(PROJECT_COMMANDS.prepareExtension)) as ExtensionInstallStatus;
    },
    async probeDownload(url, cookiesFile) {
      return (await call(PROJECT_COMMANDS.probeDownload, {
        url,
        cookiesFile: cookiesFile ?? null,
      })) as DownloadProbe;
    },
    async chooseCookiesFile() {
      const raw = await call(PROJECT_COMMANDS.chooseCookiesFile);
      return typeof raw === 'string' ? raw : null;
    },
    async downloadMedia(request) {
      return (await call(PROJECT_COMMANDS.downloadMedia, { request })) as DownloadOutcome;
    },
    async cleanupDownload(runId) {
      await call(PROJECT_COMMANDS.cleanupDownload, { runId });
    },
    async onDownloadProgress(handler) {
      return listen<DownloadProgressEvent>('download-progress', (event) => handler(event.payload));
    },
    async fetchPlatformRules() {
      return call(PROJECT_COMMANDS.fetchPlatformRules);
    },
    async listMcpServers() {
      const raw = await call(PROJECT_COMMANDS.listMcpServers);
      return Array.isArray(raw) ? (raw as McpServerConfig[]) : [];
    },
    async saveMcpServer(input) {
      return (await call(PROJECT_COMMANDS.saveMcpServer, { server: input })) as McpServerConfig;
    },
    async deleteMcpServer(id) {
      await call(PROJECT_COMMANDS.deleteMcpServer, { id });
    },
    async probeMcpServer(id) {
      return (await call(PROJECT_COMMANDS.probeMcpServer, { id })) as McpProbeResult;
    },
    async callMcpTool(id, tool, args) {
      return (await call(PROJECT_COMMANDS.callMcpTool, {
        id,
        tool,
        arguments: args,
      })) as McpCallResult;
    },
    async closeMcpSession(id) {
      return (await call(PROJECT_COMMANDS.closeMcpSession, { id })) === true;
    },
    async mcpSessionStatus() {
      const raw = await call(PROJECT_COMMANDS.mcpSessionStatus);
      return Array.isArray(raw) ? (raw as McpSessionInfo[]) : [];
    },
    async writeProjectVariant(input) {
      return (await call(PROJECT_COMMANDS.writeProjectVariant, {
        directory: input.directory,
        fileName: input.fileName,
        project: input.project,
      })) as VariantWritten;
    },
    async renderProjectVariant(input) {
      return (await call(PROJECT_COMMANDS.renderProjectVariant, {
        projectPath: input.projectPath,
        profileId: input.profileId,
        outputPath: input.outputPath,
        includeCaptions: input.includeCaptions,
        ...(input.motionPlans ? { motionPlans: input.motionPlans } : {}),
      })) as VariantRendered;
    },
    async loadDirectorMemory() {
      return await call(PROJECT_COMMANDS.loadDirectorMemory);
    },
    async saveDirectorMemory(memory) {
      await call(PROJECT_COMMANDS.saveDirectorMemory, { memory });
    },
    async transcribeAsset(assetId, language, model) {
      return (await call(PROJECT_COMMANDS.transcribeAsset, {
        assetId,
        language: language ?? null,
        model: model ?? null,
      })) as TranscriptionResult;
    },
    async systemInfo() {
      return (await call(PROJECT_COMMANDS.systemInfo)) as SystemInfo;
    },
    async chooseTool(tool) {
      return (await call(PROJECT_COMMANDS.chooseTool, { tool })) as SystemInfo | null;
    },
    async revealOutput(path) {
      await call(PROJECT_COMMANDS.revealOutput, { path });
    },
    async getProvider() {
      return (await call(PROJECT_COMMANDS.getProvider)) as ProviderInfo;
    },
    async saveProvider(input) {
      return (await call(PROJECT_COMMANDS.saveProvider, {
        kind: input.kind,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey: input.apiKey ?? null,
      })) as ProviderInfo;
    },
    async clearProviderKey() {
      return (await call(PROJECT_COMMANDS.clearProviderKey)) as ProviderInfo;
    },
    async getAudioProvider() {
      return (await call(PROJECT_COMMANDS.getAudioProvider)) as AudioProviderInfo;
    },
    async saveAudioProvider(input) {
      return (await call(PROJECT_COMMANDS.saveAudioProvider, {
        kind: input.kind,
        voiceId: input.voiceId,
        modelId: input.modelId,
        externalUrl: input.externalUrl,
        approved: input.approved,
        apiKey: input.apiKey ?? null,
      })) as AudioProviderInfo;
    },
    async clearAudioProviderKey() {
      return (await call(PROJECT_COMMANDS.clearAudioProviderKey)) as AudioProviderInfo;
    },
    async openExternalUrl(url) {
      await call(PROJECT_COMMANDS.openExternalUrl, { url });
    },
    async savePublicationManifest(manifest) {
      const raw = await call(PROJECT_COMMANDS.savePublicationManifest, { manifest });
      return typeof raw === 'string' ? raw : null;
    },
    async generateScript(request) {
      return (await call(PROJECT_COMMANDS.generateScript, { request })) as ScriptPlan;
    },
    async generateVideoEffect(request) {
      return (await call(PROJECT_COMMANDS.generateVideoEffect, { request })) as EffectRecipe;
    },
    async generateMotion(request) {
      return (await call(PROJECT_COMMANDS.generateMotion, { request })) as MotionSuggestion;
    },
    async assistantChat(request) {
      return (await call(PROJECT_COMMANDS.assistantChat, { request })) as AssistantChatReply;
    },
    async listVoices() {
      const raw = await call(PROJECT_COMMANDS.listVoices);
      return Array.isArray(raw) ? (raw as VoiceInfo[]) : [];
    },
    async synthesizeNarration(input) {
      return (await call(PROJECT_COMMANDS.synthesizeNarration, {
        text: input.text,
        voice: input.voice ?? null,
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
        provider: input.provider ?? null,
      })) as NarrationResult;
    },
    async startRender(profileId, includeCaptions, motionPlans, hardwareEncoder, range) {
      return (await call(PROJECT_COMMANDS.startRender, {
        profileId,
        includeCaptions,
        ...(motionPlans ? { motionPlans } : {}),
        ...(hardwareEncoder ? { hardwareEncoder } : {}),
        ...(range
          ? { startFrame: range.startFrame, endFrame: range.endFrame }
          : {}),
      })) as RenderStarted | null;
    },
    async startRenderTo(
      profileId,
      outputPath,
      includeCaptions,
      motionPlans,
      hardwareEncoder,
      range,
    ) {
      return (await call(PROJECT_COMMANDS.startRenderTo, {
        profileId,
        outputPath,
        includeCaptions,
        ...(motionPlans ? { motionPlans } : {}),
        ...(hardwareEncoder ? { hardwareEncoder } : {}),
        ...(range
          ? { startFrame: range.startFrame, endFrame: range.endFrame }
          : {}),
      })) as RenderStarted | null;
    },
    async chooseExportDirectory() {
      const raw = await call(PROJECT_COMMANDS.chooseExportDirectory);
      return typeof raw === 'string' ? raw : null;
    },
    async cancelRender(jobId) {
      await call(PROJECT_COMMANDS.cancelRender, { jobId });
    },
    async activeRender() {
      const raw = await call(PROJECT_COMMANDS.activeRender);
      return typeof raw === 'string' ? raw : null;
    },
    async pruneRenderCache() {
      const raw = await call(PROJECT_COMMANDS.pruneRenderCache);
      return typeof raw === 'number' ? raw : 0;
    },
    async onRenderProgress(handler) {
      return listen<RenderProgressEvent>('render-progress', (event) => handler(event.payload));
    },
    async onConvertProgress(handler) {
      return listen<ConvertProgress>('convert-progress', (event) => handler(event.payload));
    },
    async onRenderFinished(handler) {
      return listen<RenderFinishedEvent>('render-finished', (event) => handler(event.payload));
    },
    mediaUrl(root, relativePath) {
      const absolute = joinProjectPath(root, relativePath);
      if (!detectNativeRuntime()) {
        return '';
      }
      try {
        return convertFileSrc(absolute);
      } catch {
        return '';
      }
    },
    joinPath: joinProjectPath,
  };
}

/** Tauri recibe el ZIP en base64: 64 MB nunca viajan como números JSON. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function unavailable(): never {
  throw new Error(NATIVE_UNAVAILABLE_REASON);
}

function createUnavailableService(): DesktopService {
  return {
    available: false,
    unavailableReason: NATIVE_UNAVAILABLE_REASON,
    createProject: async () => unavailable(),
    openProject: async () => unavailable(),
    openProjectAt: async () => unavailable(),
    adoptProject: async () => unavailable(),
    saveProject: async () => unavailable(),
    saveProjectAs: async () => unavailable(),
    saveDeliveryPackage: async () => unavailable(),
    closeProject: async () => unavailable(),
    importAssets: async () => unavailable(),
    importMediaPaths: async () => unavailable(),
    importLut: async () => unavailable(),
    chooseSubtitleFile: async () => unavailable(),
    chooseTimelineFile: async () => unavailable(),
    extractFreezeFrame: async () => unavailable(),
    createVideoProxy: async () => unavailable(),
    sampleAssetColor: async () => unavailable(),
    mediaThumbnail: async () => unavailable(),
    recentProjectThumbnail: async () => null,
    checkAssetFiles: async () => unavailable(),
    detectScenes: async () => unavailable(),
    analyzeStabilization: async () => unavailable(),
    analyzeMedia: async () => unavailable(),
    convertMedia: async () => unavailable(),
    convertMediaBatch: async () => unavailable(),
    compressMedia: async () => unavailable(),
    onConvertProgress: async () => () => {},
    mergeVideos: async () => unavailable(),
    trimVideo: async () => unavailable(),
    watermarkVideo: async () => unavailable(),
    setMetadata: async () => unavailable(),
    audioPeaks: async () => unavailable(),
    analyzeMixLoudness: async () => unavailable(),
    onLoudnessAnalysisProgress: async () => () => {},
    hardwareEncoders: async () => unavailable(),
    downloaderStatus: async () => ({
      available: false,
      version: null,
      path: null,
      managed: false,
      canInstall: false,
      hint: NATIVE_UNAVAILABLE_REASON,
    }),
    downloaderBridgeInfo: async () => unavailable(),
    installDownloader: async () => unavailable(),
    chooseDownloadDirectory: async () => unavailable(),
    extensionStatus: async () => unavailable(),
    prepareExtension: async () => unavailable(),
    probeDownload: async () => unavailable(),
    chooseCookiesFile: async () => unavailable(),
    chooseImageFile: async () => unavailable(),
    chooseVideoFile: async () => unavailable(),
    chooseAudioFile: async () => unavailable(),
    probeMediaFile: async () => unavailable(),
    compressAnyFile: async () => unavailable(),
    onCompressProgress: async () => () => {},
    measureVmaf: async () => unavailable(),
    listModels: async () => [],
    downloadModel: async () => unavailable(),
    deleteModel: async () => unavailable(),
    listCapabilities: async () => [],
    listVisualCatalog: async () => unavailable(),
    auditVisuals: async () => unavailable(),
    removeBackground: async () => unavailable(),
    removeBackgroundAsset: async () => unavailable(),
    onBackgroundProgress: async () => () => {},
    upscaleImage: async () => unavailable(),
    denoiseMedia: async () => unavailable(),
    enhanceDialogue: async () => unavailable(),
    onDialogueProgress: async () => unavailable(),
    onDenoiseProgress: async () => () => {},
    saveThumbnail: async () => unavailable(),
    pickThumbnailFrames: async () => unavailable(),
    renderPreviewFrame: async () => unavailable(),
    analyzeScopesFrame: async () => unavailable(),
    exportLookLut: async () => unavailable(),
    exportEdl: async () => unavailable(),
    exportOtio: async () => unavailable(),
    exportFcpxml: async () => unavailable(),
    importTimeline: async () => unavailable(),
    translateSubtitles: async () => unavailable(),
    saveLocalizedSubtitle: async () => unavailable(),
    synthesizeDub: async () => unavailable(),
    onDubProgress: async () => () => {},
    cloneVoice: async () => unavailable(),
    onCloneProgress: async () => () => {},
    lipSync: async () => unavailable(),
    onLipSyncProgress: async () => () => {},
    exportShort: async () => unavailable(),
    analyzeFaceTrack: async () => unavailable(),
    onShortProgress: async () => () => {},
    absoluteFileUrl: () => '',
    downloadMedia: async () => unavailable(),
    cleanupDownload: async () => unavailable(),
    onDownloadProgress: async () => () => {},
    fetchPlatformRules: async () => unavailable(),
    listMcpServers: async () => unavailable(),
    saveMcpServer: async () => unavailable(),
    deleteMcpServer: async () => unavailable(),
    probeMcpServer: async () => unavailable(),
    callMcpTool: async () => unavailable(),
    closeMcpSession: async () => false,
    mcpSessionStatus: async () => [],
    writeProjectVariant: async () => unavailable(),
    renderProjectVariant: async () => unavailable(),
    loadDirectorMemory: async () => unavailable(),
    saveDirectorMemory: async () => unavailable(),
    transcribeAsset: async () => unavailable(),
    systemInfo: async () => unavailable(),
    chooseTool: async () => unavailable(),
    revealOutput: async () => unavailable(),
    getProvider: async () => unavailable(),
    saveProvider: async () => unavailable(),
    clearProviderKey: async () => unavailable(),
    getAudioProvider: async () => unavailable(),
    saveAudioProvider: async () => unavailable(),
    clearAudioProviderKey: async () => unavailable(),
    openExternalUrl: async () => unavailable(),
    savePublicationManifest: async () => unavailable(),
    generateScript: async () => unavailable(),
    generateVideoEffect: async () => unavailable(),
    generateMotion: async () => unavailable(),
    assistantChat: async () => unavailable(),
    listVoices: async () => unavailable(),
    synthesizeNarration: async () => unavailable(),
    startRender: async () => unavailable(),
    startRenderTo: async () => unavailable(),
    chooseExportDirectory: async () => unavailable(),
    cancelRender: async () => unavailable(),
    activeRender: async () => unavailable(),
    pruneRenderCache: async () => unavailable(),
    onRenderProgress: async () => () => {},
    onRenderFinished: async () => () => {},
    mediaUrl: () => '',
    joinPath: joinProjectPath,
  };
}

export function createDesktopService(): DesktopService {
  if (!detectNativeRuntime()) {
    return createUnavailableService();
  }
  return createNativeDesktopService();
}
