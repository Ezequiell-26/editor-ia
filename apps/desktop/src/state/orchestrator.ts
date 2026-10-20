import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
import {
  addAsset,
  applyScenePlan,
  ensureDelivery,
  markAssetReady,
  newId,
} from './project-actions';
import { prepareAutoEdit, type NarrationCandidate } from './auto-edit';
import { artifactPaths, flowProviderId, sceneVisualPrompt } from './flow';

/**
 * End-to-end orchestrator: brief -> script -> voice -> (optional) Flow media ->
 * automatic assembly -> portable project -> verified MP4.
 *
 * The ledger is deliberately plain JSON so a job survives an app restart. A
 * job never spends Flow credits without an explicit approval recorded in its
 * options, and it never overwrites a previous variant.
 */

export const ORCHESTRATOR_SCHEMA = 'editor-ia.orchestrator-job.v1';
export const ORCHESTRATOR_STORAGE_KEY = 'editor-ia.orchestrator.jobs.v1';

export type OrchestratorStatus = 'queued' | 'running' | 'cancelled' | 'done' | 'error';
export type OrchestratorStage =
  | 'script'
  | 'narration'
  | 'media'
  | 'assemble'
  | 'write'
  | 'render'
  | 'done';

export interface OrchestratorMedia {
  readonly id: string;
  readonly label: string;
  readonly kind: 'image' | 'video';
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationFrames?: number;
}

export interface OrchestratorOptions {
  readonly brief: string;
  readonly scenes: number;
  readonly language: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly outputDir: string;
  readonly mediaIds: readonly string[];
  readonly voiceProvider: 'windows-sapi';
  readonly voiceId?: string;
  readonly photoMotion: 'auto' | 'none';
  readonly transitionFrames: number;
  readonly includeCaptions: boolean;
  readonly renderVideo: boolean;
  readonly generateMedia: boolean;
  readonly flowServerId?: string;
  readonly flowKind: 'image' | 'video';
  readonly flowModel: string;
  readonly flowRatio: string;
  readonly flowDuration: string;
  readonly approveCredits: boolean;
  readonly confirmRights: boolean;
}

export interface OrchestratorLogEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface OrchestratorResult {
  readonly durationFrames: number;
  readonly clipCount: number;
  readonly captionCount: number;
  readonly mediaUsed: number;
  readonly warnings: readonly string[];
}

export interface OrchestratorJob {
  readonly schema: typeof ORCHESTRATOR_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: OrchestratorStatus;
  readonly stage: OrchestratorStage;
  readonly progress: number;
  readonly options: OrchestratorOptions;
  readonly log: readonly OrchestratorLogEntry[];
  readonly projectPath?: string;
  readonly videoPath?: string;
  readonly videoBytes?: number;
  readonly profileId?: string;
  readonly error?: string;
  readonly result?: OrchestratorResult;
  readonly cost: {
    readonly generations: number;
    readonly creditsApproved: boolean;
  };
}

export interface OrchestratorJobInput {
  readonly name: string;
  readonly options: OrchestratorOptions;
}

export interface OrchestratorDeps {
  readonly service: DesktopService;
  readonly baseProject: ProjectDocument;
  readonly onUpdate: (job: OrchestratorJob) => void;
  readonly shouldCancel?: () => boolean;
}

export interface OrchestratorResume {
  /** Skip the creative stages and retry the render of an already written project. */
  readonly stage?: 'render';
}

export interface JobStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function now(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'video'
  );
}

export function createOrchestratorJob(input: OrchestratorJobInput): OrchestratorJob {
  const stamp = now();
  return {
    schema: ORCHESTRATOR_SCHEMA,
    id: newId(),
    name: input.name.trim().slice(0, 120) || 'Video automático',
    createdAt: stamp,
    updatedAt: stamp,
    status: 'queued',
    stage: 'script',
    progress: 0,
    options: input.options,
    log: [],
    cost: { generations: 0, creditsApproved: input.options.approveCredits },
  };
}

function outputName(job: OrchestratorJob): string {
  return `${slugify(job.name)}-${job.id.slice(0, 6)}`;
}

function checkOptions(job: OrchestratorJob): void {
  const options = job.options;
  if (options.brief.trim().length < 10) {
    throw new Error('el brief necesita al menos 10 caracteres');
  }
  if (!options.outputDir.trim()) {
    throw new Error('indicá una carpeta de salida absoluta para el autopiloto');
  }
  if (!options.confirmRights) {
    throw new Error('confirmá los derechos de los medios y de la voz antes de automatizar');
  }
  if (options.generateMedia) {
    if (!options.flowServerId) {
      throw new Error('elegí el servidor MCP de Google Flow o desactivá la generación');
    }
    if (!options.approveCredits) {
      throw new Error('autorizá el consumo de créditos de Flow antes de generar');
    }
  }
}

