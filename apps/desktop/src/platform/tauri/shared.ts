import type { ImageContent, NativeInvoke, OpenedProject } from "../../services/contracts";
import { AssetSchema, parseProject, type Asset } from "@editor-ia/project-schema";

export type NativeCall = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export function createNativeCall(invoke: NativeInvoke): NativeCall {
  return async (command, args = {}) => {
    try { return await invoke(command, args); }
    catch (error) { throw nativeError(error); }
  };
}

export const ORIENTATIONS = new Set(['landscape', 'portrait', 'square']);

export const TEMPERATURES = new Set(['warm', 'cool', 'neutral']);

/**
 * Normaliza la respuesta del backend de comprensión visual. Se usa tanto para
 * imágenes (`analyze_images`) como para cuadros de video
 * (`analyze_media_frames`), así que la validación vive acá una sola vez.
 */
export function mapImageContents(raw: unknown): ImageContent[] {
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
  audioScopeAnalyze: 'audio_scope_analyze',
  audioScopeAnalyzeAsset: 'audio_scope_analyze_asset',
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
  vpnList: 'vpn_list',
  vpnConnect: 'vpn_connect',
  vpnDisconnect: 'vpn_disconnect',
  vpnWireguard: 'vpn_wireguard',
  vpnWireguardOpen: 'vpn_wireguard_open',
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
  upscaleVideo: 'upscale_video',
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
  obsScenePreview: 'obs_scene_preview',
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
  renderQueueLoad: 'render_queue_load',
  renderQueueSave: 'render_queue_save',
  renderQueueClearFinished: 'render_queue_clear_finished',
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
export function newAssistantStreamId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `s-${random}`.slice(0, 80);
}

export const FAILED_PHRASE: Record<string, string> = {
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

export function nativeError(error: unknown): Error {
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

export function requireOpened(raw: unknown): OpenedProject | null {
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

export function parseAssets(raw: unknown): Asset[] {
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

/** Tauri recibe el ZIP en base64: 64 MB nunca viajan como números JSON. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function unavailable(): never {
  throw new Error(NATIVE_UNAVAILABLE_REASON);
}

