import type { AlphaFramesRequest, AlphaSequenceRequest, BackgroundProgress, BackgroundRemoval, BackgroundRemovalRequest, BestFrameRequest, BestThumbnailFrame, CompressAnyRequest, CompressRequest, ConversionRequest, ConversionTarget, DenoiseProgress, DenoiseRequest, DenoiseResult, EdlRequest, EdlResult, EnhanceOptions, FcpxmlRequest, FcpxmlResult, ImageContent, LookLutRequest, LookLutResult, MediaAnalysis, MediaProbe, OtioRequest, OtioResult, PreviewFrameRequest, PreviewFrameResult, ProxyCleanupResult, ProxyInfo, ProxyProgressEvent, ProxyQuality, ProxyStatus, SampledColor, SceneDetection, ScopeFrameResult, SharpenProgress, SharpenRequest, SharpenResult, StabilizationAnalysis, ThumbnailExportRequest, ThumbnailExportResult, TimelineImportRequest, TimelineImportResult, UpscaleProgress, UpscaleResult, UpscaleVideoResult, VisualAudit, VisualCatalog } from '../media';
import type { PickedSubtitleFile } from '../projects';
import type { BatchConversionItem, CompressProgress, ConversionResult, ConvertProgress, LosslessResult } from '../render';
import type { CapabilityInfo, EncoderPreference, ModelInfo } from '../providers';
import type { ToolResult } from '../integrations';
import type { ExtractedSubtitles } from '../subtitles';
import type { Asset } from '@editor-ia/project-schema';
import type { UnlistenFn } from '../events';

export interface DesktopServiceMedia {
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

/** Selector nativo de imágenes sueltas (comparador antes/después). */
  chooseImageFile(title?: string): Promise<string | null>;

/** Selector nativo de videos sueltos (compresión, inspección). */
  chooseVideoFile(title?: string): Promise<string | null>;

/** Selector nativo de audio suelto (voz, transcripción, análisis). */
  chooseAudioFile(title?: string): Promise<string | null>;

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

upscaleVideo(inputPath: string, outputPath?: string, maxSeconds?: number): Promise<UpscaleVideoResult>;

onUpscaleProgress(handler: (event: UpscaleProgress) => void): Promise<UnlistenFn>;

denoiseMedia(request: DenoiseRequest): Promise<DenoiseResult>;

onDenoiseProgress(handler: (event: DenoiseProgress) => void): Promise<UnlistenFn>;

/** Aplica la cadena de definición: limpieza, escalado, enfoque, curva y grano. */
  sharpenMedia(request: SharpenRequest): Promise<SharpenResult>;

onSharpenProgress(handler: (event: SharpenProgress) => void): Promise<UnlistenFn>;

saveThumbnail(request: ThumbnailExportRequest): Promise<ThumbnailExportResult>;

pickThumbnailFrames(request: BestFrameRequest): Promise<readonly BestThumbnailFrame[]>;

renderPreviewFrame(request: PreviewFrameRequest): Promise<PreviewFrameResult>;

analyzeScopesFrame(request: { readonly path: string }): Promise<ScopeFrameResult>;

exportLookLut(request: LookLutRequest): Promise<LookLutResult>;

exportEdl(request: EdlRequest): Promise<EdlResult>;

exportOtio(request: OtioRequest): Promise<OtioResult>;

exportFcpxml(request: FcpxmlRequest): Promise<FcpxmlResult>;

importTimeline(request: TimelineImportRequest): Promise<TimelineImportResult>;

/**
   * Mide VMAF entre el original y el comprimido (0–100). `null` si el build de
   * FFmpeg no trae libvmaf: la UI lo muestra como no disponible.
   */
  measureVmaf(original: string, compressed: string): Promise<number | null>;
}
