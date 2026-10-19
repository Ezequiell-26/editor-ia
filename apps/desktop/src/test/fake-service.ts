import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type {
  AssetFileInfo,
  CreateProjectRequest,
  DesktopService,
  GenerateScriptRequest,
  ImportOutcome,
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
    async mediaThumbnail() {
      return THUMB;
    },
    async checkAssetFiles(paths: string[]) {
      return paths.map<AssetFileInfo>((path) => ({ path, exists: true, bytes: 1000 }));
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
        { name: 'Microsoft Helena', culture: 'es-ES', gender: 'Female' },
        { name: 'Microsoft Sabina', culture: 'es-MX', gender: 'Female' },
      ];
    },
    async synthesizeNarration(): Promise<NarrationResult> {
      return { asset: unverifiedAudioAsset(), voice: 'Microsoft Helena' };
    },
    async startRender(): Promise<RenderStarted> {
      calls.render += 1;
      return { jobId: 'job-1', profileName: 'YouTube 1080p' };
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