function mediaPoolFrom(baseProject: ProjectDocument, ids: readonly string[]): Asset[] {
  const wanted = new Set(ids);
  return baseProject.assets.filter(
    (asset) =>
      wanted.has(asset.id) &&
      asset.status === 'ready' &&
      (asset.kind === 'image' || asset.kind === 'video'),
  );
}

function projectMedia(asset: Asset): OrchestratorMedia | null {
  if (asset.kind !== 'image' && asset.kind !== 'video') return null;
  if (asset.source.type !== 'local' || !asset.integrity) return null;
  return {
    id: asset.id,
    label: asset.label,
    kind: asset.kind,
    path: asset.source.path,
    hash: asset.integrity.sha256,
    bytes: asset.integrity.bytes,
    width: asset.media?.width ?? 1920,
    height: asset.media?.height ?? 1080,
    ...('durationFrames' in (asset.media ?? {})
      ? { durationFrames: (asset.media as { durationFrames?: number }).durationFrames }
      : {}),
  };
}

/** Media of the open project that the orchestrator can reuse. */
export function orchestratorMedia(project: ProjectDocument): OrchestratorMedia[] {
  return project.assets
    .map((asset) => projectMedia(asset))
    .filter((media): media is OrchestratorMedia => media !== null);
}

async function generateSceneMedia(
  job: OrchestratorJob,
  deps: OrchestratorDeps,
  project: ProjectDocument,
  log: (level: OrchestratorLogEntry['level'], message: string) => void,
): Promise<{ project: ProjectDocument; mediaByScene: Record<string, string>; generations: number }> {
  const options = job.options;
  if (!options.generateMedia) return { project, mediaByScene: {}, generations: 0 };
  const serverId = options.flowServerId;
  if (!serverId) return { project, mediaByScene: {}, generations: 0 };
  if (!options.approveCredits) {
    throw new Error('no se generó nada: faltó autorizar los créditos de Flow');
  }
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order);
  const tool = options.flowKind === 'video' ? 'flow_generate_video' : 'flow_generate_image';
  const outputFolder = `${options.outputDir.replace(/[\\/]+$/, '')}\\flow`;
  let next = project;
  let generations = 0;
  const mediaByScene: Record<string, string> = {};

  try {
    const connection = await deps.service.callMcpTool(serverId, 'flow_connect', { headless: false });
    if (connection.isError) {
      log('warn', 'Flow no confirmó la conexión; se intentará generar igual.');
    }
  } catch (cause) {
    log(
      'warn',
      `No se pudo abrir Chrome para Flow: ${cause instanceof Error ? cause.message : 'error desconocido'}`,
    );
  }

  for (const [index, scene] of scenes.entries()) {
    if (deps.shouldCancel?.()) break;
    const prompt = sceneVisualPrompt(scene);
    if (!prompt) {
      log('warn', `Escena ${index + 1} sin prompt visual; se omite la generación.`);
      continue;
    }
    log('info', `Flow ${index + 1}/${scenes.length}: ${prompt.slice(0, 110)}`);
    try {
      const result = await deps.service.callMcpTool(serverId, tool, {
        prompt,
        model: options.flowModel,
        ratio: options.flowRatio,
        auto_confirm: true,
        output_folder: outputFolder,
        response_format: 'detailed',
        ...(options.flowKind === 'video' ? { duration: options.flowDuration } : {}),
      });
      generations += 1;
      if (result.isError) {
        log('warn', `Flow devolvió un error en la escena ${index + 1}; se sigue con los medios existentes.`);
        continue;
      }
      const paths = artifactPaths(result.result);
      if (paths.length === 0) {
        log('warn', `Flow no devolvió rutas en la escena ${index + 1}.`);
        continue;
      }
      const imported = await deps.service.importMediaPaths({
        paths: [paths[0] as string],
        fpsNum: options.fpsNum,
        fpsDen: options.fpsDen,
        confirmRights: true,
        provider: flowProviderId(options.flowKind),
      });
      const asset = imported.assets.find((item) =>
        options.flowKind === 'video' ? item.kind === 'video' : item.kind === 'image',
      );
      if (!asset) {
        log('warn', `El artefacto de la escena ${index + 1} no se pudo importar.`);
        continue;
      }
      next = addAsset(next, asset);
      if (asset.status !== 'ready') {
        next = markAssetReady(next, asset.id, 'allowed');
      }
      mediaByScene[scene.id] = asset.id;
      log('info', `Escena ${index + 1} lista: ${asset.label}`);
    } catch (cause) {
      log(
        'warn',
        `La generación de la escena ${index + 1} falló: ${
          cause instanceof Error ? cause.message : 'error desconocido'
        }`,
      );
    }
  }

  return { project: next, mediaByScene, generations };
}

