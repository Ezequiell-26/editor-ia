import type { AlphaFramesRequest, AlphaSequenceRequest, BackgroundProgress, BackgroundRemoval, BackgroundRemovalRequest, BestFrameRequest, BestThumbnailFrame, CompressAnyRequest, CompressRequest, ConcatWorkerEnvelope, ConcatWorkerEvent, ConcatWorkerStatus, ConversionRequest, ConversionTarget, DenoiseProgress, DenoiseRequest, DenoiseResult, EdlRequest, EdlResult, EnhanceOptions, FileConversionRequest, FcpxmlRequest, FcpxmlResult, InterchangeExportResult, ImageContent, LookLutRequest, LookLutResult, LutProbeResult, MediaAnalysis, MediaProbe, OtioRequest, OtioResult, PreviewFrameRequest, PreviewFrameResult, ProxyCleanupResult, ProxyInfo, ProxyProgressEvent, ProxyQuality, ProxyStatus, SampledColor, SceneDetection, ScopeFrameResult, SfxItem, SharpenProgress, SharpenRequest, SharpenResult, StabilizationAnalysis, ThumbnailExportRequest, ThumbnailExportResult, TimelineImportRequest, TimelineImportResult, UpscaleProgress, UpscaleResult, UpscaleVideoResult, VisualAudit, VisualCatalog, TextFontFamily, TextRenderRequest, TextRenderResult } from '../media'
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

importLut(path?: string): Promise<{ readonly path: string; readonly name: string } | null>;

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

mediaThumbnail(path: string, isImage: boolean, timeSeconds?: number): Promise<string>;

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

/**
 * QC de un archivo suelto del disco (p. ej. un MP4 recién exportado): corre
 * las mismas pasadas de detección que `analyzeMedia` — escenas, silencios,
 * negros, congelados y loudness — sin exigir proyecto abierto.
 */
qcMediaFile(
    path: string,
    sceneThreshold?: number,
    silenceDb?: number,
    minSilenceSeconds?: number,
  ): Promise<MediaAnalysis>;

convertMedia(request: ConversionRequest): Promise<ConversionResult>;

/**
 * Convierte un archivo arbitrario del disco (no asset del proyecto) a un
 * formato de entrega derivado: GIF o audio (MP3/WAV/M4A/AAC/OGG/Opus/FLAC).
 * Uso: entregables del render ya exportado (p. ej. MP4 → GIF/MP3).
 */
convertFile(request: FileConversionRequest): Promise<ConversionResult>;

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

/**
 * Biblioteca de efectos de sonido empaquetados (WAV sintetizados por
 * `scripts/generate-sfx.mjs`). Devuelve la ruta absoluta de cada archivo
 * para preview (`convertFileSrc`) e importación (`importMediaPaths`).
 */
  sfxLibrary(): Promise<SfxItem[]>;

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

/** Inspecciona una LUT .cube/.3dl sin aplicarla (formato, grilla, dominio). */
  lutProbe(path: string): Promise<LutProbeResult>;

exportEdl(request: EdlRequest): Promise<EdlResult>;

exportOtio(request: OtioRequest): Promise<OtioResult>;

exportFcpxml(request: FcpxmlRequest): Promise<FcpxmlResult>;

/** Exporta la timeline a AAF/OMF/FCP7XML/FCPXML/EDL/OTIO (filmcraft-interchange). */
exportTimelineInterchange(request: { readonly project: unknown; readonly output: string; readonly format?: string }): Promise<InterchangeExportResult>;

importTimeline(request: TimelineImportRequest): Promise<TimelineImportResult>;

/**
   * Mide VMAF entre el original y el comprimido (0–100). `null` si el build de
   * FFmpeg no trae libvmaf: la UI lo muestra como no disponible.
   */
  measureVmaf(original: string, compressed: string): Promise<number | null>;

/**
   * Estado del concat-worker (binario `concat-media` en JSON-lines): si el
   * ejecutable existe, qué ops implementa y si hay un proceso vivo. No
   * spawnea el worker: para eso está `concatWorkerRequest` con `ping`.
   */
  concatWorkerStatus(): Promise<ConcatWorkerStatus>;

/**
   * Request genérica al concat-worker. `op` debe estar en la allowlist del
   * backend (`ping`, `probe`, `decode_frame`, `render_export`, `shutdown`);
   * `params` es el resto del JSON según la op (`ConcatWorkerExportParams`
   * para `render_export`). Devuelve el envelope del worker
   * (`{"ok": ...}`); un throw es fallo de transporte (worker ausente,
   * timeout —que mata el proceso— o respuesta inválida).
   */
  concatWorkerRequest(
    op: string,
    params?: Record<string, unknown> | null,
    timeoutMs?: number,
  ): Promise<ConcatWorkerEnvelope>;

/**
 * Eventos del concat-worker (`concat-worker-progress`): progreso del
 * `render_export` en curso (`type: "render_export_progress"`) y ack de una
 * cancelación (`type: "cancel_ack"`). Se emiten mientras una
 * `concatWorkerRequest` está en vuelo.
 */
onConcatWorkerEvent(handler: (event: ConcatWorkerEvent) => void): Promise<UnlistenFn>;

/**
 * Cancela el `render_export` en curso del worker. Fire-and-forget: el
 * render aborta en el próximo frame/fase y la request en vuelo responde
 * `{"ok": false, "error": "render_export cancelled"}`; el worker sigue
 * vivo. Devuelve `false` si no había worker leyendo stdin.
 */
concatWorkerCancelRender(): Promise<boolean>;
  /** Familias de fuentes del motor de texto (bundled + sistema). */
  textFontsList(): Promise<readonly TextFontFamily[]>;

  /** Renderiza texto a PNG (preview verificable por la IA). */
  textRenderPreview(request: TextRenderRequest): Promise<TextRenderResult>;

}
