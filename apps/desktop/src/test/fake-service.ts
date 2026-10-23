import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import { FALLBACK_VISUAL_CATALOG } from '../features/visuals/visuals';
import type {
  AssetFileInfo,
  AudioProviderInfo,
  CreateProjectRequest,
  DesktopService,
  GenerateScriptRequest,
  ImportOutcome,
  McpCallResult,
  McpProbeResult,
  McpSessionInfo,
  McpServerConfig,
  McpServerInput,
  NarrationResult,
  OpenedProject,
  ProviderInfo,
  RenderFinishedEvent,
  RenderProgressEvent,
  RenderStarted,
  ConvertProgress,
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
    timelineImports: number;
    render: number;
    compressAny: number;
    destination: string | null;
  };
  emitProgress(event: RenderProgressEvent): void;
  emitFinished(event: RenderFinishedEvent): void;
  setSaveFailure(message: string | null): void;
  setImportOutcome(outcome: ImportOutcome | null): void;
  readonly deliveries: { fileName: string; bytes: Uint8Array }[];
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
  // Sesiones MCP simuladas: se abren con la primera llamada y se cierran a
  // pedido, igual que el backend real.
  const openSessions = new Set<string>();
  const sessionCalls = new Map<string, number>();
  let flowGenerations = 0;
  const progressHandlers = new Set<(event: RenderProgressEvent) => void>();
  const finishedHandlers = new Set<(event: RenderFinishedEvent) => void>();
  const convertHandlers = new Set<(event: ConvertProgress) => void>();
  const deliveries: { fileName: string; bytes: Uint8Array }[] = [];
  const calls = {
    create: 0,
    open: 0,
    save: 0,
    import: 0,
    timelineImports: 0,
    render: 0,
    compressAny: 0,
    destination: null as string | null,
  };

  const service: FakeService = {
    available: true,
    unavailableReason: null,
    calls,
    deliveries,
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
    async saveDeliveryPackage(bytes: Uint8Array, fileName: string) {
      deliveries.push({ fileName, bytes });
      return `C:\\salida\\${fileName}`;
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
      calls.import += 1;
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
    async chooseSubtitleFile() {
      return {
        name: 'demo.srt',
        text: '1\n00:00:00,000 --> 00:00:02,000\nHola subtítulo\n',
      };
    },
    async chooseTimelineFile() {
      return 'C:\\demo\\timeline.edl';
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
    async downloaderBridgeInfo() {
      return {
        port: 47615,
        token: 'token-de-prueba',
        downloadsDir: 'C:\\Users\\tester\\Downloads\\Editor IA',
        running: true,
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
    async chooseDownloadDirectory() {
      return 'D:\\Videos descargados';
    },
    async extensionStatus() {
      return {
        available: true,
        prepared: true,
        sourcePath: 'C:\\repo\\extensions\\editor-ia-downloader',
        preparedPath: 'C:\\Users\\tester\\AppData\\Roaming\\com.editoria.desktop\\extension\\editor-ia-downloader',
        hint: 'Cargala desde Chrome o Edge.',
      };
    },
    async prepareExtension() {
      return {
        available: true,
        prepared: true,
        sourcePath: 'C:\\repo\\extensions\\editor-ia-downloader',
        preparedPath: 'C:\\Users\\tester\\AppData\\Roaming\\com.editoria.desktop\\extension\\editor-ia-downloader',
        hint: 'Cargala desde Chrome o Edge.',
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
    async chooseCookiesFile() {
      return 'C:\\cookies\\cookies.txt';
    },
    async downloadMedia(request) {
      calls.destination = request.destinationRoot ?? null;
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
    async fetchPlatformRules() {
      return null;
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
        sourceBytes: 8192,
        encoder: 'libx264',
      };
    },
    async convertMediaBatch(assetIds, target, outputDir) {
      return assetIds.map((assetId) => ({
        assetId,
        label: `medio ${assetId.slice(0, 4)}`,
        ok: true,
        path: `${outputDir}\\lote-${assetId.slice(0, 4)}.${target}`,
        bytes: 4096,
        sourceBytes: 16_384,
        durationSeconds: 2,
        formatName: target,
        encoder: 'libx264',
      }));
    },
    async compressMedia(request) {
      // El fake simula una compresión real: nunca más grande que el origen.
      const pedido = Math.round((request.targetMegabytes ?? 1) * 1024 * 1024);
      return {
        path: `${request.outputDir}\\comprimido.${request.target}`,
        bytes: Math.min(pedido, 4096),
        durationSeconds: 4,
        formatName: request.target,
        sourceBytes: 32_768,
        encoder: 'h264_nvenc',
      };
    },
    async onConvertProgress(handler) {
      convertHandlers.add(handler);
      return () => convertHandlers.delete(handler);
    },
    async mergeVideos(assetIds, outputDir) {
      return {
        path: `${outputDir}\\union.mp4`,
        bytes: 4096,
        message: `videos unidos (${assetIds.length})`,
      };
    },
    async trimVideo(_assetId, startSeconds, endSeconds, outputDir) {
      return {
        path: `${outputDir}\\recorte.mp4`,
        bytes: 3072,
        message: `recorte de ${startSeconds} a ${endSeconds}`,
      };
    },
    async watermarkVideo(_assetId, text, position, outputDir) {
      return {
        path: `${outputDir}\\marca-de-agua.mp4`,
        bytes: 2560,
        message: `marca «${text}» en ${position}`,
      };
    },
    async setMetadata(_assetId, title, artist, comment, outputDir) {
      return {
        path: `${outputDir}\\con-metadatos.mp4`,
        bytes: 2048,
        message: `metadatos: ${title || artist || comment}`,
      };
    },
    async audioPeaks(assetId, buckets) {
      return {
        assetId,
        durationSeconds: 4,
        buckets: buckets ?? 600,
        peaks: Array.from({ length: buckets ?? 600 }, (_, index) => ({
          min: -0.2 - (index % 7) * 0.05,
          max: 0.3 + (index % 5) * 0.08,
        })),
      };
    },
    async hardwareEncoders() {
      return { h264: null, hevc: null, checked: true };
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
      openSessions.add(id);
      sessionCalls.set(id, (sessionCalls.get(id) ?? 0) + 1);
      if (tool === 'flow_generate_image') {
        flowGenerations += 1;
        return {
          serverId: id,
          toolName: tool,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  artifacts: [
                    { type: 'image', path: `C:\\media\\flow-${flowGenerations}.png` },
                  ],
                }),
              },
            ],
          },
          isError: false,
          elapsedMs: 5,
        };
      }
      if (tool === 'flow_status') {
        return {
          serverId: id,
          toolName: tool,
          result: { content: [{ type: 'text', text: JSON.stringify({ credits: 42 }) }] },
          isError: false,
          elapsedMs: 2,
        };
      }
      return {
        serverId: id,
        toolName: tool,
        result: { content: [{ type: 'text', text: JSON.stringify(args) }], isError: false },
        isError: false,
        elapsedMs: 9,
      };
    },
    async chooseVideoFile(title?: string) {
      void title;
      return 'C:////media////toma.mp4';
    },
    async chooseAudioFile(title?: string) {
      void title;
      return 'C:////media////voz.wav';
    },
    async probeMediaFile(path: string) {
      return {
        path,
        bytes: 41_943_040,
        durationSeconds: 12.5,
        formatName: 'mov,mp4,m4a',
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
      };
    },
    async compressAnyFile(request) {
      calls.compressAny = (calls.compressAny ?? 0) + 1;
      void request;
      return {
        path: 'C:////salida////toma.mp4',
        bytes: 4_194_304,
        durationSeconds: 12.5,
        formatName: 'mov,mp4,m4a',
        sourceBytes: 41_943_040,
        encoder: 'libx264',
      };
    },
    onCompressProgress(_handler: (event: { percent: number }) => void) {
      // El arnés no simula compresiones largas: el progreso no llega a emitirse.
      return Promise.resolve(() => {});
    },
    async measureVmaf(original: string, compressed: string) {
      void original;
      void compressed;
      return 91.3;
    },
    async listModels() {
      return [
        {
          id: 'u2netp',
          capability: 'remove-background',
          purpose: 'Recorta el sujeto de una foto generando su recorte con transparencia.',
          bytes: 4_574_861,
          downloaded: true,
          license: { id: 'apache-2.0', detail: 'Pesos de U²-Net (Apache-2.0).', url: '' },
          sourceUrl: 'https://github.com/danielgatis/rembg',
        },
        {
          id: 'seeta-face',
          capability: 'face-detection',
          purpose: 'Detecta rostros para smart reframe.',
          bytes: 1_209_904,
          downloaded: true,
          license: { id: 'bsd-2-clause', detail: 'SeetaFace (BSD-2-Clause).', url: '' },
          sourceUrl: 'https://github.com/seetaface/SeetaFaceEngine',
        },
      ];
    },
    async downloadModel(id: string) {
      if (id === 'seeta-face') {
        return {
          id,
          capability: 'face-detection',
          purpose: 'Detecta rostros para smart reframe.',
          bytes: 1_209_904,
          downloaded: true,
          license: { id: 'bsd-2-clause', detail: 'SeetaFace (BSD-2-Clause).', url: '' },
          sourceUrl: 'https://github.com/seetaface/SeetaFaceEngine',
        };
      }
      return {
        id,
        capability: 'remove-background',
        purpose: 'Recorta el sujeto de una foto generando su recorte con transparencia.',
        bytes: 4_574_861,
        downloaded: true,
        license: { id: 'apache-2.0', detail: 'Pesos de U²-Net (Apache-2.0).', url: '' },
        sourceUrl: 'https://github.com/danielgatis/rembg',
      };
    },
    async deleteModel(id: string) {
      return id === 'u2netp';
    },
    async listCapabilities() {
      return [
        {
          id: 'remove-background',
          label: 'Quitar fondo de una foto',
          purpose: 'Recorta el sujeto de una foto generando su recorte con transparencia.',
          backends: [
            {
              id: 'modelo-u2netp',
              kind: 'local',
              detail: 'Modelo u2netp en el equipo',
              available: true,
              reason: null,
            },
          ],
          available: true,
        },
      ];
    },
    async listVisualCatalog() {
      return FALLBACK_VISUAL_CATALOG;
    },
    async auditVisuals(project: unknown) {
      const value = project as { timeline?: { clips?: unknown[] } };
      return {
        clipsScanned: value.timeline?.clips?.length ?? 0,
        transitions: 0,
        effectsClips: 0,
        findings: [],
      };
    },
    async upscaleImage(inputPath: string) {
      return {
        path: inputPath.replace(/\.[^.]+$/, '-x4.png'),
        inputWidth: 128,
        inputHeight: 128,
        outputWidth: 512,
        outputHeight: 512,
        tiles: 1,
      };
    },
    async removeBackground(inputPath: string) {
      return {
        path: inputPath.replace(/\.[^.]+$/, '-sin-fondo.png'),
        width: 1920,
        height: 1080,
      };
    },
    async denoiseMedia(request) {
      const extension = request.mode === 'image' ? 'png' : 'mp4';
      return {
        path: request.inputPath.replace(/\.[^.]+$/, `-denoise.${extension}`),
        bytes: 1_500_000,
        sourceBytes: 2_000_000,
        filter: 'hqdn3d=2.50:1.80:6.00:4.00',
        width: 1920,
        height: 1080,
        durationSeconds: 12,
      };
    },
    async onDenoiseProgress() {
      return () => {};
    },
    async enhanceDialogue(request) {
      const preset = request.preset ?? 'dialogo';
      return {
        path: `${request.outputDir ?? 'C:\media'}\voz-${preset}.wav`,
        bytes: 2_500_000,
        durationSeconds: 4.2,
        preset,
        effects: ['denoise', 'dehum', 'deesser', 'compressor', 'limiter'],
      };
    },
    async onDialogueProgress() {
      return () => {};
    },
    async saveThumbnail(request) {
      return {
        path: `${request.outputDir}\\miniatura.png`,
        bytes: 220_000,
        width: 1280,
        height: 720,
      };
    },
    async pickThumbnailFrames(request) {
      void request;
      return [1, 2, 3].map((rank) => ({
        path: `C:\cache\thumbnails\frame-${rank}.png`,
        score: 80 - rank * 4,
        timeSeconds: rank * 2.5,
        width: 480,
        height: 270,
      }));
    },
    async renderPreviewFrame(request) {
      return {
        path: 'C:\cache\preview\frame.png',
        width: request.native ? 3840 : 1920,
        height: request.native ? 2160 : 1080,
        frame: request.frame,
        timeSeconds: request.frame / 30,
        clipId: request.clipId,
        clipLabel: 'Clip',
        native: request.native === true,
        decoder: 'ffmpeg',
      };
    },
    async analyzeScopesFrame(request) {
      void request;
      return {
        width: 1920,
        height: 1080,
        samples: 129600,
        waveform: { columns: 480, rows: 256, data: [1, 2, 3] },
        vectorscope: { columns: 255, rows: 255, data: [1, 2, 3] },
        histogram: [[1], [2], [3]],
        histogramY: [1],
        meanCbCr: [0, 0],
      };
    },
    async exportLookLut(request) {
      return {
        path: `${request.outputDir}\look.cube`,
        bytes: 120_000,
        size: 33,
      };
    },
    async exportEdl(request) {
      return {
        path: `${request.outputDir}\timeline.edl`,
        bytes: 640,
        events: 3,
        warnings: [],
      };
    },
    async exportOtio(request) {
      return { path: `${request.outputDir}\timeline.otio`, bytes: 2048, tracks: 2, clips: 3, warnings: [] };
    },
    async exportFcpxml(request) {
      return { path: `${request.outputDir}\timeline.fcpxml`, bytes: 3072, clips: 3, warnings: [] };
    },
    async importTimeline(request) {
      calls.timelineImports += 1;
      const asset = readyAsset({
        id: newId(),
        label: 'Toma importada',
        source: { type: 'local', path: 'media/toma.mp4' },
      });
      const trackId = newId();
      return {
        format: 'edl',
        path: request.path,
        assets: [asset],
        tracks: [
          {
            id: trackId,
            kind: 'video' as const,
            label: 'V1 · EDL',
            order: 0,
            muted: false,
            hidden: false,
            locked: false,
          },
        ],
        clips: [
          {
            id: newId(),
            trackId,
            label: 'Toma importada',
            startFrame: 0,
            durationFrames: 60,
            kind: 'video' as const,
            source: {
              type: 'asset' as const,
              assetId: asset.id,
              inFrame: 0,
              outFrame: 60,
            },
          },
        ],
        warnings: [],
        importedClips: 1,
        newAssets: 1,
        reusedAssets: 0,
      };
    },
    async generateVideoEffect(request) {
      void request;
      return {
        name: 'Cine IA',
        description: 'Contraste y viñeta generados sin red.',
        effects: { contrast: 1.15, vignette: 0.2 },
        providerId: 'mock',
        model: 'mock',
        simulated: true,
      };
    },
    async translateSubtitles(request) {
      return {
        texts: request.texts.map(
          (text) => `${request.targetLanguage.toUpperCase()}: ${text}`,
        ),
        providerId: 'mock',
        model: 'simulado',
        simulated: false,
      };
    },
    async saveLocalizedSubtitle(request) {
      return {
        path: `${request.outputDir}\\subtitulos.${request.language}.${request.format}`,
        bytes: 512,
        format: request.format,
        language: request.language,
      };
    },
    async synthesizeDub(request) {
      return {
        path: `${request.outputDir}\\video-dub-${request.language}.mp4`,
        bytes: 12_400_000,
        width: 1080,
        height: 1920,
        durationSeconds: request.endSeconds ?? 5,
        language: request.language,
        voice: request.voice ?? 'Microsoft Sabina',
        cues: request.cues.length,
        replacedOriginalAudio: !(request.bedVolume && request.bedVolume > 0),
        originalAudioVolume: request.bedVolume ?? 0,
        warnings: [],
      };
    },
    async onDubProgress() {
      return () => {};
    },
    async cloneVoice(request) {
      return {
        path: 'media/voz-clonada-demo.wav',
        bytes: 1_200_000,
        durationSeconds: 2.2,
        language: request.language,
        engine: request.engine ?? 'xtts',
        referenceSha256: 'b'.repeat(64),
      };
    },
    async onCloneProgress() {
      return () => {};
    },
    async lipSync(request) {
      return {
        path: `${request.outputDir}\\video-lipsync.mp4`,
        bytes: 18_000_000,
        width: 1080,
        height: 1920,
        durationSeconds: 5,
        engine: request.engine ?? 'wav2lip',
      };
    },
    async onLipSyncProgress() {
      return () => {};
    },
    async exportShort(request) {
      return {
        path: `${request.outputDir}\\short-vertical.mp4`,
        bytes: 4_200_000,
        width: 1080,
        height: 1920,
        durationSeconds: request.endSeconds - request.startSeconds,
        reframe: request.smartReframe ? 'smart' : 'center',
        facesDetected: request.smartReframe ? 8 : 0,
      };
    },
    async onShortProgress() {
      return () => {};
    },
    async analyzeFaceTrack(request) {
      const duration = Math.max(0.1, request.endSeconds - request.startSeconds);
      const samples = [0, 0.33, 0.66, 1].map((fraction) => ({
        time: request.startSeconds + duration * fraction,
        centerX: 0.5,
        centerY: 0.4,
        size: 0.3,
      }));
      return {
        model: 'seeta-face',
        durationSeconds: duration,
        detections: samples.length,
        samples,
        track: samples.map((sample) => ({
          time: sample.time,
          x: sample.centerX,
          y: sample.centerY,
        })),
        scaledWidth: 1080,
        scaledHeight: 1920,
        xExpression: 'iw*0.35',
        yExpression: 'ih*0.2',
      };
    },
    async chooseImageFile(title?: string) {
      // El arnés devuelve una ruta fija; el test que necesite otra la pisa.
      void title;
      return 'C:////media////foto.png';
    },
    absoluteFileUrl(path: string) {
      return THUMB;
    },
    async closeMcpSession(id: string) {
      const had = openSessions.delete(id);
      sessionCalls.delete(id);
      return had;
    },
    async mcpSessionStatus(): Promise<McpSessionInfo[]> {
      return [...openSessions].map((id) => ({
        serverId: id,
        pid: 4242,
        calls: sessionCalls.get(id) ?? 0,
        startedAtMs: 1_700_000_000_000,
        idleMs: 1_000,
      }));
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
        hardware: { h264: null, hevc: null, checked: true },
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
        { id: 'Microsoft Zira', name: 'Microsoft Zira', culture: 'en-US', gender: 'Female' },
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