/**
 * Runs one job. Every stage reports through `onUpdate`; the returned job is the
 * final state. A cancelled job stops between stages and between generated
 * scenes, never in the middle of an asset write.
 */
export async function runOrchestratorJob(
  initial: OrchestratorJob,
  deps: OrchestratorDeps,
  resume: OrchestratorResume = {},
): Promise<OrchestratorJob> {
  let job: OrchestratorJob = {
    ...initial,
    status: 'running',
    updatedAt: now(),
  };
  delete (job as { error?: string }).error;
  let generations = 0;
  let mediaByScene: Record<string, string> = {};
  let project: ProjectDocument | null = null;
  let narrations: NarrationCandidate[] = [];

  const emit = (patch: Partial<OrchestratorJob>): void => {
    job = { ...job, ...patch, updatedAt: now() };
    deps.onUpdate(job);
  };
  const log = (level: OrchestratorLogEntry['level'], message: string): void => {
    emit({
      log: [...job.log, { at: now(), level, message: message.slice(0, 500) }].slice(-200),
    });
  };
  const cancelled = (): boolean => Boolean(deps.shouldCancel?.());
  const stopIfCancelled = (): boolean => {
    if (!cancelled()) return false;
    log('warn', 'Trabajo cancelado por el usuario.');
    emit({ status: 'cancelled', stage: 'done', progress: 1 });
    return true;
  };

  try {
    checkOptions(job);

    if (resume.stage === 'render' && job.projectPath && job.profileId) {
      log('info', 'Reanudando desde el render del proyecto ya escrito.');
    } else {
      emit({ stage: 'script', progress: 0.04 });
      if (stopIfCancelled()) return job;

      let next = createEmptyProject(job.name, now());
      next = {
        ...next,
        language: job.options.language as 'es' | 'en',
        video: {
          ...next.video,
          width: job.options.width,
          height: job.options.height,
          frameRate: { num: job.options.fpsNum, den: job.options.fpsDen },
        },
      };
      next = ensureDelivery(next);
      const parsed = parseProject(next);
      if (!parsed.ok) {
        throw new Error('el proyecto base del autopiloto no es válido');
      }
      next = parsed.project;
      for (const asset of mediaPoolFrom(deps.baseProject, job.options.mediaIds)) {
        next = addAsset(next, asset);
      }
      if (job.options.mediaIds.length > 0 && next.assets.length === 0) {
        throw new Error('los medios elegidos ya no están listos en el proyecto abierto');
      }
      if (job.options.generateMedia && !job.options.mediaIds.length) {
        log('info', 'Sin medios iniciales: se usará lo que genere Flow escena por escena.');
      }

      const script = await deps.service.generateScript({
        brief: job.options.brief.trim(),
        sceneCount: job.options.scenes,
        language: job.options.language,
        approvedCost: true,
      });
      if (script.simulated) {
        log('warn', 'El guion vino del proveedor simulado; configurá un proveedor real para producción.');
      }
      next = applyScenePlan(next, script, { replace: true });
      emit({ name: (script.title || job.name).slice(0, 120) });
      project = next;
      log('info', `Guion: ${script.scenes.length} escena(s) con ${script.model}.`);

      emit({ stage: 'narration', progress: 0.16 });
      if (stopIfCancelled()) return job;
      const narrationScenes = [...next.scenes].sort((a, b) => a.order - b.order);
      for (const [index, scene] of narrationScenes.entries()) {
        if (stopIfCancelled()) return job;
        const text = scene.narration.text?.trim();
        if (!text) continue;
        try {
          const result = await deps.service.synthesizeNarration({
            text,
            ...(job.options.voiceId ? { voice: job.options.voiceId } : {}),
            fpsNum: job.options.fpsNum,
            fpsDen: job.options.fpsDen,
            provider: job.options.voiceProvider,
          });
          narrations.push({ sceneId: scene.id, asset: result.asset });
          log('info', `Voz ${index + 1}/${narrationScenes.length}: ${result.voice || result.provider}.`);
        } catch (cause) {
          log(
            'warn',
            `La voz de la escena ${index + 1} falló: ${
              cause instanceof Error ? cause.message : 'error desconocido'
            }; se usará duración estimada.`,
          );
        }
        emit({ progress: 0.16 + (0.16 * (index + 1)) / Math.max(1, narrationScenes.length) });
      }

      if (job.options.generateMedia) {
        emit({ stage: 'media', progress: 0.33 });
        if (stopIfCancelled()) return job;
        const generated = await generateSceneMedia(job, deps, next, log);
        next = generated.project;
        mediaByScene = generated.mediaByScene;
        generations = generated.generations;
        emit({
          cost: { generations, creditsApproved: job.options.approveCredits },
          progress: 0.66,
        });
        if (Object.keys(mediaByScene).length > 0) {
          log('info', `Flow aportó ${Object.keys(mediaByScene).length} medio(s) al montaje.`);
        }
      }

      emit({ stage: 'assemble', progress: 0.7 });
      if (stopIfCancelled()) return job;
      const assembled = prepareAutoEdit(
        next,
        narrations,
        {
          assignment: 'match',
          includeCaptions: job.options.includeCaptions,
          replaceTimeline: true,
          photoMotion: job.options.photoMotion,
          transitionFrames: job.options.transitionFrames,
          includeVideos: true,
          mediaByScene,
        },
        true,
      );
      for (const warning of assembled.plan.warnings) log('warn', warning);
      next = assembled.project;
      project = next;

      emit({ stage: 'write', progress: 0.8 });
      if (stopIfCancelled()) return job;
      const written = await deps.service.writeProjectVariant({
        directory: job.options.outputDir,
        fileName: outputName(job),
        project: next,
      });
      const profileId = next.renderProfiles[0]?.id;
      log('info', `Proyecto escrito: ${written.path}`);
      emit({
        projectPath: written.path,
        ...(profileId ? { profileId } : {}),
        progress: 0.86,
      });
    }

    if (stopIfCancelled()) return job;
    const projectPath = job.projectPath;
    const profileId = job.profileId;
    if (!projectPath) {
      throw new Error('no hay un proyecto escrito para renderizar');
    }

    if (job.options.renderVideo) {
      emit({ stage: 'render', progress: 0.88 });
      if (!profileId) throw new Error('el proyecto no declara un perfil de render');
      const videoPath = `${job.options.outputDir.replace(/[\\/]+$/, '')}\\${outputName(job)}.mp4`;
      const rendered = await deps.service.renderProjectVariant({
        projectPath,
        profileId,
        outputPath: videoPath,
        includeCaptions: job.options.includeCaptions,
      });
      log('info', `MP4 verificado: ${rendered.width}x${rendered.height}, ${rendered.bytes} bytes.`);
      emit({
        videoPath: rendered.path,
        videoBytes: rendered.bytes,
        progress: 0.98,
      });
    }

    if (!project && !job.projectPath) {
      throw new Error('el trabajo terminó sin proyecto');
    }

    const finalProject = project;
    const durationFrames = finalProject
      ? finalProject.timeline.clips.reduce(
          (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
          0,
        )
      : 0;
    const result: OrchestratorResult = {
      durationFrames,
      clipCount: finalProject?.timeline.clips.length ?? 0,
      captionCount: finalProject?.captions.cues.length ?? 0,
      mediaUsed: finalProject?.assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video').length ?? 0,
      warnings: [],
    };
    emit({
      status: 'done',
      stage: 'done',
      progress: 1,
      cost: { generations, creditsApproved: job.options.approveCredits },
      result,
    });
    return job;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'el autopiloto falló';
    log('error', message);
    emit({ status: 'error', error: message });
    return job;
  }
}

function storageOrDefault(storage?: JobStorage): JobStorage | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Private mode or a test environment without storage.
  }
  return null;
}

function validJob(value: unknown): value is OrchestratorJob {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.schema !== ORCHESTRATOR_SCHEMA) return false;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return false;
  if (typeof record.status !== 'string' || typeof record.stage !== 'string') return false;
  if (!record.options || typeof record.options !== 'object') return false;
  const options = record.options as Record<string, unknown>;
  return typeof options.brief === 'string' && typeof options.outputDir === 'string';
}

export function loadOrchestratorJobs(storage?: JobStorage): OrchestratorJob[] {
  const target = storageOrDefault(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(ORCHESTRATOR_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validJob).slice(-50);
  } catch {
    return [];
  }
}

export function saveOrchestratorJobs(jobs: readonly OrchestratorJob[], storage?: JobStorage): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(ORCHESTRATOR_STORAGE_KEY, JSON.stringify(jobs.slice(-50)));
  } catch {
    // A full or unavailable storage must not break an active render.
  }
}

export function upsertOrchestratorJob(
  jobs: readonly OrchestratorJob[],
  job: OrchestratorJob,
): OrchestratorJob[] {
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index < 0) return [...jobs, job].slice(-50);
  const next = [...jobs];
  next[index] = job;
  return next;
}
