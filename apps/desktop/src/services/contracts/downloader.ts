
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
