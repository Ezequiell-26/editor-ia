import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AssetSchema, parseProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';

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

export interface GenerateScriptRequest {
  readonly brief: string;
  readonly sceneCount: number;
  readonly language: string;
  readonly approvedCost: boolean;
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
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'gif'
  | 'mp3'
  | 'wav';

export interface ConversionRequest {
  readonly assetId: string;
  readonly target: ConversionTarget;
  readonly outputDir: string;
  readonly quality?: number;
  readonly maxWidth?: number;
}

export interface ConversionResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number | null;
  readonly formatName: string;
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

export type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export interface DesktopService {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  createProject(input: CreateProjectRequest): Promise<OpenedProject | null>;
  openProject(): Promise<OpenedProject | null>;
  openProjectAt(path: string): Promise<OpenedProject>;
  adoptProject(path: string): Promise<OpenedProject>;
  saveProject(project: ProjectDocument): Promise<OpenedProject>;
  saveProjectAs(project: ProjectDocument): Promise<OpenedProject | null>;
  closeProject(): Promise<void>;
  importAssets(fpsNum: number, fpsDen: number): Promise<ImportOutcome | null>;
  importMediaPaths(input: {
    paths: readonly string[];
    fpsNum: number;
    fpsDen: number;
    confirmRights?: boolean;
    provider?: string;
  }): Promise<ImportOutcome>;
  mediaThumbnail(path: string, isImage: boolean): Promise<string>;
  checkAssetFiles(paths: string[]): Promise<AssetFileInfo[]>;
  detectScenes(assetId: string, threshold: number): Promise<SceneDetection>;
  analyzeMedia(
    assetId: string,
    sceneThreshold?: number,
    silenceDb?: number,
    minSilenceSeconds?: number,
  ): Promise<MediaAnalysis>;
  convertMedia(request: ConversionRequest): Promise<ConversionResult>;
  listMcpServers(): Promise<McpServerConfig[]>;
  saveMcpServer(input: McpServerInput): Promise<McpServerConfig>;
  deleteMcpServer(id: string): Promise<void>;
  probeMcpServer(id: string): Promise<McpProbeResult>;
  callMcpTool(id: string, tool: string, args: unknown): Promise<McpCallResult>;
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
  listVoices(): Promise<VoiceInfo[]>;
  synthesizeNarration(input: {
    text: string;
    voice?: string;
    fpsNum: number;
    fpsDen: number;
    provider?: 'windows-sapi';
  }): Promise<NarrationResult>;
  startRender(profileId: string | null, includeCaptions: boolean): Promise<RenderStarted | null>;
  startRenderTo(
    profileId: string,
    outputPath: string,
    includeCaptions: boolean,
  ): Promise<RenderStarted | null>;
  chooseExportDirectory(): Promise<string | null>;
  cancelRender(jobId: string): Promise<void>;
  activeRender(): Promise<string | null>;
  pruneRenderCache(): Promise<number>;
  onRenderProgress(handler: (event: RenderProgressEvent) => void): Promise<UnlistenFn>;
  onRenderFinished(handler: (event: RenderFinishedEvent) => void): Promise<UnlistenFn>;
  mediaUrl(root: string, relativePath: string): string;
  joinPath(root: string, relativePath: string): string;
}

export const PROJECT_COMMANDS = {
  create: 'create_project',
  open: 'open_project',
  openAt: 'open_project_at',
  adopt: 'adopt_project',
  save: 'save_project',
  saveAs: 'save_project_as',
  close: 'close_project',
  importAssets: 'import_assets',
  importMediaPaths: 'import_media_paths',
  thumbnail: 'media_thumbnail',
  checkAssets: 'check_asset_files',
  detectScenes: 'detect_scenes',
  analyzeMedia: 'analyze_media',
  convertMedia: 'convert_media',
  listMcpServers: 'list_mcp_servers',
  saveMcpServer: 'save_mcp_server',
  deleteMcpServer: 'delete_mcp_server',
  probeMcpServer: 'probe_mcp_server',
  callMcpTool: 'call_mcp_tool',
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
  'Abrí la app de escritorio de Editor IA para crear, importar y exportar. Esta ventana del navegador no tiene acceso al sistema de archivos.';

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
    async mediaThumbnail(path, isImage) {
      const raw = await call(PROJECT_COMMANDS.thumbnail, { path, isImage });
      if (typeof raw !== 'string') {
        throw new Error('la miniatura no llegó como imagen');
      }
      return raw;
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
      })) as ConversionResult;
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
    async startRender(profileId, includeCaptions) {
      return (await call(PROJECT_COMMANDS.startRender, {
        profileId,
        includeCaptions,
      })) as RenderStarted | null;
    },
    async startRenderTo(profileId, outputPath, includeCaptions) {
      return (await call(PROJECT_COMMANDS.startRenderTo, {
        profileId,
        outputPath,
        includeCaptions,
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
    closeProject: async () => unavailable(),
    importAssets: async () => unavailable(),
    importMediaPaths: async () => unavailable(),
    mediaThumbnail: async () => unavailable(),
    checkAssetFiles: async () => unavailable(),
    detectScenes: async () => unavailable(),
    analyzeMedia: async () => unavailable(),
    convertMedia: async () => unavailable(),
    listMcpServers: async () => unavailable(),
    saveMcpServer: async () => unavailable(),
    deleteMcpServer: async () => unavailable(),
    probeMcpServer: async () => unavailable(),
    callMcpTool: async () => unavailable(),
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
