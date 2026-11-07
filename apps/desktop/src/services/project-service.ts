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

export interface MediaFolderFile {
  readonly path: string;
  readonly name: string;
  readonly kind: 'image' | 'audio' | 'video' | string;
  readonly bytes: number;
}

export interface MediaFolderListing {
  readonly directory: string;
  readonly files: readonly MediaFolderFile[];
}

export interface FsEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: 'dir' | 'image' | 'audio' | 'video' | 'subtitle' | 'text' | 'other' | string;
  readonly bytes: number;
}

export interface FsListing {
  readonly directory: string;
  readonly entries: readonly FsEntry[];
  readonly truncated: boolean;
}

export interface FsFileContent {
  readonly path: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

export interface FsWriteResult {
  readonly path: string;
  readonly bytes: number;
}

export interface FsDeleteResult {
  readonly path: string;
  readonly recursive: boolean;
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

/**
 * Resultado tipado de «probar conexión» con el proveedor de IA.
 *
 * `status` distingue lo accionable de lo genérico: sin configurar, sin clave,
 * 401, 404, timeout, sin conexión o éxito. La interfaz puede mostrar `detail`
 * tal cual porque el backend ya lo redacta sin rutas ni secretos.
 */
export type ProviderTestStatus =
  | 'ok'
  | 'mock'
  | 'unconfigured'
  | 'missing-key'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'unreachable'
  | 'http-error'
  | 'invalid-response';

export interface ProviderTestResult {
  readonly status: ProviderTestStatus | string;
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  /** Modelo configurado si el proveedor lo lista; si no, el primero listado. */
  readonly model: string | null;
  readonly detail: string;
  readonly baseUrl: string;
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
  | { readonly kind: 'new_project'; readonly name: string }
  | { readonly kind: 'import_file'; readonly path: string }
  | { readonly kind: 'download_url'; readonly url: string }
  | { readonly kind: 'add_clip'; readonly asset: string; readonly atPlayhead: boolean }
  | { readonly kind: 'delete_selected' }
  | { readonly kind: 'split_at_playhead' }
  | { readonly kind: 'goto'; readonly seconds: number }
  | { readonly kind: 'add_caption'; readonly text: string; readonly seconds: number }
  | { readonly kind: 'set_speed'; readonly speed: number }
  | { readonly kind: 'set_gain'; readonly db: number }
  | { readonly kind: 'mute_clip'; readonly muted: boolean }
  | {
      readonly kind: 'cut_silences';
      readonly thresholdDb: number;
      readonly minSilenceSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | { readonly kind: 'auto_subtitles'; readonly scope: 'selection' | 'project' }
  | {
      readonly kind: 'cut_voice_pauses';
      readonly minPauseSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | {
      readonly kind: 'auto_cleanup';
      readonly denoise: 'off' | 'light' | 'medium' | 'strong';
      readonly levelAudio: boolean;
      readonly zoomCuts: boolean;
      readonly cutSilences: boolean;
      readonly cutPauses: boolean;
      readonly targetLufs: number;
    }
  | { readonly kind: 'auto_pilot' }
  | {
      readonly kind: 'motion';
      readonly templateId: string;
      readonly text: string;
      readonly secondary?: string;
    }
  | { readonly kind: 'media_folder'; readonly folder: string }
  /**
   * Delega la edición al cerebro de la app: `report` devuelve el diagnóstico,
   * `safe` aplica sólo lo que no puede romper nada y `all` aplica todo lo que
   * tenga operación disponible.
   */
  | { readonly kind: 'brain'; readonly mode: 'safe' | 'all' | 'report' }
  | {
      readonly kind: 'mcp_call';
      readonly tool: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    };

export interface AssistantChatRequest {
  readonly messages: readonly AssistantMessage[];
  readonly context?: Record<string, unknown>;
  readonly approvedCost: boolean;
}

export interface AssistantChatReply {
  readonly reply: string;
  /** Primera acción para compatibilidad con servicios antiguos. */
  readonly action: AssistantAction | null;
  /** Acciones ordenadas y saneadas; opcional para clientes anteriores. */
  readonly actions?: readonly AssistantAction[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

/** Delta de texto de un streaming de asistente (SSE OpenAI-compatible). */
export interface AssistantStreamDelta {
  readonly streamId: string;
  readonly delta: string;
}

export interface AssistantStreamCompleted {
  readonly streamId: string;
  readonly reply: string;
  readonly action: AssistantAction | null;
  readonly actions?: readonly AssistantAction[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface AssistantStreamFailed {
  readonly streamId: string;
  readonly message: string;
  /** Falló antes del primer delta: se puede reintentar sin streaming. */
  readonly retryable: boolean;
}

export interface AssistantStreamCancelled {
  readonly streamId: string;
}

/** Handlers del streaming; el cierre siempre llega por alguno de los cuatro. */
export interface AssistantStreamHandlers {
  readonly onDelta: (delta: string) => void;
  readonly onCompleted: (reply: AssistantChatReply) => void;
  readonly onFailed: (failure: { readonly message: string; readonly retryable: boolean }) => void;
  readonly onCancelled: () => void;
}

export interface AssistantStreamHandle {
  readonly streamId: string;
  /** Pide al backend que corte; el cierre llega por `onCancelled`. */
  cancel(): void;
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
  /** Reporte FFprobe del archivo entregado (sólo en `completed`). */
  readonly verification?: ExportVerification | null;
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

// ─────────────── Fase 1 · Recuperación, historial y duplicados ───────────────
// Contrato nativo: `choose_media_folder`, `find_missing_assets`, `relink_asset`,
// `relink_assets_from_folder`, `list_project_versions`,
// `restore_project_version`, `find_duplicate_assets`.
//
// Todas las rutas de proyecto son absolutas (la que muestra Recientes). Si se
// omite `projectPath`, el backend usa el proyecto abierto en la sesión.

export interface MissingAssetInfo {
  readonly assetId: string;
  readonly label: string;
  readonly kind: string;
  /** Ruta tal como la guarda el proyecto (relativa a la raíz). */
  readonly path: string;
  /** Clips del timeline que usan este medio (para explicar el impacto). */
  readonly usedByClipIds: readonly string[];
  /** Proxy válido existente (`media/proxies/...`) o null. */
  readonly proxyPath: string | null;
}

export interface RelinkResult {
  readonly ok: boolean;
  readonly assetId?: string;
  /** Ruta nueva relativa al proyecto, cuando `ok`. */
  readonly path?: string;
  /** Copia el archivo dentro de `<root>/media/relink/` si estaba fuera. */
  readonly copied?: boolean;
  /** Validación usada: nombre+tamaño o hash SHA-256. */
  readonly validatedBy?: 'name-size' | 'hash';
  /** Bytes del archivo final (para refrescar `asset.sizeBytes` en la UI). */
  readonly bytes?: number | null;
  /** SHA-256 calculado al validar/copiar; null si no se calculó. */
  readonly sha256?: string | null;
  /** Motivo legible cuando `ok` es false. */
  readonly reason?: string;
  readonly missing?: MissingAssetInfo;
}

export interface RelinkFolderRejected {
  readonly path: string;
  readonly reason: string;
}

export interface RelinkFolderResult {
  /** Resultados por asset: `assetId` + `path` nueva para actualizar el store. */
  readonly relinked: readonly RelinkResult[];
  readonly stillMissing: readonly MissingAssetInfo[];
  readonly rejected: readonly RelinkFolderRejected[];
}

export type ProjectVersionReason =
  | 'autosave'
  | 'manual'
  | 'pre-crash'
  | 'before-restore'
  | 'snapshot'
  | 'rotated';

export interface ProjectVersionInfo {
  /** Identificador estable: nombre del archivo de versión. */
  readonly id: string;
  readonly projectPath: string;
  /** Ruta absoluta del snapshot en `<root>/.olyvia-history/`. */
  readonly path: string;
  readonly savedAtMs: number;
  readonly bytes: number;
  readonly reason: ProjectVersionReason;
  readonly projectName: string | null;
  readonly assetCount: number;
  readonly clipCount: number;
}

export interface RestoreProjectVersionResult {
  /** `in-place` reemplaza el proyecto (con copia previa); `copy` crea otro archivo. */
  readonly restoreMode: 'in-place' | 'copy';
  readonly projectPath: string;
  /** Copia de seguridad del proyecto previo a restaurar (in-place). */
  readonly backupPath: string | null;
  readonly version: ProjectVersionInfo;
}

export interface DuplicateAssetGroup {
  readonly sha256: string;
  readonly bytes: number;
  readonly assetIds: readonly string[];
  readonly labels: readonly string[];
  readonly paths: readonly string[];
  /** Clip ids que usan cada asset (las copias en uso no se eliminan). */
  readonly usedByClipIds: Readonly<Record<string, readonly string[]>>;
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

const ORIENTATIONS = new Set(['landscape', 'portrait', 'square']);
const TEMPERATURES = new Set(['warm', 'cool', 'neutral']);

/**
 * Normaliza la respuesta del backend de comprensión visual. Se usa tanto para
 * imágenes (`analyze_images`) como para cuadros de video
 * (`analyze_media_frames`), así que la validación vive acá una sola vez.
 */
function mapImageContents(raw: unknown): ImageContent[] {
  if (!Array.isArray(raw)) return [];
  const number = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const nullable = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && typeof item.assetId === 'string',
    )
    .map((item): ImageContent => {
      const orientation = String(item.orientation ?? 'square');
      const temperature = String(item.temperature ?? 'neutral');
      return {
        assetId: String(item.assetId ?? ''),
        width: number(item.width),
        height: number(item.height),
        aspect: number(item.aspect, 1),
        orientation: (ORIENTATIONS.has(orientation) ? orientation : 'square') as
          | 'landscape'
          | 'portrait'
          | 'square',
        lumaMean: number(item.lumaMean),
        lumaStd: number(item.lumaStd),
        saturationMean: number(item.saturationMean),
        colorfulness: number(item.colorfulness),
        dominantHue: number(item.dominantHue),
        hueConcentration: number(item.hueConcentration),
        temperature: (TEMPERATURES.has(temperature) ? temperature : 'neutral') as
          | 'warm'
          | 'cool'
          | 'neutral',
        edgeDensity: number(item.edgeDensity),
        sharpness: number(item.sharpness),
        skyBias: number(item.skyBias),
        faceCount: number(item.faceCount),
        faceCenterX: nullable(item.faceCenterX),
        faceCenterY: nullable(item.faceCenterY),
        faceSize: nullable(item.faceSize),
        palette: Array.isArray(item.palette)
          ? item.palette.filter((color): color is string => typeof color === 'string')
          : [],
        sampledAtSeconds:
          typeof item.sampledAtSeconds === 'number' && Number.isFinite(item.sampledAtSeconds)
            ? item.sampledAtSeconds
            : undefined,
        warnings: Array.isArray(item.warnings)
          ? item.warnings.filter((text): text is string => typeof text === 'string')
          : [],
      };
    });
}

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

export interface ExtractedSubtitles {
  readonly language: string | null;
  readonly title: string | null;
  readonly srt: string;
}

/**
 * Picos de audio para dibujar la forma de onda de la timeline.
 *
 * Contrato nativo (`audio_peaks`, FFmpeg + FFprobe):
 * - `buckets` default 600; el backend lo limita a [16, 4000] y devuelve el
 *   valor efectivo en `buckets` (nunca es mayor que 4000).
 * - `peaks` tiene exactamente `buckets` pares `{ min, max }` mono en [-1, 1];
 *   son muestras, no amplitudes normalizadas a [0, 1].
 * - `durationSeconds` viene de la primera pista de audio; puede ser 0 cuando el
 *   contenedor no declara duración.
 * - Sin audio, asset inexistente o FFmpeg/FFprobe ausentes el comando rechaza
 *   con `ProjectError` (no devuelve un array vacío).
 */
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

/**
 * Matriz REAL de lo que el FFmpeg de la app puede exportar, sondeada con
 * `-encoders` (comando `export_capabilities`). La UI no debe ofrecer nada que
 * no esté acá: contenedores/códecs no soportados por el build aparecen fuera o
 * con listas vacías. Este FFmpeg LGPL no incluye x264/x265 por licencia, pero
 * sí `libopenh264`/`h264_mf`/hardware; por eso las listas son dinámicas.
 */
export interface ExportCapabilities {
  readonly containers: readonly {
    readonly container: 'mp4' | 'mov' | 'webm';
    readonly videoCodecs: readonly string[];
    readonly audioCodecs: readonly string[];
  }[];
  readonly pixelFormats: readonly string[];
  readonly videoCodecs: Readonly<
    Record<string, { readonly software: readonly string[]; readonly hardware: readonly string[] }>
  >;
  readonly audioCodecs: readonly string[];
  /** Metadatos HDR10/HLG: el build actual NO los inyecta (siempre SDR). */
  readonly hdr: boolean;
  readonly maxWidth: number;
  readonly maxHeight: number;
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

export interface CopiedMedia {
  readonly source: string;
  readonly relativePath: string;
  readonly bytes: number;
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

export interface LosslessResult {
  readonly path: string;
  readonly bytes: number;
  readonly requestedSeconds: number;
  readonly actualSeconds: number;
  readonly startShiftSeconds: number;
}

export interface PluginCommandInfo {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly string[];
}

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly official: boolean;
  readonly kind: 'plugin' | 'skill' | 'connector';
  readonly mcp: { readonly command: string; readonly args: readonly string[]; readonly env: readonly string[] } | null;
  readonly enabled: boolean;
  readonly directory: string;
  readonly error: string | null;
  readonly presets: {
    readonly effects: readonly unknown[];
    readonly exportProfiles: readonly unknown[];
    readonly captionStyles: readonly unknown[];
  };
  readonly commands: readonly PluginCommandInfo[];
}

export interface McpServerInfo {
  readonly url: string;
  readonly token: string;
}

/** Un cliente de IA (Claude Desktop, Antigravity…) que Olyvia sabe conectar con un clic. */
export interface McpDetectedClient {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly downloadUrl: string;
}

export interface McpAutoconnectResult {
  readonly client: string;
  readonly configPath: string;
  readonly message: string;
}

export interface DiarizeProviderInfo {
  readonly kind: string;
  readonly baseUrl: string;
  readonly language: string;
  readonly hasKey: boolean;
}

export interface DiarizeResult {
  readonly provider: string;
  readonly segments: readonly {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly speaker: string;
  }[];
}

export interface FileLoudness {
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  readonly lraLu: number;
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

export interface VoiceIsolationStatus {
  readonly available: boolean;
  readonly python: string | null;
  readonly reason: string | null;
}

export interface VoiceIsolationOutcome {
  readonly vocalsPath: string;
  readonly accompanimentPath: string | null;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly processingTimeMs: number;
  /** true cuando se reutilizó un stem ya generado (no corrió el modelo). */
  readonly cached: boolean;
}

export interface FlowBrowserStatus {
  readonly browser: string | null;
  readonly browserName: string | null;
  readonly running: boolean;
  readonly port: number | null;
  readonly cdpUrl: string | null;
  readonly profileDir: string;
  readonly reason: string | null;
}

export interface FlowEmbedStatus {
  readonly open: boolean;
  readonly url: string | null;
  readonly cdpUrl: string | null;
}

export interface WebSessionInfo {
  readonly name: string;
  readonly url: string | null;
  readonly cdpUrl: string | null;
}

export interface WebSessionsStatus {
  readonly sessions: readonly WebSessionInfo[];
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

export interface ScreenRecordStatus {
  readonly recording: boolean;
  readonly output?: string;
  readonly elapsedSecs?: number;
  readonly bytes?: number;
  readonly webcam?: string;
  readonly streaming?: boolean;
}

export interface ScreenRecordResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly bytes?: number;
  readonly durationSecs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasAudio?: boolean;
  readonly error?: string;
}

export interface SubtitlePipelineResult {
  readonly ok: boolean;
  readonly assPath?: string;
  readonly outputPath?: string | null;
  readonly cues?: number;
  readonly language?: string;
  readonly translated?: boolean;
  readonly simulated?: boolean;
  readonly burned?: boolean;
}

export interface BrowserInstanceInfo {
  readonly id: string;
  readonly port: number;
  readonly pid?: number;
  readonly cdpUrl: string;
  readonly profileDir: string;
  readonly proxy?: string;
  readonly browser: string;
}

export interface ObsScene {
  readonly id: string;
  readonly name: string;
  readonly fps?: number;
  readonly captureTarget?: 'desktop' | 'window' | 'region';
  readonly windowTitle?: string;
  readonly regionX?: number;
  readonly regionY?: number;
  readonly regionWidth?: number;
  readonly regionHeight?: number;
  readonly webcamDevice?: string;
  readonly audioDevice?: string;
  readonly streamUrl?: string;
  readonly encoder?: 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
  readonly captureScreen?: boolean;
}

export type ObsSceneInput = Omit<ObsScene, 'id'> & { readonly id?: string };

export interface StickmanRenderResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly action?: string;
  readonly frames?: number;
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly probeWidth?: number | null;
  readonly probeHeight?: number | null;
  readonly hasAudio?: boolean;
  readonly verified?: boolean;
}

export interface CaptureDevices {
  readonly cameras: readonly string[];
  readonly microphones: readonly string[];
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

export interface SponsorSegment {
  readonly category: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly action: string;
}

export interface WatchFile {
  readonly path: string;
  readonly name: string;
  readonly modifiedSeconds: number;
  readonly urls: readonly string[];
}

export interface RssItem {
  readonly title: string;
  readonly link: string;
  readonly published: string | null;
}

export interface AudioTrack {
  readonly formatId: string;
  readonly language: string | null;
  readonly ext: string | null;
  readonly abr: number | null;
  readonly note: string | null;
}

export interface PlaylistEntry {
  readonly index: number;
  readonly title: string;
  readonly url: string | null;
  readonly durationSeconds: number | null;
}

export interface WatchdogStatus {
  readonly installed: boolean;
  readonly tasks: readonly string[];
  readonly hint: string;
}

export interface SourceChecksum {
  readonly md5: string | null;
  readonly sha256: string | null;
  readonly source: string;
}

export interface ProxyHealth {
  readonly proxy: string;
  readonly ok: boolean;
  readonly latencyMs: number | null;
  readonly error: string | null;
}

export interface DownloadRequest {
  readonly url: string;
  /** UUID estable para reanudar un trabajo y reutilizar sus `.part`. */
  readonly runId?: string | null;
  readonly maxHeight?: number | null;
  readonly compression: 'none' | 'high' | 'balanced' | 'compact';
  readonly codec: 'h265' | 'h264' | 'av1';
  /** `tonemap` convierte HDR a SDR; `preserve` mantiene HEVC 10-bit. */
  readonly hdrMode?: 'tonemap' | 'preserve' | null;
  /** Objetivo de tamaño final en MB; reemplaza al CRF. */
  readonly targetSizeMb?: number | null;
  /** Conserva el original además del archivo procesado. */
  readonly keepOriginal?: boolean;
  readonly kind: DownloadProbe['kind'];
  readonly playlist?: boolean;
  readonly cookiesFile?: string | null;
  /** `chrome`, `edge`, `firefox`, `brave`, `chromium`, `opera` o `vivaldi`. */
  readonly cookiesFromBrowser?: string | null;
  readonly format?: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
  /** Save permanently to Descargas/Videos descargados/<platform>. */
  readonly saveToDownloads?: boolean;
  /** `best`, `worst`, or `height` when maxHeight carries the exact cap. */
  readonly quality?: 'best' | 'worst' | 'height';
  /** Absolute folder chosen by the person; defaults to Downloads/Videos descargados. */
  readonly destinationRoot?: string | null;
  /** Look cinematográfico 35 mm: 60 fps por flujo óptico, 0.98×, grano, zoom 4 %, espejo. */
  readonly cinematic?: boolean;
  readonly cinematicFocus?: 'center' | 'left' | 'right' | 'top' | 'bottom';
  /** Ruta absoluta de la banda sonora que reemplaza al audio original; null = sin audio. */
  readonly replacementAudio?: string | null;
  /** Pipeline automático: denoise + cine + H.265 CRF 22 + MD5 + limpieza. */
  readonly autoPipeline?: boolean;
  /** Procesa el audio original: 1.02× con atempo + ruido rosa a -50 dB. */
  readonly audioSpeedNoise?: boolean;
  /** Genera narración con Piper TTS local y la usa como audio final. */
  readonly voicePipeline?: boolean;
  readonly voiceScript?: string | null;
  /** Superpone watermark.png sobre el video procesado. */
  readonly watermark?: boolean;
  /** Parche delogo proporcional para una marca fija. */
  readonly delogo?: boolean;
  readonly delogoCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | null;
  /** Rectángulo manual en fracciones 0–1; reemplaza la esquina. */
  readonly delogoRect?: { x: number; y: number; w: number; h: number } | null;
  /** Escalado Lanczos sólo si el origen queda debajo del objetivo. */
  readonly upscale?: boolean;
  readonly upscaleTarget?: 'auto' | '1080' | '2160' | null;
  /**
   * Enrutamiento automático por metadatos: ≤60 s look completo + Piper;
   * >60 s espejo/zoom 4 % sin flujo óptico; títulos musicales conservan audio.
   */
  readonly autoRoute?: boolean;
  readonly sourceTitle?: string | null;
  readonly sourceDuration?: number | null;
  /** Proxy HTTP/SOCKS para el motor yt-dlp. */
  readonly proxy?: string | null;
  /** Límite global de bajada, por ejemplo `500K` u `8M`. */
  readonly limitRate?: string | null;
  readonly downloadSubtitles?: boolean;
  /** Idiomas para yt-dlp, por ejemplo `es.*,en.*`. */
  readonly subtitleLangs?: string | null;
  readonly downloadThumbnail?: boolean;
  readonly downloadChapters?: boolean;
  readonly sponsorblock?: boolean;
  /** Categorías separadas por coma. */
  readonly sponsorblockCategories?: string | null;
  /** Categorías que se marcan como capítulo en vez de eliminarse. */
  readonly sponsorblockMark?: string | null;
  /** Categorías cuyos tramos se silencian después de descargar. */
  readonly sponsorblockMute?: string | null;
  /** Plantilla de nombre; acepta {title}, {id}, {platform}, {height} y {date}. */
  readonly filenameTemplate?: string | null;
  /** Elementos de playlist: `1-10`, `1,3,5`. */
  readonly playlistItems?: string | null;
  /** Idioma de audio preferido (`es`, `en`, `pt-BR`) o `all`. */
  readonly audioLanguage?: string | null;
  readonly audioFormatId?: string | null;
  /** Metadatos del contenedor final y carátula incrustada. */
  readonly metadataTitle?: string | null;
  readonly metadataArtist?: string | null;
  readonly metadataComment?: string | null;
  readonly coverPath?: string | null;
  /** Calcula MD5 y SHA-256 de todos los archivos. */
  readonly hashFiles?: boolean;
  /** SHA-256 esperado; si no coincide con ningún archivo, falla. */
  readonly expectedSha256?: string | null;
  /** Recorte previo en segundos. */
  readonly trimStart?: number | null;
  readonly trimEnd?: number | null;
  /** Tamaño estimado del probe para el chequeo de disco. */
  readonly estimatedBytes?: number | null;
}

export interface DownloadedChapter {
  readonly startSeconds: number;
  readonly title: string;
}

export interface DownloadedSubtitle {
  readonly path: string;
  readonly name: string;
  readonly text: string;
}

export interface DownloadedFile {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly kind: 'video' | 'image' | 'audio' | 'other';
  readonly md5?: string | null;
  readonly sha256?: string | null;
  readonly chapters?: readonly DownloadedChapter[];
}

export interface DownloadOutcome {
  readonly runId: string;
  readonly directory: string;
  readonly files: readonly DownloadedFile[];
  readonly compressed: boolean;
  readonly warnings: readonly string[];
  readonly subtitles?: readonly DownloadedSubtitle[];
}

export interface DownloadProgressEvent {
  /** Vacío en eventos del motor (instalación) y presente en cada descarga. */
  readonly runId: string;
  readonly stage: 'engine' | 'probing' | 'downloading' | 'compressing' | 'importing' | 'done';
  readonly percent: number | null;
  readonly message: string;
}

export interface CreatorOutput {
  readonly path: string;
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly bytes: number;
}

export interface CreatorHookRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly hookText: string;
  readonly zoomPercent?: number;
  readonly soundGainDb?: number;
}

export interface CreatorMultiAspectRequest {
  readonly inputPath: string;
  readonly outputDir: string;
  readonly aspects?: readonly ('vertical' | 'horizontal' | 'square')[];
}

export interface CreatorCtaRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly ctaText: string;
  readonly url: string;
  readonly ctaSeconds?: number;
  readonly addQr?: boolean;
}

export interface CreatorSplitChaptersRequest {
  readonly inputPath: string;
  readonly outputDir: string;
}

export interface CreatorBurnSubtitlesRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly subtitleText: string;
}

export interface CreatorBrollRequest {
  readonly inputPath: string;
  readonly brollDir: string;
  readonly outputPath: string;
  readonly intervalSeconds?: number;
  readonly clipSeconds?: number;
  readonly maxInsertions?: number;
}

export interface ChannelAnalysisRequest {
  readonly channelUrl: string;
  readonly maxVideos?: number;
  readonly detailCount?: number;
  readonly includeComments?: boolean;
  readonly commentVideos?: number;
}

export interface ChannelProgressEvent {
  readonly stage: 'listing' | 'details' | 'thumbnails' | 'comments';
  readonly current: number;
  readonly total: number;
  readonly message: string;
}

export interface YouTubeThumbnailStats {
  readonly width: number;
  readonly height: number;
  /** Porcentaje 0–100. */
  readonly brightness: number;
  /** Porcentaje 0–100. */
  readonly saturation: number;
  /** Porcentaje 0–100. */
  readonly contrast: number;
  readonly palette: readonly string[];
  readonly preview: string;
}

export interface YouTubeKeywordCount {
  readonly keyword: string;
  readonly count: number;
}

export interface YouTubeTopComment {
  readonly author: string;
  readonly text: string;
  readonly likes: number;
  readonly videoTitle: string;
}

export interface YouTubeCommentAnalysis {
  readonly analyzed: number;
  readonly positivePercent: number;
  readonly negativePercent: number;
  readonly neutralPercent: number;
  readonly keywords: readonly YouTubeKeywordCount[];
  readonly topComments: readonly YouTubeTopComment[];
}

export interface YouTubeChannelVideo {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly views: number;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly durationSeconds: number;
  readonly uploadDate: string | null;
  readonly viewsPerDay: number;
  readonly engagementRate: number;
  readonly score: number;
  readonly titleFlags: readonly string[];
  readonly reasons: readonly string[];
  readonly thumbnailUrl: string | null;
  readonly thumbnail: YouTubeThumbnailStats | null;
  readonly commentAnalysis: YouTubeCommentAnalysis | null;
}

export interface YouTubeChannelInsights {
  readonly medianViews: number;
  readonly averageEngagement: number;
  readonly uploadsPerWeek: number;
  readonly bestWeekday: string | null;
  readonly bestHourUtc: number | null;
  readonly medianDurationSeconds: number;
  readonly commonTitleWords: readonly YouTubeKeywordCount[];
  readonly titlePatterns: {
    readonly numbersPercent: number;
    readonly questionsPercent: number;
    readonly howToPercent: number;
    readonly listsPercent: number;
  };
  readonly thumbnailAverage: {
    readonly brightness: number;
    readonly saturation: number;
    readonly contrast: number;
    readonly samples: number;
  } | null;
  readonly comments: YouTubeCommentAnalysis | null;
  readonly strengths: readonly string[];
  readonly opportunities: readonly string[];
}

export interface YouTubeChannelReport {
  readonly channelName: string;
  readonly channelUrl: string;
  readonly subscribers: number | null;
  readonly listedVideos: number;
  readonly analyzedVideos: number;
  readonly totalVideos: number | null;
  readonly bestVideoId: string;
  readonly bestReasonSummary: string;
  readonly videos: readonly YouTubeChannelVideo[];
  readonly insights: YouTubeChannelInsights;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
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
  listMediaFolder(input: {
    folder: string;
    root?: string;
  }): Promise<MediaFolderListing>;
  /** Lista el contenido de una carpeta de la PC (carpetas primero, sin recursión). */
  listDirectory(path: string): Promise<FsListing>;
  /** Lee un archivo de texto acotado (512 KiB máx). */
  readTextFile(path: string): Promise<FsFileContent>;
  /** Escribe texto en un archivo del disco (crea carpetas padre). Tope 10 MiB. */
  writeTextFile(path: string, content: string): Promise<FsWriteResult>;
  /** Crea una carpeta en el disco (padres incluidos por defecto). */
  makeDirectory(path: string, recursive?: boolean): Promise<FsWriteResult>;
  /** Borra un archivo o carpeta del disco; carpetas con contenido exigen recursive=true. */
  deletePath(path: string, recursive?: boolean): Promise<FsDeleteResult>;
  /** Mueve o renombra un archivo/carpeta del disco (el destino no debe existir). */
  movePath(from: string, to: string): Promise<FsWriteResult>;
  matchMediaPlan(input: {
    sentences: readonly string[];
    images: readonly string[];
    /** Descripción medida del contenido, alineada con `images` por índice. */
    imageDescriptions?: readonly string[];
    approvedCost?: boolean;
  }): Promise<MatchMediaPlanResult>;
  analyzeImages(assetIds: readonly string[]): Promise<ImageContent[]>;
  /**
   * Igual que `analyzeImages`, pero también acepta videos: mide el cuadro del
   * punto medio de cada uno. Es lo que le permite al asistente *ver* los clips.
   */
  analyzeMediaFrames(assetIds: readonly string[]): Promise<ImageContent[]>;
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
  /**
   * Estado del proxy de un asset de video (cacheada por asset+calidad+huella del
   * origen). Nunca genera: sólo informa y verifica el MP4 con FFprobe.
   */
  proxyStatus(assetId: string): Promise<ProxyStatus>;
  /**
   * Asegura un proxy H.264 para vista previa; si no existe o está viejo lo
   * empieza en segundo plano y devuelve el estado `queued`/`generating`.
   * El progreso llega por `onProxyProgress` (`proxy-progress`).
   */
  ensureProxy(assetId: string, quality?: ProxyQuality): Promise<ProxyStatus>;
  /** Cancela la generación en curso (si hay) y libera el archivo parcial. */
  cancelProxy(assetId: string): Promise<ProxyStatus>;
  /**
   * Persiste el proxy en el documento (`asset.proxy`) y lo guarda, para que la
   * reproducción nativa lo use sin tocar el Asset desde la UI. Valida que el
   * proxy exista y esté `upToDate`; devuelve el Asset actualizado o null si no
   * hay proxy listo (nunca deja el documento apuntando a un archivo faltante).
   */
  applyProxyToAsset(assetId: string): Promise<Asset | null>;
  /** Borra proxies obsoletos (o todos los de un asset) y devuelve el espacio liberado. */
  cleanupProxies(assetId?: string): Promise<ProxyCleanupResult>;
  onProxyProgress(handler: (event: ProxyProgressEvent) => void): Promise<UnlistenFn>;
  sampleAssetColor(input: {
    readonly path: string;
    readonly seconds: number;
  }): Promise<SampledColor>;
  mediaThumbnail(path: string, isImage: boolean): Promise<string>;
  recentProjectThumbnail(path: string): Promise<string | null>;
  checkAssetFiles(paths: string[]): Promise<AssetFileInfo[]>;
  /**
   * Fase 1 · Proyecto: medios faltantes, relink, historial y duplicados.
   * `projectPath` absoluto; si se omite se usa el proyecto abierto.
   */
  chooseMediaFolder(title?: string): Promise<string | null>;
  findMissingAssets(projectPath?: string): Promise<MissingAssetInfo[]>;
  /**
   * Repunta un asset a `newPath` (absoluto). Si está fuera de la raíz del
   * proyecto se copia a `<root>/media/relink/` y `copied` es true. Valida
   * existencia y nombre+tamaño; si el asset declara SHA-256 y el archivo lo
   * contradice, rechaza. Devuelve `bytes` (y `sha256` si se calculó) para que la
   * UI refresque `asset.integrity`. Requiere el proyecto abierto en la sesión.
   * Un proxy NO es un origen válido de relink: es sólo de previsualización.
   */
  relinkAsset(assetId: string, newPath: string): Promise<RelinkResult>;
  /**
   * Relink masivo desde una carpeta: empareja faltantes por nombre+tamaño y
   * devuelve la ruta nueva de cada asset relinkeado.
   */
  relinkAssetsFromFolder(
    projectPath: string | null,
    folder: string,
  ): Promise<RelinkFolderResult>;
  /** Snapshots de `<root>/.olyvia-history/`, del más nuevo al más viejo. */
  listProjectVersions(projectPath?: string): Promise<ProjectVersionInfo[]>;
  /**
   * Restaura una versión. `in-place` reemplaza el proyecto guardando antes un
   * snapshot `before-restore`; `copy` crea `<nombre>-restored-<n>.editoria.json`.
   */
  restoreProjectVersion(
    projectPath: string,
    versionId: string,
    mode?: 'in-place' | 'copy',
  ): Promise<RestoreProjectVersionResult>;
  /** Grupos de assets con contenido idéntico (SHA-256 del archivo). */
  findDuplicateAssets(projectPath?: string): Promise<DuplicateAssetGroup[]>;
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
    includeSamples?: boolean,
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
  /** Extrae el primer subtítulo incrustado (prefiere español) sin IA. */
  extractSubtitles(path: string): Promise<ExtractedSubtitles | null>;
  /**
   * Picos min/max por bucket de un asset del proyecto abierto.
   * `buckets` default 600, acotado por el backend a [16, 4000].
   */
  audioPeaks(assetId: string, buckets?: number): Promise<AudioPeaks>;
  /** Picos de un archivo suelto, sin proyecto abierto (cola de carpeta). */
  audioPeaksPath(path: string, buckets?: number): Promise<AudioPeaks>;
  /** Loudness de un archivo ya renderizado (lazo cerrado de entrega). */
  measureFileLoudness(path: string): Promise<FileLoudness>;
  /** Fija rutas de FFmpeg/FFprobe sin diálogo. */
  setToolPaths(input: { ffmpeg?: string; ffprobe?: string }): Promise<void>;
  getDiarizeProvider(): Promise<DiarizeProviderInfo>;
  saveDiarizeProvider(input: {
    kind: string;
    baseUrl: string;
    language: string;
    apiKey?: string;
  }): Promise<DiarizeProviderInfo>;
  /** Hablantes por proveedor externo (Deepgram o AssemblyAI). */
  diarizeAudio(path: string, language?: string): Promise<DiarizeResult>;
  /** Corta un rango de un archivo sin recodificar (copia de paquetes). */
  exportLossless(input: {
    input: string;
    output: string;
    startSeconds: number;
    endSeconds: number;
    exact?: boolean;
  }): Promise<LosslessResult>;
  /** Escribe capítulos y título en una copia, sin recodificar. */
  writeChapters(input: {
    input: string;
    output: string;
    title?: string;
    chapters: readonly { startSeconds: number; endSeconds: number; title: string }[];
  }): Promise<{ path: string; bytes: number; chapters: number }>;
  /** Extrae la pista de audio sin recodificar. */
  extractAudio(input: { input: string; output: string }): Promise<{ path: string; bytes: number; codec: string }>;
  /** Cambia el contenedor sin recodificar. */
  remux(input: { input: string; output: string }): Promise<LosslessResult>;
  /** Plugins instalados (oficiales y de usuario). */
  listPlugins(): Promise<readonly PluginInfo[]>;
  installPlugin(path: string): Promise<PluginInfo>;
  removePlugin(id: string): Promise<void>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  /** Proxy por cuenta de Google Flow (se escribe en proxies.json del MCP). */
  getFlowProxies(): Promise<Record<string, string>>;
  setFlowProxy(accountId: string, proxy: string | null): Promise<Record<string, string>>;
  /** Servidor MCP local para que una IA externa maneje la app. */
  startMcpServer(): Promise<McpServerInfo>;
  mcpServerStatus(): Promise<McpServerInfo | null>;
  mcpRespond(id: string, ok: boolean, text: string): Promise<boolean>;
  /** Clientes de IA que Olyvia sabe conectar con un botón (detecta si están instalados). */
  mcpDetectClients(): Promise<readonly McpDetectedClient[]>;
  /** Arranca el servidor MCP si hace falta y conecta ese cliente con un clic. */
  mcpAutoconnect(client: string): Promise<McpAutoconnectResult>;
  onMcpCall(
    handler: (payload: { readonly id: string; readonly tool: string; readonly args: unknown }) => void,
  ): Promise<UnlistenFn>;
  /**
   * Mide el loudness de la mezcla del proyecto guardado (BS.1770-4 / EBU R128)
   * con el grafo de audio real del export, previo a la normalización.
   */
  analyzeMixLoudness(profileId?: string): Promise<MixLoudnessReport>;
  onLoudnessAnalysisProgress(
    handler: (event: LoudnessAnalysisProgress) => void,
  ): Promise<UnlistenFn>;
  hardwareEncoders(): Promise<HardwareEncoders>;
  /** Matriz real de contenedores/códecs/pixel format que este FFmpeg soporta. */
  exportCapabilities(): Promise<ExportCapabilities>;
  /** Verifica un archivo exportado con FFprobe y devuelve un reporte legible. */
  verifyExport(path: string): Promise<ExportVerification>;
  downloaderStatus(): Promise<DownloaderStatus>;
  downloaderBridgeInfo(): Promise<DownloaderBridgeInfo>;
  installDownloader(): Promise<DownloaderStatus>;
  updateDownloader(): Promise<DownloaderStatus>;
  pauseDownload(runId?: string | null): Promise<boolean>;
  resumeDownload(runId?: string | null): Promise<boolean>;
  cancelDownload(runId?: string | null): Promise<boolean>;
  creatorInjectHook(request: CreatorHookRequest): Promise<CreatorOutput>;
  creatorExportMultiAspect(request: CreatorMultiAspectRequest): Promise<CreatorOutput[]>;
  creatorInjectCta(request: CreatorCtaRequest): Promise<CreatorOutput>;
  creatorInterleaveBroll(request: CreatorBrollRequest): Promise<CreatorOutput>;
  creatorSplitChapters(request: CreatorSplitChaptersRequest): Promise<CreatorOutput[]>;
  creatorBurnSubtitles(request: CreatorBurnSubtitlesRequest): Promise<CreatorOutput>;
  downloadDiskSpace(path?: string | null): Promise<number>;
  chooseDownloadDirectory(): Promise<string | null>;
  extensionStatus(): Promise<ExtensionInstallStatus>;
  prepareExtension(): Promise<ExtensionInstallStatus>;
  probeDownload(
    url: string,
    cookiesFile?: string | null,
    cookiesFromBrowser?: string | null,
  ): Promise<DownloadProbe>;
  sponsorblockPreview(url: string, categories?: string | null): Promise<SponsorSegment[]>;
  notifyUser(title: string, body: string): Promise<void>;
  scanWatchFolder(path: string): Promise<WatchFile[]>;
  fetchRssFeed(url: string, limit?: number | null): Promise<RssItem[]>;
  testProxy(proxy: string): Promise<ProxyHealth>;
  probeSourceChecksum(url: string): Promise<SourceChecksum>;
  listPlaylistEntries(url: string, limit?: number | null): Promise<PlaylistEntry[]>;
  listAudioTracks(url: string): Promise<AudioTrack[]>;
  installWatchdog(): Promise<WatchdogStatus>;
  removeWatchdog(): Promise<WatchdogStatus>;
  watchdogStatus(): Promise<WatchdogStatus>;
  chooseCookiesFile(): Promise<string | null>;
  downloadMedia(request: DownloadRequest): Promise<DownloadOutcome>;
  cleanupDownload(runId: string): Promise<void>;
  onDownloadProgress(handler: (event: DownloadProgressEvent) => void): Promise<UnlistenFn>;
  analyzeYoutubeChannel(request: ChannelAnalysisRequest): Promise<YouTubeChannelReport>;
  onChannelAnalysisProgress(
    handler: (event: ChannelProgressEvent) => void,
  ): Promise<UnlistenFn>;
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
  /** Escribe un proyecto sin sesión abierta (cola por carpeta). */
  writeProjectFile(input: {
    directory: string;
    fileName: string;
    project: unknown;
  }): Promise<VariantWritten>;
  /** Copia material externo a `media/` de la carpeta de entrega. */
  copyMediaInto(input: {
    directory: string;
    paths: readonly string[];
  }): Promise<readonly CopiedMedia[]>;
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
  voiceIsolationStatus(): Promise<VoiceIsolationStatus>;
  voiceIsolateMedia(
    inputPath: string,
    model?: string,
    quality?: string,
  ): Promise<VoiceIsolationOutcome>;
  /**
   * Genera (o reutiliza) el stem `vocals.wav` de un asset del proyecto en
   * `media/isolation/<assetId>/`. El render lo usa automáticamente en los
   * clips cuyo `audio.voiceIsolation.enabled` está activo.
   */
  voiceIsolationPrepare(
    assetId: string,
    quality?: string,
    force?: boolean,
  ): Promise<VoiceIsolationOutcome>;
  flowBrowserStatus(): Promise<FlowBrowserStatus>;
  flowBrowserLaunch(url?: string): Promise<FlowBrowserStatus>;
  flowBrowserStop(): Promise<boolean>;
  flowEmbedStatus(): Promise<FlowEmbedStatus>;
  flowEmbedOpen(url?: string): Promise<FlowEmbedStatus>;
  flowEmbedClose(): Promise<boolean>;
  flowEmbedNav(direction: 'back' | 'forward' | 'reload'): Promise<boolean>;
  flowEmbedEval(js: string): Promise<string>;
  webSessionsStatus(): Promise<WebSessionsStatus>;
  webSessionOpen(url: string, slot?: string): Promise<WebSessionsStatus>;
  webSessionClose(slot?: string): Promise<boolean>;
  webSessionNav(direction: 'back' | 'forward' | 'reload', slot?: string): Promise<boolean>;
  webSessionEval(js: string, slot?: string): Promise<string>;
  flowGenerateImage(input: {
    prompt: string;
    outputDir: string;
    slot?: string;
    url?: string;
    timeoutSecs?: number;
    reuseProject?: boolean;
  }): Promise<FlowGenerateResult>;
  screenRecordStatus(): Promise<ScreenRecordStatus>;
  screenRecordDevices(): Promise<CaptureDevices>;
  screenRecordStart(input: {
    outputDir: string;
    fps?: number;
    webcamDevice?: string;
    captureScreen?: boolean;
    captureTarget?: 'desktop' | 'window' | 'region';
    windowTitle?: string;
    regionX?: number;
    regionY?: number;
    regionWidth?: number;
    regionHeight?: number;
    audioDevice?: string;
    streamUrl?: string;
    encoder?: 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
  }): Promise<ScreenRecordStatus>;
  screenRecordStop(): Promise<ScreenRecordResult>;
  subtitlesPipeline(input: {
    inputPath: string;
    outputPath?: string;
    targetLanguage?: string;
    sourceLanguage?: string;
    model?: string;
    burn?: boolean;
  }): Promise<SubtitlePipelineResult>;
  browserInstanceLaunch(input: {
    profileId: string;
    proxyUrl?: string;
    url?: string;
  }): Promise<BrowserInstanceInfo>;
  browserInstanceClose(profileId: string): Promise<boolean>;
  browserInstanceList(): Promise<BrowserInstanceInfo[]>;
  browserInstanceNavigate(profileId: string, url: string): Promise<boolean>;
  browserInstanceEval(profileId: string, expression: string): Promise<unknown>;
  obsSceneList(): Promise<ObsScene[]>;
  obsSceneSave(scene: ObsSceneInput): Promise<ObsScene>;
  obsSceneDelete(id: string): Promise<boolean>;
  obsSceneStart(id: string, outputDir: string): Promise<ScreenRecordStatus>;
  stickmanRender(input: {
    outputPath: string;
    action?: 'idle' | 'walk' | 'run' | 'wave' | 'jump';
    durationSeconds?: number;
    fps?: number;
    width?: number;
    height?: number;
    keyframes?: { frame: number }[];
    boneHex?: string;
    bgHex?: string;
    particles?: { kind?: 'confetti' | 'snow' | 'sparks'; count?: number; colorHex?: string };
  }): Promise<StickmanRenderResult>;
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
  /** Prueba la conexión con el proveedor configurado (Ajustes → IA). */
  testProvider(): Promise<ProviderTestResult>;
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
  /**
   * Streaming del asistente por eventos. Si el backend no lo soporta o falla
   * antes del primer delta, el llamador conserva `assistantChat` como fallback.
   */
  assistantChatStream(
    request: AssistantChatRequest,
    handlers: AssistantStreamHandlers,
    streamId?: string,
  ): Promise<AssistantStreamHandle>;
  /** Cancela un streaming en curso; `true` si estaba activo. */
  cancelAssistantChat(streamId: string): Promise<boolean>;
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
  /** Escribe un lote de frames PNG RGBA para una secuencia temporal. */
  writeAlphaFrames(request: AlphaFramesRequest): Promise<void>;
  /** Codifica la secuencia como WebM VP9 con alfa y la agrega a Medios. */
  alphaFramesToAsset(request: AlphaSequenceRequest): Promise<Asset>;
  /** Borra los frames temporales cuando la conversión no termina. */
  discardAlphaFrames(token: string): Promise<void>;
  upscaleImage(inputPath: string): Promise<UpscaleResult>;
  denoiseMedia(request: DenoiseRequest): Promise<DenoiseResult>;
  onDenoiseProgress(handler: (event: DenoiseProgress) => void): Promise<UnlistenFn>;
  /** Aplica la cadena de definición: limpieza, escalado, enfoque, curva y grano. */
  sharpenMedia(request: SharpenRequest): Promise<SharpenResult>;
  onSharpenProgress(handler: (event: SharpenProgress) => void): Promise<UnlistenFn>;
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
  listMediaFolder: 'list_media_folder',
  fsList: 'fs_list',
  fsRead: 'fs_read',
  fsWrite: 'fs_write',
  fsMkdir: 'fs_mkdir',
  fsDelete: 'fs_delete',
  fsMove: 'fs_move',
  matchMediaPlan: 'match_media_plan',
  analyzeImages: 'analyze_images',
  analyzeMediaFrames: 'analyze_media_frames',
  importLut: 'import_lut',
  chooseSubtitleFile: 'choose_subtitle_file',
  chooseTimelineFile: 'choose_timeline_file',
  extractFreezeFrame: 'extract_freeze_frame',
  createVideoProxy: 'create_video_proxy',
  proxyStatus: 'proxy_status',
  ensureProxy: 'ensure_proxy',
  cancelProxy: 'cancel_proxy',
  applyProxyToAsset: 'apply_proxy_to_asset',
  cleanupProxies: 'cleanup_proxies',
  sampleAssetColor: 'sample_asset_color',
  thumbnail: 'media_thumbnail',
  recentProjectThumbnail: 'recent_project_thumbnail',
  checkAssets: 'check_asset_files',
  chooseMediaFolder: 'choose_media_folder',
  findMissingAssets: 'find_missing_assets',
  relinkAsset: 'relink_asset',
  relinkAssetsFromFolder: 'relink_assets_from_folder',
  listProjectVersions: 'list_project_versions',
  restoreProjectVersion: 'restore_project_version',
  findDuplicateAssets: 'find_duplicate_assets',
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
  extractSubtitles: 'extract_subtitles',
  audioPeaks: 'audio_peaks',
  audioPeaksPath: 'audio_peaks_path',
  measureFileLoudness: 'measure_file_loudness',
  setToolPaths: 'set_tool_paths',
  getDiarizeProvider: 'get_diarize_provider',
  saveDiarizeProvider: 'save_diarize_provider',
  diarizeAudio: 'diarize_audio',
  exportLossless: 'export_lossless',
  remux: 'remux',
  writeChapters: 'write_chapters',
  extractAudio: 'extract_audio',
  listPlugins: 'list_plugins',
  installPlugin: 'install_plugin',
  removePlugin: 'remove_plugin',
  setPluginEnabled: 'set_plugin_enabled',
  getFlowProxies: 'get_flow_proxies',
  setFlowProxy: 'set_flow_proxy',
  startMcpServer: 'start_mcp_server',
  mcpServerStatus: 'mcp_server_status',
  mcpRespond: 'mcp_respond',
  mcpDetectClients: 'mcp_detect_clients',
  mcpAutoconnect: 'mcp_server_autoconnect',
  analyzeMixLoudness: 'analyze_mix_loudness',
  hardwareEncoders: 'hardware_encoders',
  exportCapabilities: 'export_capabilities',
  verifyExport: 'verify_export',
  downloaderStatus: 'downloader_status',
  analyzeYoutubeChannel: 'analyze_youtube_channel',
  downloaderBridgeInfo: 'downloader_bridge_info',
  installDownloader: 'install_downloader',
  updateDownloader: 'update_downloader',
  pauseDownload: 'pause_download',
  resumeDownload: 'resume_download',
  cancelDownload: 'cancel_download',
  creatorInjectHook: 'creator_inject_hook',
  creatorExportMultiAspect: 'creator_export_multi_aspect',
  creatorInjectCta: 'creator_inject_cta',
  creatorInterleaveBroll: 'creator_interleave_broll',
  creatorSplitChapters: 'creator_split_chapters',
  creatorBurnSubtitles: 'creator_burn_subtitles',
  downloadDiskSpace: 'download_disk_space',
  chooseDownloadDirectory: 'choose_download_directory',
  extensionStatus: 'extension_status',
  prepareExtension: 'prepare_extension',
  probeDownload: 'probe_download',
  sponsorblockPreview: 'sponsorblock_preview',
  notifyUser: 'notify_user',
  scanWatchFolder: 'scan_watch_folder',
  fetchRssFeed: 'fetch_rss_feed',
  testProxy: 'test_proxy',
  probeSourceChecksum: 'probe_source_checksum',
  listPlaylistEntries: 'list_playlist_entries',
  listAudioTracks: 'list_audio_tracks',
  installWatchdog: 'install_watchdog',
  removeWatchdog: 'remove_watchdog',
  watchdogStatus: 'watchdog_status',
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
  writeAlphaFrames: 'write_alpha_frames',
  alphaFramesToAsset: 'alpha_frames_to_asset',
  discardAlphaFrames: 'discard_alpha_frames',
  upscaleImage: 'upscale_image',
  denoiseMedia: 'denoise_media',
  sharpenMedia: 'sharpen_media',
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
  writeProjectFile: 'write_project_file',
  copyMediaInto: 'copy_media_into',
  renderProjectVariant: 'render_project_variant',
  loadDirectorMemory: 'load_director_memory',
  saveDirectorMemory: 'save_director_memory',
  transcribeAsset: 'transcribe_asset',
  voiceIsolationStatus: 'voice_isolation_status',
  voiceIsolateMedia: 'voice_isolate_media',
  voiceIsolationPrepare: 'prepare_voice_isolation',
  flowBrowserStatus: 'flow_browser_status',
  flowBrowserLaunch: 'flow_browser_launch',
  flowBrowserStop: 'flow_browser_stop',
  flowEmbedStatus: 'flow_embed_status',
  flowEmbedOpen: 'flow_embed_open',
  flowEmbedClose: 'flow_embed_close',
  flowEmbedNav: 'flow_embed_nav',
  flowEmbedEval: 'flow_embed_eval',
  webSessionsStatus: 'web_sessions_status',
  webSessionOpen: 'web_session_open',
  webSessionClose: 'web_session_close',
  webSessionNav: 'web_session_nav',
  webSessionEval: 'web_session_eval',
  flowGenerateImage: 'flow_generate_image',
  screenRecordStatus: 'screen_record_status',
  screenRecordDevices: 'screen_record_devices',
  screenRecordStart: 'screen_record_start',
  screenRecordStop: 'screen_record_stop',
  stickmanRender: 'stickman_render',
  subtitlesPipeline: 'subtitles_pipeline',
  browserInstanceLaunch: 'browser_instance_launch',
  browserInstanceClose: 'browser_instance_close',
  browserInstanceList: 'browser_instance_list',
  browserInstanceNavigate: 'browser_instance_navigate',
  browserInstanceEval: 'browser_instance_eval',
  obsSceneList: 'obs_scene_list',
  obsSceneSave: 'obs_scene_save',
  obsSceneDelete: 'obs_scene_delete',
  obsSceneStart: 'obs_scene_start',
  systemInfo: 'system_info',
  chooseTool: 'choose_tool',
  revealOutput: 'reveal_output',
  getProvider: 'get_provider',
  saveProvider: 'save_provider',
  clearProviderKey: 'clear_provider_key',
  testProvider: 'test_provider',
  getAudioProvider: 'get_audio_provider',
  saveAudioProvider: 'save_audio_provider',
  clearAudioProviderKey: 'clear_audio_provider_key',
  openExternalUrl: 'open_external_url',
  savePublicationManifest: 'save_publication_manifest',
  generateScript: 'generate_script',
  generateVideoEffect: 'generate_video_effect',
  generateMotion: 'generate_motion',
  assistantChat: 'assistant_chat',
  assistantChatStream: 'assistant_chat_stream',
  cancelAssistantChat: 'cancel_assistant_stream',
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

/** Id corto y único por streaming; correlaciona los eventos del backend. */
function newAssistantStreamId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `s-${random}`.slice(0, 80);
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
    async matchMediaPlan(input) {
      const raw = (await call(PROJECT_COMMANDS.matchMediaPlan, {
        sentences: [...input.sentences],
        images: [...input.images],
        imageDescriptions: input.imageDescriptions ? [...input.imageDescriptions] : [],
        approvedCost: input.approvedCost ?? false,
      })) as { assignments?: unknown; model?: unknown };
      return {
        assignments: Array.isArray(raw.assignments)
          ? raw.assignments.filter(
              (value): value is number =>
                typeof value === 'number' && Number.isInteger(value) && value >= 0,
            )
          : [],
        model: typeof raw.model === 'string' ? raw.model : '',
      };
    },
    async analyzeImages(assetIds) {
      if (assetIds.length === 0) return [];
      const raw = await call(PROJECT_COMMANDS.analyzeImages, {
        assetIds: [...assetIds],
      });
      return mapImageContents(raw);
    },
    async analyzeMediaFrames(assetIds) {
      if (assetIds.length === 0) return [];
      const raw = await call(PROJECT_COMMANDS.analyzeMediaFrames, {
        assetIds: [...assetIds],
      });
      return mapImageContents(raw);
    },
    async listMediaFolder(input) {
      const raw = (await call(PROJECT_COMMANDS.listMediaFolder, {
        folder: input.folder,
        root: input.root ?? null,
      })) as { directory?: unknown; files?: unknown };
      return {
        directory: typeof raw.directory === 'string' ? raw.directory : '',
        files: Array.isArray(raw.files)
          ? raw.files
              .filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
              .map((file) => ({
                path: String(file.path ?? ''),
                name: String(file.name ?? ''),
                kind: String(file.kind ?? ''),
                bytes: Number(file.bytes ?? 0),
              }))
              .filter((file) => file.path !== '' && file.name !== '')
          : [],
      };
    },
    async listDirectory(path) {
      const raw = (await call(PROJECT_COMMANDS.fsList, { path })) as {
        directory?: unknown;
        entries?: unknown;
        truncated?: unknown;
      };
      return {
        directory: typeof raw.directory === 'string' ? raw.directory : '',
        truncated: raw.truncated === true,
        entries: Array.isArray(raw.entries)
          ? raw.entries
              .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
              .map((entry) => ({
                name: String(entry.name ?? ''),
                path: String(entry.path ?? ''),
                kind: String(entry.kind ?? 'other'),
                bytes: Number(entry.bytes ?? 0),
              }))
              .filter((entry) => entry.name !== '' && entry.path !== '')
          : [],
      };
    },
    async readTextFile(path) {
      const raw = (await call(PROJECT_COMMANDS.fsRead, { path })) as {
        path?: unknown;
        bytes?: unknown;
        truncated?: unknown;
        content?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: Number(raw.bytes ?? 0),
        truncated: raw.truncated === true,
        content: typeof raw.content === 'string' ? raw.content : '',
      };
    },
    async writeTextFile(path, content) {
      const raw = (await call(PROJECT_COMMANDS.fsWrite, { path, content })) as {
        path?: unknown;
        bytes?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: Number(raw.bytes ?? 0),
      };
    },
    async makeDirectory(path, recursive) {
      const raw = (await call(PROJECT_COMMANDS.fsMkdir, {
        path,
        recursive: recursive ?? null,
      })) as { path?: unknown };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        bytes: 0,
      };
    },
    async movePath(from, to) {
      const raw = (await call(PROJECT_COMMANDS.fsMove, { from, to })) as {
        path?: unknown;
        bytes?: unknown;
      };
      return {
        path: typeof raw.path === 'string' ? raw.path : to,
        bytes: Number(raw.bytes ?? 0),
      };
    },
    async deletePath(path, recursive) {
      const raw = (await call(PROJECT_COMMANDS.fsDelete, {
        path,
        recursive: recursive ?? null,
      })) as { path?: unknown; recursive?: unknown };
      return {
        path: typeof raw.path === 'string' ? raw.path : path,
        recursive: raw.recursive === true,
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
    async writeAlphaFrames(request) {
      await call(PROJECT_COMMANDS.writeAlphaFrames, {
        token: request.token,
        startIndex: request.startIndex,
        frames: request.frames,
      });
    },
    async alphaFramesToAsset(request) {
      const raw = await call(PROJECT_COMMANDS.alphaFramesToAsset, {
        token: request.token,
        label: request.label,
        width: request.width,
        height: request.height,
        frameCount: request.frameCount,
        fpsNum: request.fpsNum,
        fpsDen: request.fpsDen,
      });
      const asset = parseAssets([raw])[0];
      if (!asset) {
        throw new Error('la secuencia no devolvió un asset válido');
      }
      return asset;
    },
    async discardAlphaFrames(token) {
      await call(PROJECT_COMMANDS.discardAlphaFrames, { token });
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
    async sharpenMedia(request) {
      return (await call(PROJECT_COMMANDS.sharpenMedia, {
        request,
      })) as SharpenResult;
    },
    async onSharpenProgress(handler) {
      return listen<SharpenProgress>('sharpen-progress', (event) => handler(event.payload));
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
    async proxyStatus(assetId) {
      return (await call(PROJECT_COMMANDS.proxyStatus, { assetId })) as ProxyStatus;
    },
    async ensureProxy(assetId, quality) {
      return (await call(PROJECT_COMMANDS.ensureProxy, {
        assetId,
        quality: quality ?? null,
      })) as ProxyStatus;
    },
    async cancelProxy(assetId) {
      return (await call(PROJECT_COMMANDS.cancelProxy, { assetId })) as ProxyStatus;
    },
    async applyProxyToAsset(assetId) {
      const raw = await call(PROJECT_COMMANDS.applyProxyToAsset, { assetId });
      if (!raw) return null;
      return parseAssets([raw])[0] ?? null;
    },
    async cleanupProxies(assetId) {
      return (await call(PROJECT_COMMANDS.cleanupProxies, {
        assetId: assetId ?? null,
      })) as ProxyCleanupResult;
    },
    async onProxyProgress(handler) {
      return listen<ProxyProgressEvent>('proxy-progress', (event) => handler(event.payload));
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
    async chooseMediaFolder(title) {
      const raw = await call(PROJECT_COMMANDS.chooseMediaFolder, {
        title: title ?? null,
      });
      return typeof raw === 'string' && raw.trim() ? raw : null;
    },
    async findMissingAssets(projectPath) {
      const raw = await call(PROJECT_COMMANDS.findMissingAssets, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as MissingAssetInfo[]) : [];
    },
    async relinkAsset(assetId, newPath) {
      return (await call(PROJECT_COMMANDS.relinkAsset, {
        assetId,
        newPath,
      })) as RelinkResult;
    },
    async relinkAssetsFromFolder(projectPath, folder) {
      return (await call(PROJECT_COMMANDS.relinkAssetsFromFolder, {
        projectPath: projectPath ?? null,
        folder,
      })) as RelinkFolderResult;
    },
    async listProjectVersions(projectPath) {
      const raw = await call(PROJECT_COMMANDS.listProjectVersions, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as ProjectVersionInfo[]) : [];
    },
    async restoreProjectVersion(projectPath, versionId, mode) {
      return (await call(PROJECT_COMMANDS.restoreProjectVersion, {
        projectPath,
        versionId,
        mode: mode ?? null,
      })) as RestoreProjectVersionResult;
    },
    async findDuplicateAssets(projectPath) {
      const raw = await call(PROJECT_COMMANDS.findDuplicateAssets, {
        projectPath: projectPath ?? null,
      });
      return Array.isArray(raw) ? (raw as DuplicateAssetGroup[]) : [];
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
    async analyzeMedia(
      assetId,
      sceneThreshold,
      silenceDb,
      minSilenceSeconds,
      includeSamples,
    ) {
      return (await call(PROJECT_COMMANDS.analyzeMedia, {
        assetId,
        sceneThreshold: sceneThreshold ?? null,
        silenceDb: silenceDb ?? null,
        minSilenceSeconds: minSilenceSeconds ?? null,
        includeSamples: includeSamples ?? null,
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
    async extractSubtitles(path) {
      const raw = (await call(PROJECT_COMMANDS.extractSubtitles, {
        path,
      })) as ExtractedSubtitles | null;
      return raw ?? null;
    },
    async setToolPaths(input) {
      await call(PROJECT_COMMANDS.setToolPaths, {
        ffmpeg: input.ffmpeg,
        ffprobe: input.ffprobe,
      });
    },
    async getDiarizeProvider() {
      return (await call(PROJECT_COMMANDS.getDiarizeProvider, {})) as DiarizeProviderInfo;
    },
    async saveDiarizeProvider(input) {
      return (await call(PROJECT_COMMANDS.saveDiarizeProvider, {
        kind: input.kind,
        baseUrl: input.baseUrl,
        language: input.language,
        apiKey: input.apiKey,
      })) as DiarizeProviderInfo;
    },
    async exportLossless(input) {
      return (await call(PROJECT_COMMANDS.exportLossless, { ...input })) as LosslessResult;
    },
    async remux(input) {
      return (await call(PROJECT_COMMANDS.remux, { ...input })) as LosslessResult;
    },
    async writeChapters(input) {
      return (await call(PROJECT_COMMANDS.writeChapters, { ...input })) as {
        path: string;
        bytes: number;
        chapters: number;
      };
    },
    async extractAudio(input) {
      return (await call(PROJECT_COMMANDS.extractAudio, { ...input })) as {
        path: string;
        bytes: number;
        codec: string;
      };
    },
    async listPlugins() {
      return (await call(PROJECT_COMMANDS.listPlugins, {})) as PluginInfo[];
    },
    async installPlugin(path) {
      return (await call(PROJECT_COMMANDS.installPlugin, { path })) as PluginInfo;
    },
    async removePlugin(id) {
      await call(PROJECT_COMMANDS.removePlugin, { id });
    },
    async setPluginEnabled(id, enabled) {
      await call(PROJECT_COMMANDS.setPluginEnabled, { id, enabled });
    },
    async getFlowProxies() {
      return (await call(PROJECT_COMMANDS.getFlowProxies, {})) as Record<string, string>;
    },
    async setFlowProxy(accountId, proxy) {
      return (await call(PROJECT_COMMANDS.setFlowProxy, {
        accountId,
        proxy,
      })) as Record<string, string>;
    },
    async startMcpServer() {
      return (await call(PROJECT_COMMANDS.startMcpServer, {})) as McpServerInfo;
    },
    async mcpServerStatus() {
      return (await call(PROJECT_COMMANDS.mcpServerStatus, {})) as McpServerInfo | null;
    },
    async mcpRespond(id, ok, text) {
      return (await call(PROJECT_COMMANDS.mcpRespond, { id, ok, text })) as boolean;
    },
    async mcpDetectClients() {
      return (await call(PROJECT_COMMANDS.mcpDetectClients, {})) as readonly McpDetectedClient[];
    },
    async mcpAutoconnect(client) {
      return (await call(PROJECT_COMMANDS.mcpAutoconnect, { client })) as McpAutoconnectResult;
    },
    async onMcpCall(handler) {
      return listen<{ id: string; tool: string; args: unknown }>('mcp-call', (event) =>
        handler(event.payload),
      );
    },
    async diarizeAudio(path, language) {
      return (await call(PROJECT_COMMANDS.diarizeAudio, { path, language })) as DiarizeResult;
    },
    async audioPeaksPath(path, buckets) {
      return (await call(PROJECT_COMMANDS.audioPeaksPath, {
        path,
        buckets: buckets ?? 600,
      })) as AudioPeaks;
    },
    async measureFileLoudness(path) {
      return (await call(PROJECT_COMMANDS.measureFileLoudness, { path })) as FileLoudness;
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
    async exportCapabilities() {
      return (await call(PROJECT_COMMANDS.exportCapabilities)) as ExportCapabilities;
    },
    async verifyExport(path) {
      return (await call(PROJECT_COMMANDS.verifyExport, { path })) as ExportVerification;
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
    async updateDownloader() {
      return (await call(PROJECT_COMMANDS.updateDownloader)) as DownloaderStatus;
    },
    async pauseDownload(runId) {
      return (await call(PROJECT_COMMANDS.pauseDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async resumeDownload(runId) {
      return (await call(PROJECT_COMMANDS.resumeDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async cancelDownload(runId) {
      return (await call(PROJECT_COMMANDS.cancelDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async creatorInjectHook(request) {
      return (await call(PROJECT_COMMANDS.creatorInjectHook, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        hookText: request.hookText,
        zoomPercent: request.zoomPercent ?? null,
        soundGainDb: request.soundGainDb ?? null,
      })) as CreatorOutput;
    },
    async creatorExportMultiAspect(request) {
      return (await call(PROJECT_COMMANDS.creatorExportMultiAspect, {
        inputPath: request.inputPath,
        outputDir: request.outputDir,
        aspects: request.aspects ?? null,
      })) as CreatorOutput[];
    },
    async creatorInjectCta(request) {
      return (await call(PROJECT_COMMANDS.creatorInjectCta, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        ctaText: request.ctaText,
        url: request.url,
        ctaSeconds: request.ctaSeconds ?? null,
        addQr: request.addQr ?? null,
      })) as CreatorOutput;
    },
    async creatorInterleaveBroll(request) {
      return (await call(PROJECT_COMMANDS.creatorInterleaveBroll, {
        inputPath: request.inputPath,
        brollDir: request.brollDir,
        outputPath: request.outputPath,
        intervalSeconds: request.intervalSeconds ?? null,
        clipSeconds: request.clipSeconds ?? null,
        maxInsertions: request.maxInsertions ?? null,
      })) as CreatorOutput;
    },
    async creatorSplitChapters(request) {
      return (await call(PROJECT_COMMANDS.creatorSplitChapters, {
        inputPath: request.inputPath,
        outputDir: request.outputDir,
      })) as CreatorOutput[];
    },
    async creatorBurnSubtitles(request) {
      return (await call(PROJECT_COMMANDS.creatorBurnSubtitles, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        subtitleText: request.subtitleText,
      })) as CreatorOutput;
    },
    async downloadDiskSpace(path) {
      return (await call(PROJECT_COMMANDS.downloadDiskSpace, {
        path: path ?? null,
      })) as number;
    },
    async extensionStatus() {
      return (await call(PROJECT_COMMANDS.extensionStatus)) as ExtensionInstallStatus;
    },
    async prepareExtension() {
      return (await call(PROJECT_COMMANDS.prepareExtension)) as ExtensionInstallStatus;
    },
    async probeDownload(url, cookiesFile, cookiesFromBrowser) {
      return (await call(PROJECT_COMMANDS.probeDownload, {
        url,
        cookiesFile: cookiesFile ?? null,
        cookiesFromBrowser: cookiesFromBrowser ?? null,
      })) as DownloadProbe;
    },
    async sponsorblockPreview(url, categories) {
      return (await call(PROJECT_COMMANDS.sponsorblockPreview, {
        url,
        categories: categories ?? null,
      })) as SponsorSegment[];
    },
    async notifyUser(title, body) {
      await call(PROJECT_COMMANDS.notifyUser, { title, body });
    },
    async scanWatchFolder(path) {
      return (await call(PROJECT_COMMANDS.scanWatchFolder, { path })) as WatchFile[];
    },
    async fetchRssFeed(url, limit) {
      return (await call(PROJECT_COMMANDS.fetchRssFeed, {
        url,
        limit: limit ?? null,
      })) as RssItem[];
    },
    async testProxy(proxy) {
      return (await call(PROJECT_COMMANDS.testProxy, { proxy })) as ProxyHealth;
    },
    async probeSourceChecksum(url) {
      return (await call(PROJECT_COMMANDS.probeSourceChecksum, { url })) as SourceChecksum;
    },
    async listPlaylistEntries(url, limit) {
      return (await call(PROJECT_COMMANDS.listPlaylistEntries, {
        url,
        limit: limit ?? null,
      })) as PlaylistEntry[];
    },
    async listAudioTracks(url) {
      return (await call(PROJECT_COMMANDS.listAudioTracks, { url })) as AudioTrack[];
    },
    async installWatchdog() {
      return (await call(PROJECT_COMMANDS.installWatchdog)) as WatchdogStatus;
    },
    async removeWatchdog() {
      return (await call(PROJECT_COMMANDS.removeWatchdog)) as WatchdogStatus;
    },
    async watchdogStatus() {
      return (await call(PROJECT_COMMANDS.watchdogStatus)) as WatchdogStatus;
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
    async analyzeYoutubeChannel(request) {
      return (await call(PROJECT_COMMANDS.analyzeYoutubeChannel, {
        request,
      })) as YouTubeChannelReport;
    },
    async onChannelAnalysisProgress(handler) {
      return listen<ChannelProgressEvent>('channel-analysis-progress', (event) =>
        handler(event.payload),
      );
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
    async writeProjectFile(input) {
      return (await call(PROJECT_COMMANDS.writeProjectFile, {
        directory: input.directory,
        fileName: input.fileName,
        project: input.project,
      })) as VariantWritten;
    },
    async copyMediaInto(input) {
      return (await call(PROJECT_COMMANDS.copyMediaInto, {
        directory: input.directory,
        paths: input.paths,
      })) as CopiedMedia[];
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
    async voiceIsolationStatus() {
      return (await call(PROJECT_COMMANDS.voiceIsolationStatus)) as VoiceIsolationStatus;
    },
    async voiceIsolateMedia(inputPath, model, quality) {
      const raw = (await call(PROJECT_COMMANDS.voiceIsolateMedia, {
        inputPath,
        model: model ?? null,
        quality: quality ?? null,
      })) as {
        vocals_path: string;
        accompaniment_path: string | null;
        duration_seconds: number;
        sample_rate: number;
        channels: number;
        processing_time_ms: number;
        cached?: boolean;
      };
      return {
        vocalsPath: raw.vocals_path,
        accompanimentPath: raw.accompaniment_path,
        durationSeconds: raw.duration_seconds,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        processingTimeMs: raw.processing_time_ms,
        cached: raw.cached ?? false,
      };
    },
    async voiceIsolationPrepare(assetId, quality, force) {
      const raw = (await call(PROJECT_COMMANDS.voiceIsolationPrepare, {
        assetId,
        quality: quality ?? null,
        force: force ?? null,
      })) as {
        vocals_path: string;
        accompaniment_path: string | null;
        duration_seconds: number;
        sample_rate: number;
        channels: number;
        processing_time_ms: number;
        cached?: boolean;
      };
      return {
        vocalsPath: raw.vocals_path,
        accompanimentPath: raw.accompaniment_path,
        durationSeconds: raw.duration_seconds,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        processingTimeMs: raw.processing_time_ms,
        cached: raw.cached ?? false,
      };
    },
    async flowBrowserStatus() {
      return (await call(PROJECT_COMMANDS.flowBrowserStatus)) as FlowBrowserStatus;
    },
    async flowBrowserLaunch(url) {
      return (await call(PROJECT_COMMANDS.flowBrowserLaunch, {
        url: url ?? null,
      })) as FlowBrowserStatus;
    },
    async flowBrowserStop() {
      return (await call(PROJECT_COMMANDS.flowBrowserStop)) as boolean;
    },
    async flowEmbedStatus() {
      return (await call(PROJECT_COMMANDS.flowEmbedStatus)) as FlowEmbedStatus;
    },
    async flowEmbedOpen(url) {
      return (await call(PROJECT_COMMANDS.flowEmbedOpen, {
        url: url ?? null,
      })) as FlowEmbedStatus;
    },
    async flowEmbedClose() {
      return (await call(PROJECT_COMMANDS.flowEmbedClose)) as boolean;
    },
    async flowEmbedNav(direction) {
      return (await call(PROJECT_COMMANDS.flowEmbedNav, {
        direction,
      })) as boolean;
    },
    async flowEmbedEval(js) {
      return (await call(PROJECT_COMMANDS.flowEmbedEval, { js })) as string;
    },
    async webSessionsStatus() {
      return (await call(PROJECT_COMMANDS.webSessionsStatus)) as WebSessionsStatus;
    },
    async webSessionOpen(url, slot) {
      return (await call(PROJECT_COMMANDS.webSessionOpen, {
        url,
        slot: slot ?? null,
      })) as WebSessionsStatus;
    },
    async webSessionClose(slot) {
      return (await call(PROJECT_COMMANDS.webSessionClose, {
        slot: slot ?? null,
      })) as boolean;
    },
    async webSessionNav(direction, slot) {
      return (await call(PROJECT_COMMANDS.webSessionNav, {
        direction,
        slot: slot ?? null,
      })) as boolean;
    },
    async webSessionEval(js, slot) {
      return (await call(PROJECT_COMMANDS.webSessionEval, {
        js,
        slot: slot ?? null,
      })) as string;
    },
    async flowGenerateImage(input) {
      return (await call(PROJECT_COMMANDS.flowGenerateImage, {
        prompt: input.prompt,
        outputDir: input.outputDir,
        slot: input.slot ?? null,
        url: input.url ?? null,
        timeoutSecs: input.timeoutSecs ?? null,
        reuseProject: input.reuseProject ?? null,
      })) as FlowGenerateResult;
    },
    async screenRecordStatus() {
      return (await call(PROJECT_COMMANDS.screenRecordStatus)) as ScreenRecordStatus;
    },
    async screenRecordDevices() {
      return (await call(PROJECT_COMMANDS.screenRecordDevices)) as CaptureDevices;
    },
    async screenRecordStart(input) {
      return (await call(PROJECT_COMMANDS.screenRecordStart, {
        outputDir: input.outputDir,
        fps: input.fps ?? null,
        webcamDevice: input.webcamDevice ?? null,
        captureScreen: input.captureScreen ?? null,
        captureTarget: input.captureTarget ?? null,
        windowTitle: input.windowTitle ?? null,
        regionX: input.regionX ?? null,
        regionY: input.regionY ?? null,
        regionWidth: input.regionWidth ?? null,
        regionHeight: input.regionHeight ?? null,
        audioDevice: input.audioDevice ?? null,
        streamUrl: input.streamUrl ?? null,
        encoder: input.encoder ?? null,
      })) as ScreenRecordStatus;
    },
    async screenRecordStop() {
      return (await call(PROJECT_COMMANDS.screenRecordStop)) as ScreenRecordResult;
    },
    async stickmanRender(input) {
      return (await call(PROJECT_COMMANDS.stickmanRender, { request: input })) as StickmanRenderResult;
    },
    async subtitlesPipeline(input) {
      return (await call(PROJECT_COMMANDS.subtitlesPipeline, { request: input })) as SubtitlePipelineResult;
    },
    async browserInstanceLaunch(input) {
      return (await call(PROJECT_COMMANDS.browserInstanceLaunch, {
        profileId: input.profileId,
        proxyUrl: input.proxyUrl ?? null,
        url: input.url ?? null,
      })) as BrowserInstanceInfo;
    },
    async browserInstanceClose(profileId) {
      return (await call(PROJECT_COMMANDS.browserInstanceClose, { profileId })) as boolean;
    },
    async browserInstanceList() {
      return (await call(PROJECT_COMMANDS.browserInstanceList)) as BrowserInstanceInfo[];
    },
    async browserInstanceNavigate(profileId, url) {
      return (await call(PROJECT_COMMANDS.browserInstanceNavigate, { profileId, url })) as boolean;
    },
    async browserInstanceEval(profileId, expression) {
      return await call(PROJECT_COMMANDS.browserInstanceEval, { profileId, expression });
    },
    async obsSceneList() {
      return (await call(PROJECT_COMMANDS.obsSceneList)) as ObsScene[];
    },
    async obsSceneSave(scene) {
      return (await call(PROJECT_COMMANDS.obsSceneSave, { scene })) as ObsScene;
    },
    async obsSceneDelete(id) {
      return (await call(PROJECT_COMMANDS.obsSceneDelete, { id })) as boolean;
    },
    async obsSceneStart(id, outputDir) {
      return (await call(PROJECT_COMMANDS.obsSceneStart, { id, outputDir })) as ScreenRecordStatus;
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
    async testProvider() {
      return (await call(PROJECT_COMMANDS.testProvider)) as ProviderTestResult;
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
    async assistantChatStream(request, handlers, streamId) {
      // El id viaja en cada evento: dos chats abiertos no se mezclan.
      const id = streamId?.trim() ? streamId.trim() : newAssistantStreamId();
      const unlisteners: UnlistenFn[] = [];
      const cleanup = (): void => {
        while (unlisteners.length > 0) unlisteners.pop()?.();
      };
      try {
        unlisteners.push(
          await listen<AssistantStreamDelta>('assistant-stream-delta', (event) => {
            if (event.payload?.streamId === id && typeof event.payload.delta === 'string') {
              handlers.onDelta(event.payload.delta);
            }
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamCompleted>('assistant-stream-completed', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onCompleted({
              reply: typeof event.payload.reply === 'string' ? event.payload.reply : '',
              action: event.payload.action ?? null,
              actions: Array.isArray(event.payload.actions) ? event.payload.actions : [],
              providerId: event.payload.providerId ?? 'openai-compatible',
              model: event.payload.model ?? '',
              simulated: event.payload.simulated === true,
            });
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamFailed>('assistant-stream-failed', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onFailed({
              message: event.payload.message || 'el streaming falló sin detalle',
              retryable: event.payload.retryable === true,
            });
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamCancelled>('assistant-stream-cancelled', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onCancelled();
          }),
        );
      } catch (cause) {
        cleanup();
        throw cause instanceof Error ? cause : new Error('no se pudo escuchar el streaming');
      }
      try {
        await call(PROJECT_COMMANDS.assistantChatStream, {
          request: {
            messages: [...request.messages],
            ...(request.context ? { context: request.context } : {}),
            approvedCost: request.approvedCost,
          },
          streamId: id,
        });
      } catch (cause) {
        cleanup();
        throw cause;
      }
      return {
        streamId: id,
        cancel() {
          void call(PROJECT_COMMANDS.cancelAssistantChat, { streamId: id }).catch(() => {
            // Si el streaming ya terminó, cancelar no es un error de usuario.
          });
        },
      } satisfies AssistantStreamHandle;
    },
    async cancelAssistantChat(streamId) {
      const raw = await call(PROJECT_COMMANDS.cancelAssistantChat, { streamId });
      return raw === true;
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
    listMediaFolder: async () => unavailable(),
    listDirectory: async () => unavailable(),
    readTextFile: async () => unavailable(),
    writeTextFile: async () => unavailable(),
    makeDirectory: async () => unavailable(),
    deletePath: async () => unavailable(),
    movePath: async () => unavailable(),
    matchMediaPlan: async () => unavailable(),
    analyzeImages: async () => unavailable(),
    analyzeMediaFrames: async () => unavailable(),
    importLut: async () => unavailable(),
    chooseSubtitleFile: async () => unavailable(),
    chooseTimelineFile: async () => unavailable(),
    extractFreezeFrame: async () => unavailable(),
    createVideoProxy: async () => unavailable(),
    proxyStatus: async () => unavailable(),
    ensureProxy: async () => unavailable(),
    cancelProxy: async () => unavailable(),
    applyProxyToAsset: async () => unavailable(),
    cleanupProxies: async () => unavailable(),
    onProxyProgress: async () => () => {},
    sampleAssetColor: async () => unavailable(),
    mediaThumbnail: async () => unavailable(),
    recentProjectThumbnail: async () => null,
    checkAssetFiles: async () => unavailable(),
    chooseMediaFolder: async () => unavailable(),
    findMissingAssets: async () => unavailable(),
    relinkAsset: async () => unavailable(),
    relinkAssetsFromFolder: async () => unavailable(),
    listProjectVersions: async () => unavailable(),
    restoreProjectVersion: async () => unavailable(),
    findDuplicateAssets: async () => unavailable(),
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
    extractSubtitles: async () => unavailable(),
    audioPeaks: async () => unavailable(),
    audioPeaksPath: async () => unavailable(),
    measureFileLoudness: async () => unavailable(),
    setToolPaths: async () => unavailable(),
    getDiarizeProvider: async () => unavailable(),
    saveDiarizeProvider: async () => unavailable(),
    diarizeAudio: async () => unavailable(),
    exportLossless: async () => unavailable(),
    remux: async () => unavailable(),
    writeChapters: async () => unavailable(),
    extractAudio: async () => unavailable(),
    listPlugins: async () => [],
    installPlugin: async () => unavailable(),
    removePlugin: async () => unavailable(),
    setPluginEnabled: async () => unavailable(),
    getFlowProxies: async () => ({}),
    setFlowProxy: async () => ({}),
    startMcpServer: async () => unavailable(),
    mcpServerStatus: async () => null,
    mcpRespond: async () => false,
    mcpDetectClients: async () => [],
    mcpAutoconnect: async () => unavailable(),
    onMcpCall: async () => () => {},
    analyzeMixLoudness: async () => unavailable(),
    onLoudnessAnalysisProgress: async () => () => {},
    hardwareEncoders: async () => unavailable(),
    exportCapabilities: async () => unavailable(),
    verifyExport: async () => unavailable(),
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
    updateDownloader: async () => unavailable(),
    pauseDownload: async () => unavailable(),
    resumeDownload: async () => unavailable(),
    cancelDownload: async () => unavailable(),
    creatorInjectHook: async () => unavailable(),
    creatorExportMultiAspect: async () => unavailable(),
    creatorInjectCta: async () => unavailable(),
    creatorInterleaveBroll: async () => unavailable(),
    creatorSplitChapters: async () => unavailable(),
    creatorBurnSubtitles: async () => unavailable(),
    downloadDiskSpace: async () => unavailable(),
    chooseDownloadDirectory: async () => unavailable(),
    extensionStatus: async () => unavailable(),
    prepareExtension: async () => unavailable(),
    probeDownload: async () => unavailable(),
    sponsorblockPreview: async () => unavailable(),
    notifyUser: async () => {},
    scanWatchFolder: async () => unavailable(),
    fetchRssFeed: async () => unavailable(),
    testProxy: async () => unavailable(),
    probeSourceChecksum: async () => unavailable(),
    listPlaylistEntries: async () => unavailable(),
    listAudioTracks: async () => unavailable(),
    installWatchdog: async () => unavailable(),
    removeWatchdog: async () => unavailable(),
    watchdogStatus: async () => unavailable(),
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
    writeAlphaFrames: async () => unavailable(),
    alphaFramesToAsset: async () => unavailable(),
    discardAlphaFrames: async () => unavailable(),
    upscaleImage: async () => unavailable(),
    denoiseMedia: async () => unavailable(),
    sharpenMedia: async () => unavailable(),
    onSharpenProgress: async () => () => {},
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
    analyzeYoutubeChannel: async () => unavailable(),
    onChannelAnalysisProgress: async () => () => {},
    fetchPlatformRules: async () => unavailable(),
    listMcpServers: async () => unavailable(),
    saveMcpServer: async () => unavailable(),
    deleteMcpServer: async () => unavailable(),
    probeMcpServer: async () => unavailable(),
    callMcpTool: async () => unavailable(),
    closeMcpSession: async () => false,
    mcpSessionStatus: async () => [],
    writeProjectVariant: async () => unavailable(),
    writeProjectFile: async () => unavailable(),
    copyMediaInto: async () => unavailable(),
    renderProjectVariant: async () => unavailable(),
    loadDirectorMemory: async () => unavailable(),
    saveDirectorMemory: async () => unavailable(),
    transcribeAsset: async () => unavailable(),
    voiceIsolationStatus: async () => unavailable(),
    voiceIsolateMedia: async () => unavailable(),
    voiceIsolationPrepare: async () => unavailable(),
    flowBrowserStatus: async () => unavailable(),
    flowBrowserLaunch: async () => unavailable(),
    flowBrowserStop: async () => unavailable(),
    flowEmbedStatus: async () => unavailable(),
    flowEmbedOpen: async () => unavailable(),
    flowEmbedClose: async () => unavailable(),
    flowEmbedNav: async () => unavailable(),
    flowEmbedEval: async () => unavailable(),
    webSessionsStatus: async () => unavailable(),
    webSessionOpen: async () => unavailable(),
    webSessionClose: async () => unavailable(),
    webSessionNav: async () => unavailable(),
    webSessionEval: async () => unavailable(),
    flowGenerateImage: async () => unavailable(),
    screenRecordStatus: async () => unavailable(),
    screenRecordDevices: async () => unavailable(),
    screenRecordStart: async () => unavailable(),
    screenRecordStop: async () => unavailable(),
    stickmanRender: async () => unavailable(),
    subtitlesPipeline: async () => unavailable(),
    browserInstanceLaunch: async () => unavailable(),
    browserInstanceClose: async () => unavailable(),
    browserInstanceList: async () => unavailable(),
    browserInstanceNavigate: async () => unavailable(),
    browserInstanceEval: async () => unavailable(),
    obsSceneList: async () => unavailable(),
    obsSceneSave: async () => unavailable(),
    obsSceneDelete: async () => unavailable(),
    obsSceneStart: async () => unavailable(),
    systemInfo: async () => unavailable(),
    chooseTool: async () => unavailable(),
    revealOutput: async () => unavailable(),
    getProvider: async () => unavailable(),
    saveProvider: async () => unavailable(),
    clearProviderKey: async () => unavailable(),
    testProvider: async () => unavailable(),
    getAudioProvider: async () => unavailable(),
    saveAudioProvider: async () => unavailable(),
    clearAudioProviderKey: async () => unavailable(),
    openExternalUrl: async () => unavailable(),
    savePublicationManifest: async () => unavailable(),
    generateScript: async () => unavailable(),
    generateVideoEffect: async () => unavailable(),
    generateMotion: async () => unavailable(),
    assistantChat: async () => unavailable(),
    assistantChatStream: async () => unavailable(),
    cancelAssistantChat: async () => unavailable(),
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

/**
 * Servicio del entorno real.
 *
 * Sin runtime nativo (una pestaña del navegador) devuelve el servicio que
 * declara `available: false`: la UI avisa y deshabilita crear/importar. Antes
 * devolvía el fake de los tests, que dice estar disponible y guarda todo en
 * memoria, así que la persona creaba un proyecto y lo perdía al recargar.
 */
export function createDesktopService(): DesktopService {
  if (!detectNativeRuntime()) {
    return createUnavailableService();
  }
  return createNativeDesktopService();
}
