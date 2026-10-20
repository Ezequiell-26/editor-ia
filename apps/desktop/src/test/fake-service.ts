import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type {
  AssetFileInfo,
  AudioProviderInfo,
  CreateProjectRequest,
  DesktopService,
  GenerateScriptRequest,
  ImportOutcome,
  McpCallResult,
  McpProbeResult,
  McpServerConfig,
  McpServerInput,
  NarrationResult,
  OpenedProject,
  ProviderInfo,
  RenderFinishedEvent,
  RenderProgressEvent,
  RenderStarted,
  ScriptPlan,
  SystemInfo,
  VoiceInfo,
} from '../services/project-service';
import { ensureDelivery, newId } from '../state/project-actions';

const THUMB = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const NOW = '2025-01-01T00:00:00.000Z';

export function readyAsset(overrides: Partial<Asset> = {}): Asset {
  const base: Asset = {
    id: newId(),
    label: 'Toma de prueba',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 120_000 },
    rights: {
      license: { id: 'user-declared', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  };
  return { ...base, ...overrides } as Asset;
}

export function unverifiedAudioAsset(): Asset {
  return {
    id: newId(),
    label: 'narracion-escena.wav',
    kind: 'audio',
    source: {
      type: 'generated',
      provider: { id: 'windows-sapi', model: 'Microsoft Helena' },
      path: 'media/narracion.wav',
      generatedAt: NOW,
    },
    status: 'unverified',
    integrity: { sha256: 'b'.repeat(64), bytes: 50_000 },
    rights: {
      license: { id: 'unknown', commercialUse: 'unknown' },
      provenance: {
        origin: 'generated-locally',
        acquiredAt: NOW,
        provider: 'windows-sapi',
      },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 150 },
  } as Asset;
}

export interface FakeService extends DesktopService {
  readonly calls: {
    create: number;
    open: number;
    save: number;
    import: number;
    render: number;
  };
  emitProgress(event: RenderProgressEvent): void;
  emitFinished(event: RenderFinishedEvent): void;
  setSaveFailure(message: string | null): void;
  setImportOutcome(outcome: ImportOutcome | null): void;
  current: OpenedProject | null;
}

function opened(project: ProjectDocument, name = 'proyecto.editoria.json'): OpenedProject {
  return {
    project,
    label: name,
    path: `C:\\Users\\tester\\Proyectos\\${name}`,
    root: 'C:\\Users\\tester\\Proyectos',
  };
}

export function createFakeService(): FakeService {
  let current: OpenedProject | null = null;
  let saveFailure: string | null = null;
  let importOutcome: ImportOutcome | null = null;
  let mcpServers: McpServerConfig[] = [];
  const progressHandlers = new Set<(event: RenderProgressEvent) => void>();
  const finishedHandlers = new Set<(event: RenderFinishedEvent) => void>();
  const calls = { create: 0, open: 0, save: 0, import: 0, render: 0 };

  const service: FakeService = {
    available: true,
    unavailableReason: null,
    calls,
    current: null,
    async createProject(input: CreateProjectRequest) {
      calls.create += 1;
      const base = createEmptyProject(input.name, NOW);
      base.video = {
        width: input.width,
        height: input.height,
        frameRate: { num: input.fpsNum, den: input.fpsDen },
        backgroundColor: '#0b0e13',
      };
      const project = ensureDelivery(base);
      current = opened(project, `${input.name.toLowerCase().replace(/\s+/g, '-')}.editoria.json`);
      service.current = current;
      return current;
    },
    async openProject() {
      calls.open += 1;
      const project = ensureDelivery(createEmptyProject('Proyecto abierto', NOW));
      current = opened(project);
      service.current = current;
      return current;
    },
    async openProjectAt(path: string) {
      calls.open += 1;
      const project = ensureDelivery(createEmptyProject('Proyecto reciente', NOW));
      current = { ...opened(project, path.split(/[\\/]/).pop() ?? 'proyecto.editoria.json'), path };
      service.current = current;
      return current;
    },
    async adoptProject() {
      if (!current && service.current) {
        current = service.current;
      }
      if (!current) {
        throw new Error('no hay un proyecto para adoptar');
      }
      return current;
    },
    async saveProject(project: ProjectDocument) {      calls.save += 1;
      if (saveFailure) {
        throw new Error(saveFailure);
      }
      current = { ...(current ?? opened(project)), project };
      service.current = current;
      return current;
    },
    async saveProjectAs(project: ProjectDocument) {
      calls.save += 1;
      if (saveFailure) {
        throw new Error(saveFailure);
      }
      current = opened(project, 'copia.editoria.json');
      service.current = current;
      return current;
    },
    async closeProject() {
      current = null;
      service.current = null;
    },
    async importAssets() {
      calls.import += 1;
      return (
        importOutcome ?? {
          assets: [readyAsset()],
          warnings: [],
        }
      );
    },
    async importMediaPaths(input) {
      return {
        assets: input.paths.slice(0, 12).map((path, index) =>
          readyAsset({
            id: newId(),
            label: `Artefacto ${index + 1}`,
            source: { type: 'local', path },
          }),
        ),
        warnings: [],
      };
    },
    async importLut() {
      return { path: 'media/luts/fake.cube', name: 'fake.cube' };
    },
    async downloaderStatus() {
      return {
        available: true,
        version: '2026.10.01',
        path: 'yt-dlp',
        managed: true,
        canInstall: true,
        hint: null,
      };
    },
    async installDownloader() {
      return {
        available: true,
        version: '2026.10.01',
        path: 'yt-dlp',
        managed: true,
        canInstall: true,
        hint: null,
      };
    },
    async probeDownload(url: string) {
      return {
        url,
        title: 'Video de prueba',
        uploader: 'Canal de prueba',
        durationSeconds: 600,
        thumbnail: THUMB,
        kind: 'video' as const,
        entryCount: 1,
        maxHeight: 4320,
        estimatedBytes: 300_000_000,
        qualities: [
          {
            height: 4320,
            label: '4320p · 8K',
            width: 7680,
            fps: 30,
            ext: 'mp4',
            vcodec: 'vp9',
            filesize: 300_000_000,
          },
          {
            height: 1080,
            label: '1080p · Full HD',
            width: 1920,
            fps: 30,
            ext: 'mp4',
            vcodec: 'avc1',
            filesize: 80_000_000,
          },
        ],
      };
    },
    async downloadMedia(request) {
      return {
        runId: '11111111-1111-4111-8111-111111111111',
        directory: 'C:\\cache\\downloads\\fake',
        files: [
          {
            path: 'C:\\cache\\downloads\\fake\\video.mp4',
            name: 'video.mp4',
            bytes: 90_000_000,
            kind: 'video' as const,
          },
        ],
        compressed: request.compression !== 'none',
        warnings: [],
      };
    },
    async cleanupDownload() {},
    async onDownloadProgress() {
      return () => {};
    },
    async extractFreezeFrame() {
      return readyAsset({
        id: newId(),
        label: 'Freeze frame',
        kind: 'image',
        source: { type: 'local', path: 'media/freeze.png' },
        media: { width: 1920, height: 1080 },
      });
    },
    async createVideoProxy() {
      return {
        path: 'media/proxies/fake.mp4',
        width: 854,
        height: 480,
        bytes: 250_000,
      };
    },
    async sampleAssetColor() {
      return { r: 120, g: 100, b: 90 };
    },
    async mediaThumbnail() {
      return THUMB;
    },
    async checkAssetFiles(paths: string[]) {
      return paths.map<AssetFileInfo>((path) => ({ path, exists: true, bytes: 1000 }));
    },
    async detectScenes(_assetId: string, threshold: number) {
      return {
        cuts: [
          { frame: 60, seconds: 2 },
          { frame: 120, seconds: 4 },
        ],
        durationFrames: 300,
        fpsNum: 30,
        fpsDen: 1,
        threshold,
      };
    },
    async analyzeStabilization(
      _assetId: string,
      inFrame: number,
      outFrame: number,
      smoothing: number,
    ) {
      return {
        path: 'media/stabilized-preview.mp4',
        smoothing,
        inFrame,
        outFrame,
      };
    },
    async analyzeMedia(
      assetId: string,
      _sceneThreshold?: number,
      _silenceDb?: number,
      _minSilenceSeconds?: number,
    ) {
      return {
        assetId,
        kind: 'video' as const,
        durationSeconds: 10,
        fpsNum: 30,
        fpsDen: 1,
        hasAudio: true,
        scenes: [2, 4],
        silences: [{ startSeconds: 1, endSeconds: 1.5 }],
        blacks: [],
        freezes: [],
        loudness: {
          integratedLufs: -18,
          truePeakDb: -1.5,
          lraDb: 3,
          noiseFloorDb: -62,
        },
        lumaAverage: 118,
        saturationAverage: 42,
        warnings: [],
      };
    },
    async writeProjectVariant(input) {
      return {
        path: `${input.directory}\${input.fileName}.editoria.json`,
        bytes: 2048,
        copiedAssets: 1,
      };
    },
    async renderProjectVariant(input) {
      return {
        path: input.outputPath,
        bytes: 1024,
        durationSeconds: 5,
        width: 1920,
        height: 1080,
      };
    },
    async convertMedia(request) {
      return {
        path: `${request.outputDir}\\convertido.${request.target}`,
        bytes: 2048,
        durationSeconds: 1,
        formatName: request.target,
      };
    },
    async listMcpServers() {
      return mcpServers.map((server) => ({ ...server }));
    },
    async saveMcpServer(input: McpServerInput) {
      const server: McpServerConfig = {
        id: input.id ?? newId(),
        name: input.name,
        command: input.command,
        args: input.args,
        envKeys: input.env.map((variable) => variable.key),
        workingDir: input.workingDir ?? null,
        enabled: input.enabled,
      };
      const index = mcpServers.findIndex((item) => item.id === server.id);
      if (index >= 0) mcpServers[index] = server;
      else mcpServers = [...mcpServers, server];
      return server;
    },
    async deleteMcpServer(id: string) {
      mcpServers = mcpServers.filter((server) => server.id !== id);
    },
    async probeMcpServer(id: string): Promise<McpProbeResult> {
      const server = mcpServers.find((item) => item.id === id);
      const flow = /flow/i.test(server?.name ?? '');
      return {
        serverId: id,
        serverName: server?.name ?? 'Servidor simulado',
        serverVersion: '1.0.0',
        protocolVersion: '2025-06-18',
        tools: [
          {
            name: 'echo',
            description: 'Devuelve el texto recibido',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          },
          ...(flow
            ? [
                {
                  name: 'flow_generate_image',
                  description: 'Genera una imagen con Google Flow',
                  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
                },
                {
                  name: 'flow_generate_video',
                  description: 'Genera un video con Google Flow',
                  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
                },
              ]
            : []),
        ],
        elapsedMs: 12,
      };
    },
    async callMcpTool(id: string, tool: string, args: unknown): Promise<McpCallResult> {
      return {
        serverId: id,
        toolName: tool,
        result: { content: [{ type: 'text', text: JSON.stringify(args) }], isError: false },
        isError: false,
        elapsedMs: 9,
      };
    },
    async loadDirectorMemory() {
      return null;
    },
    async saveDirectorMemory() {},
    async transcribeAsset() {
      return {
        language: 'es',
        languageProbability: 0.98,
        durationSeconds: 2.5,
        model: 'small',
        segments: [
          {
            start: 0,
            end: 1.2,
            text: 'Hola desde la prueba.',
            words: [
              { start: 0, end: 0.4, word: 'Hola', probability: 0.9 },
              { start: 0.4, end: 0.8, word: 'desde', probability: 0.9 },
              { start: 0.8, end: 1.2, word: 'la', probability: 0.9 },
            ],
          },
          {
            start: 1.2,
            end: 2.5,
            text: 'Segundo subtítulo automático.',
            words: [],
          },
        ],
      };
    },
    async systemInfo(): Promise<SystemInfo> {
      return {
        appVersion: '0.1.0-test',
        os: 'windows-x86_64',
        arch: 'x86_64',
        ffmpeg: { available: true, path: 'C:\\tools\\ffmpeg.exe', version: 'ffmpeg 9.0', hint: null },
        ffprobe: { available: true, path: 'C:\\tools\\ffprobe.exe', version: 'ffprobe 9.0', hint: null },
        powershell: {
          available: true,
          path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          version: '5.1',
          hint: null,
        },
        configDir: 'C:\\Users\\tester\\AppData\\Roaming\\editor-ia',
        cacheDir: 'C:\\Users\\tester\\AppData\\Local\\editor-ia',
      };
    },
    async chooseTool() {
      return service.systemInfo();
    },
    async revealOutput() {
      return;
    },
    async getProvider(): Promise<ProviderInfo> {
      return {
        kind: 'mock',
        baseUrl: '',
        model: 'mock',
        hasKey: false,
        keyringAvailable: true,
      };
    },
    async saveProvider(input) {
      return {
        kind: input.kind,
        baseUrl: input.baseUrl,
        model: input.model,
        hasKey: Boolean(input.apiKey),
        keyringAvailable: true,
      };
    },
    async clearProviderKey() {
      return service.getProvider();
    },
    async getAudioProvider(): Promise<AudioProviderInfo> {
      return {
        kind: 'windows-sapi',
        voiceId: 'Microsoft Helena',
        modelId: 'eleven_multilingual_v2',
        approved: false,
        externalUrl: 'https://elevenlabs.io/app/speech-synthesis',
        hasKey: false,
        keyringAvailable: true,
      };
    },
    async saveAudioProvider(input) {
      return {
        kind: input.kind,
        voiceId: input.voiceId,
        modelId: input.modelId,
        approved: input.approved,
        externalUrl: input.externalUrl,
        hasKey: Boolean(input.apiKey),
        keyringAvailable: true,
      };
    },
    async clearAudioProviderKey() {
      return service.getAudioProvider();
    },
    async openExternalUrl() {
      return;
    },
    async savePublicationManifest() {
      return 'C:\\Users\\tester\\Proyectos\\publicacion.json';
    },
    async generateScript(request: GenerateScriptRequest): Promise<ScriptPlan> {
      return {
        title: `Guion de ${request.sceneCount} escenas`,
        providerId: 'mock',
        model: 'mock',
        simulated: true,
        costDisclosed: true,
        costApproved: true,
        scenes: Array.from({ length: request.sceneCount }, (_, index) => ({
          id: newId(),
          order: index,
          title: `Escena ${index + 1}`,
          intent: index === 0 ? 'hook' : 'explainer',
          narration: `Narración de la escena ${index + 1}.`,
          visual: 'Plano de apoyo.',
          estimatedSeconds: 8,
        })),
      };
    },
    async listVoices(): Promise<VoiceInfo[]> {
      return [
        { id: 'Microsoft Helena', name: 'Microsoft Helena', culture: 'es-ES', gender: 'Female' },
        { id: 'Microsoft Sabina', name: 'Microsoft Sabina', culture: 'es-MX', gender: 'Female' },
      ];
    },
    async synthesizeNarration(): Promise<NarrationResult> {
      return { asset: unverifiedAudioAsset(), voice: 'Microsoft Helena', provider: 'windows-sapi' };
    },
    async startRender(): Promise<RenderStarted> {
      calls.render += 1;
      return { jobId: 'job-1', profileName: 'YouTube 1080p' };
    },
    async startRenderTo(_profileId: string, outputPath: string): Promise<RenderStarted> {
      calls.render += 1;
      return { jobId: `job-${calls.render}`, profileName: outputPath.split(/[\\/]/).pop() ?? 'lote' };
    },
    async chooseExportDirectory() {
      return 'C:\\Users\\tester\\Exports';
    },
    async cancelRender() {
      return;
    },
    async activeRender() {
      return null;
    },
    async pruneRenderCache() {
      return 0;
    },
    async onRenderProgress(handler) {
      progressHandlers.add(handler);
      return () => progressHandlers.delete(handler);
    },
    async onRenderFinished(handler) {
      finishedHandlers.add(handler);
      return () => finishedHandlers.delete(handler);
    },
    mediaUrl(_root, relative) {
      return `asset://local/${relative}`;
    },
    joinPath(root, relative) {
      return `${root}\\${relative.replace(/\//g, '\\')}`;
    },
    emitProgress(event) {
      for (const handler of progressHandlers) handler(event);
    },
    emitFinished(event) {
      for (const handler of finishedHandlers) handler(event);
    },
    setSaveFailure(message) {
      saveFailure = message;
    },
    setImportOutcome(outcome) {
      importOutcome = outcome;
    },
  };
  return service;
}
