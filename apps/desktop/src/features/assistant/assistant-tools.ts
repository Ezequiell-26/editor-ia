/**
 * Registro de herramientas del agente de Olyvia.
 *
 * Cada herramienta declara un JSON Schema que se envía al proveedor
 * OpenAI-compatible, una política de permiso y una ejecución real sobre el
 * proyecto abierto. La UI es la única que muta el documento: este módulo no
 * guarda estado propio ni habla con el proveedor.
 */
import type { Asset, ProjectDocument, Scene } from '@editor-ia/project-schema';
import { THREE_PRESETS } from '../three/scene';
import type {
  FsListing,
  FsRoot,
  FsTextFile,
  MediaAnalysis,
  ObjectTrackRequest,
  ObjectTrackResult,
  PointTrackRequest,
  PointTrackResult,
  RenderFinishedEvent,
  RenderProgressEvent,
  RenderStarted,
} from '../../services/project-service';
import { addAsset } from '../../state/project-actions';
import {
  applyFolderFilm,
  type FolderFilmApplyResult,
} from '../autoedit/apply-folder-film';
import {
  pickNarration,
  planFolderFilm,
  type FolderFilmStyle,
} from '../autoedit/folder-film';
import { maskFromObjectTrack, maskFromPointTrack } from '../vfx/point-mask';
import type { RenderQueueAction } from '../../state/scene-render-queue';
import type { RenderQueueSnapshot } from './render-queue-bridge';
import {
  addCaptionCue,
  addGeneratedNarration,
  addMotionGraphic,
  addClipFromAsset,
  addScene,
  fpsOf,
  newId,
  setClipSpeed,
  splitClip,
  trimClip,
  updateAudioMix,
  updateClip,
  updateProjectLook,
  updateScene,
  magneticMoveClip,
  moveClip,
  updateTrack,
} from '../../state/project-actions';
import {
  ENGINES,
  engineCatalog,
  resolveClip,
  resolveScene,
  type EngineId,
} from '../engine/router';
import { PARALLAX_PRESETS, addParallaxScene, type ParallaxPreset } from '../../state/parallax';
import { RIG_CLIPS, RIG_PALETTES, type RigClipId } from '../rig/rig';
import { planChapterScenes } from './chapter-plan';
import type { PreviewPerfSnapshot } from '../perf/preview-perf';

export interface RigClipCreation {
  readonly assetId: string;
  readonly label: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  /** Clip de animación glTF reproducido, si el modelo lo traía. */
  readonly animation?: { readonly name: string; readonly durationSeconds: number };
  /** Clips de animación disponibles en el modelo. */
  readonly animations?: readonly string[];
}

export interface SceneSegmentResult {
  readonly sceneId: string;
  readonly skipped: boolean;
  readonly outputPath: string;
  readonly bytes: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly jobId?: string;
  readonly profileName?: string;
}

export interface ConcatCreation {
  readonly outputPath: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly segments: number;
}

export interface ImportedAgentAsset {
  readonly id: string;
  readonly label: string;
}

export interface RigClipRequest {
  readonly clip: RigClipId;
  readonly paletteId?: string;
  readonly seconds?: number;
  readonly target?: { readonly x: number; readonly y: number };
}

export type ToolPermission = 'read' | 'ui' | 'edit' | 'export';

/** Sólo ediciones puras del documento; sin servicios, render ni UI. */
const TRANSACTION_TOOLS = new Set([
  'motion_add',
  'motion_path',
  'clip_add',
  'clip_split',
  'effect_apply',
  'transition_apply',
  'subtitle_add',
  'scene_create',
  'scene_resolve',
  'parallax_add',
  'camera_move',
]);

export interface ToolProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly description: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly items?: {
    readonly type: 'string' | 'number' | 'object';
    readonly properties?: Readonly<Record<string, ToolProperty>>;
    readonly required?: readonly string[];
  };
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ToolParameters {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface AssistantToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly permission: ToolPermission;
  readonly parameters: ToolParameters;
  readonly execute: (
    args: Readonly<Record<string, unknown>>,
    host: AssistantToolHost,
  ) => ToolOutcome | Promise<ToolOutcome>;
}

export interface ToolOutcome {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
}

export interface AssistantToolHost {
  readonly project: () => ProjectDocument | null;
  readonly playheadFrame: () => number;
  readonly selection: () => { readonly kind: string; readonly id?: string } | null;
  readonly view: () => string;
  readonly navigate: (view: string) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly save: () => Promise<void>;
  readonly requestExport: () => void;
  readonly mutate: (update: (project: ProjectDocument) => ProjectDocument) => boolean;
  readonly selectClip: (clipId: string) => void;
  readonly openProjectAt: (path: string) => Promise<boolean>;
  readonly importAssetPath: (path: string) => Promise<readonly ImportedAgentAsset[] | null>;
  /** Exploración de archivos del equipo (solo metadatos). */
  readonly fsRoots?: () => Promise<readonly FsRoot[]>;
  readonly fsList?: (path?: string, limit?: number, includeHidden?: boolean) => Promise<FsListing>;
  readonly fsSearch?: (
    root: string | undefined,
    query: string,
    maxDepth?: number,
  ) => Promise<FsListing>;
  readonly fsFindMedia?: (
    kind: 'video' | 'audio' | 'image' | 'all',
    root?: string,
    query?: string,
    limit?: number,
  ) => Promise<FsListing>;
  readonly fsReadText?: (path: string) => Promise<FsTextFile>;
  /** Importa varias rutas de una vez y devuelve los assets (sin montarlos). */
  readonly importAssets?: (paths: readonly string[]) => Promise<readonly Asset[] | null>;
  /** Mide un asset (silencios, escenas) para planificar el montaje. */
  readonly analyzeAsset?: (assetId: string) => Promise<MediaAnalysis>;
  readonly renderRigClip: (request: RigClipRequest) => Promise<RigClipCreation | null>;
  readonly synthesizeNarration?: (text: string, voice?: string) => Promise<Asset | null>;
  readonly perfStats?: () => PreviewPerfSnapshot;
  readonly renderThreeScene: (request: {
    readonly preset: string;
    readonly seconds?: number;
    readonly modelPath?: string;
    readonly animation?: string;
    readonly text?: string;
    readonly textDepth?: number;
  }) => Promise<RigClipCreation | null>;
  readonly renderQueueAdd?: (request: {
    readonly sceneIds: readonly string[];
    readonly includeCaptions: boolean;
    readonly concat?: boolean;
  }) => Promise<{ readonly ids: string[]; readonly snapshot: RenderQueueSnapshot }>;
  readonly renderQueueStatus?: () => RenderQueueSnapshot;
  readonly renderQueueControl?: (
    action: RenderQueueAction,
    id?: string,
  ) => RenderQueueSnapshot;
  readonly renderSceneSegmentChunked?: (request: {
    readonly sceneId: string;
    readonly includeCaptions: boolean;
  }) => Promise<SceneSegmentResult | null>;
  readonly renderSceneSegment: (request: {
    readonly sceneId: string;
    readonly includeCaptions: boolean;
  }) => Promise<SceneSegmentResult | null>;
  readonly concatVideos: (paths: readonly string[]) => Promise<ConcatCreation | null>;
  readonly trackPoint: (request: PointTrackRequest) => Promise<PointTrackResult>;
  readonly trackObject: (request: ObjectTrackRequest) => Promise<ObjectTrackResult>;
  readonly startRender: (
    profileId: string | null,
    includeCaptions: boolean,
  ) => Promise<RenderStarted | null>;
  readonly cancelRender: (jobId: string) => Promise<void>;
  readonly activeRender: () => Promise<string | null>;
  readonly lastRenderEvent: () => {
    readonly progress?: RenderProgressEvent;
    readonly finished?: RenderFinishedEvent;
  } | null;
}

const NAV_VIEWS = [
  'home',
  'projects',
  'script',
  'assets',
  'production',
  'editor',
  'download',
  'director',
  'factory',
  'compliance',
  'convert',
  'compare',
  'compress',
  'denoise',
  'thumbnails',
  'localization',
  'ai-hub',
  'motion',
  'visuals',
  'background',
  'upscale',
  'learn',
  'mcp',
  'settings',
] as const;

const MOTION_TEMPLATES = ['title-card', 'lower-third', 'end-card', 'stat-callout'] as const;

/** Props estables de las cuatro plantillas que el agente puede crear. */
export function assistantMotionProps(
  templateId: string,
  text: string,
  secondary?: string,
): Record<string, unknown> | null {
  if (templateId === 'title-card') {
    return {
      title: text,
      subtitle: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      align: 'left',
      animation: 'slide-up',
    };
  }
  if (templateId === 'lower-third') {
    return {
      name: text,
      role: secondary ?? '',
      accent: '#35d6ff',
      side: 'left',
      animation: 'slide-left',
    };
  }
  if (templateId === 'end-card') {
    return {
      title: text,
      cta: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      animation: 'fade',
    };
  }
  if (templateId === 'stat-callout') {
    return {
      value: text,
      label: secondary ?? '',
      accent: '#35d6ff',
      animation: 'pop',
    };
  }
  return null;
}

/** Valida argumentos contra el subconjunto de JSON Schema que usamos. */
export function validateToolArguments(
  parameters: ToolParameters,
  args: Readonly<Record<string, unknown>>,
): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(args)) {
    if (!(key in parameters.properties)) errors.push(`argumento desconocido: ${key}`);
  }
  for (const key of parameters.required ?? []) {
    if (!(key in args)) errors.push(`falta el argumento obligatorio: ${key}`);
  }
  for (const [key, schema] of Object.entries(parameters.properties)) {
    if (!(key in args)) continue;
    const value = args[key];
    if (value === undefined) continue;
    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${key} debe ser un entero`);
        continue;
      }
    } else if (schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${key} debe ser un número`);
        continue;
      }
    } else if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`${key} debe ser booleano`);
        continue;
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${key} debe ser una lista`);
        continue;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${key} necesita al menos ${schema.minItems} elemento(s)`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${key} admite hasta ${schema.maxItems} elemento(s)`);
      }
      const itemType = schema.items?.type ?? 'string';
      for (const [index, item] of value.entries()) {
        if (itemType === 'object') {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            errors.push(`${key} contiene un elemento que no es objeto`);
            break;
          }
          if (schema.items?.properties) {
            const nested = validateToolArguments(
              {
                type: 'object',
                properties: schema.items.properties,
                ...(schema.items.required ? { required: schema.items.required } : {}),
                additionalProperties: false,
              },
              item as Readonly<Record<string, unknown>>,
            );
            if (nested.length > 0) {
              errors.push(...nested.map((message) => `${key}[${index}]: ${message}`));
              break;
            }
          }
          continue;
        }
        const valid =
          itemType === 'number'
            ? typeof item === 'number' && Number.isFinite(item)
            : typeof item === 'string';
        if (!valid) {
          errors.push(`${key} contiene un elemento que no es ${itemType === 'number' ? 'número' : 'texto'}`);
          break;
        }
      }
      continue;
    } else if (typeof value !== 'string') {
      errors.push(`${key} debe ser texto`);
      continue;
    }
    if (schema.enum && (typeof value !== 'string' || !schema.enum.includes(value))) {
      errors.push(`${key} debe ser uno de: ${schema.enum.join(', ')}`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${key} no puede ser menor que ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${key} no puede ser mayor que ${schema.maximum}`);
      }
    }
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
        errors.push(`${key} es demasiado corto`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${key} supera ${schema.maxLength} caracteres`);
      }
    }
  }
  return errors;
}

function projectOrFail(host: AssistantToolHost): ProjectDocument {
  const project = host.project();
  if (!project) throw new Error('no hay un proyecto abierto');
  return project;
}

function selectedClipId(host: AssistantToolHost): string | null {
  const selection = host.selection();
  return selection?.kind === 'clip' && selection.id ? selection.id : null;
}

function seconds(project: ProjectDocument, frames: number): number {
  const fps = fpsOf(project);
  return fps > 0 ? Math.round((frames / fps) * 1000) / 1000 : 0;
}

function totalFramesOf(project: ProjectDocument): number {
  let end = 0;
  for (const clip of project.timeline.clips) {
    end = Math.max(end, clip.startFrame + clip.durationFrames);
  }
  return end;
}

function addMotion(
  host: AssistantToolHost,
  args: Readonly<Record<string, unknown>>,
): ToolOutcome {
  const project = projectOrFail(host);
  const templateId = String(args.templateId ?? '');
  const text = String(args.text ?? '').trim();
  const secondary =
    typeof args.secondary === 'string' ? args.secondary.trim() : undefined;
  const props = assistantMotionProps(templateId, text, secondary);
  if (!props) return { ok: false, summary: `plantilla desconocida: ${templateId}` };
  let clipId: string | null = null;
  const ok = host.mutate((current) => {
    const added = addMotionGraphic(current, {
      templateId,
      templateVersion: '1.0.0',
      props,
      durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
      atFrame: host.playheadFrame(),
      label: text.slice(0, 80),
    });
    clipId = added.clipId;
    return added.project;
  });
  if (!ok || !clipId) {
    return { ok: false, summary: 'el gráfico no deja el proyecto en un estado válido' };
  }
  host.selectClip(clipId);
  host.navigate('editor');
  return { ok: true, summary: `Gráfico agregado: ${text}`, data: { clipId } };
}

function addClip(
  host: AssistantToolHost,
  args: Readonly<Record<string, unknown>>,
): ToolOutcome {
  const project = projectOrFail(host);
  const assetId = String(args.assetId ?? '');
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) return { ok: false, summary: `no existe el material ${assetId}` };
  if (asset.status !== 'ready') {
    return { ok: false, summary: 'el material todavía no está listo (derechos o análisis)' };
  }
  const atFrame =
    typeof args.atFrame === 'number' ? Math.max(0, Math.round(args.atFrame)) : host.playheadFrame();
  const trackId = typeof args.trackId === 'string' ? args.trackId : undefined;
  let clipId: string | null = null;
  try {
    host.mutate((current) => {
      const ready = current.assets.find((item) => item.id === assetId) as Asset | undefined;
      if (!ready) throw new Error(`no existe el material ${assetId}`);
      const added = addClipFromAsset(current, ready, {
        atFrame,
        ...(trackId ? { trackId } : {}),
      });
      clipId = added.clipId;
      return added.project;
    });
  } catch (cause) {
    return { ok: false, summary: cause instanceof Error ? cause.message : 'no se pudo agregar' };
  }
  if (!clipId) return { ok: false, summary: 'el clip no deja el proyecto en un estado válido' };
  host.selectClip(clipId);
  host.navigate('editor');
  return { ok: true, summary: `Clip agregado desde ${asset.label}`, data: { clipId } };
}

function splitAt(host: AssistantToolHost, args: Readonly<Record<string, unknown>>): ToolOutcome {
  const project = projectOrFail(host);
  const clipId =
    typeof args.clipId === 'string' && args.clipId.trim() ? args.clipId.trim() : selectedClipId(host);
  if (!clipId) return { ok: false, summary: 'elegí un clip o pasá clipId' };
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
  const frame =
    typeof args.frame === 'number' ? Math.round(args.frame) : host.playheadFrame();
  if (frame <= clip.startFrame || frame >= clip.startFrame + clip.durationFrames) {
    return {
      ok: false,
      summary: `el frame ${frame} no cae dentro del clip (${clip.startFrame}–${
        clip.startFrame + clip.durationFrames
      })`,
    };
  }
  let rightClipId: string | null = null;
  try {
    host.mutate((current) => {
      const result = splitClip(current, clipId, frame);
      if (!result) throw new Error('el clip no se puede dividir');
      rightClipId = result.rightClipId;
      return result.project;
    });
  } catch (cause) {
    return { ok: false, summary: cause instanceof Error ? cause.message : 'no se pudo dividir' };
  }
  if (!rightClipId) return { ok: false, summary: 'no se pudo dividir el clip' };
  host.selectClip(rightClipId);
  return { ok: true, summary: `Clip dividido en el frame ${frame}`, data: { rightClipId } };
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  const rounded = Number(value.toFixed(digits));
  return `${String(rounded).replace('.', ',')} ${units[unit]}`;
}

/** Resumen legible y acotado de una carpeta o búsqueda para el modelo. */
function describeListing(listing: FsListing, title?: string): string {
  const head = title ?? (listing.path ? listing.path : 'Raíces del equipo');
  if (listing.entries.length === 0) {
    return `${head}: sin resultados`;
  }
  const shown = listing.entries.slice(0, 40).map((entry) =>
    entry.kind === 'folder'
      ? `[carpeta] ${entry.name}`
      : `${entry.name}${entry.extension ? '' : ' (sin extensión)'} · ${humanBytes(entry.bytes)}`,
  );
  const rest = listing.entries.length - shown.length;
  const truncated = listing.truncated ? ` (hay más de ${listing.total})` : '';
  return `${head}: ${listing.total} entradas${truncated}\n${shown.join('\n')}${
    rest > 0 ? `\n… y ${rest} más` : ''
  }`;
}

export const ASSISTANT_TOOLS: readonly AssistantToolDefinition[] = [
  {
    name: 'project_inspect',
    description:
      'Inspecciona el proyecto abierto: resolución, fps, duración, pistas, clips, materiales, escenas, playhead y selección.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_args, host) => {
      const project = projectOrFail(host);
      const durationFrames = totalFramesOf(project);
      const data = {
        name: project.name,
        width: project.video.width,
        height: project.video.height,
        fps: fpsOf(project),
        durationFrames,
        durationSeconds: seconds(project, durationFrames),
        playheadFrame: host.playheadFrame(),
        playheadSeconds: seconds(project, host.playheadFrame()),
        tracks: project.timeline.tracks.map((track) => ({
          id: track.id,
          kind: track.kind,
          name: track.label,
          clips: project.timeline.clips.filter((clip) => clip.trackId === track.id).length,
        })),
        clips: project.timeline.clips.length,
        assets: project.assets.length,
        scenes: project.scenes.length,
        sequences: project.sequences.map((sequence) => ({
          id: sequence.id,
          order: sequence.order,
          title: sequence.title,
          scenes: project.scenes.filter((scene) => scene.sequenceId === sequence.id).length,
        })),
        sceneList: project.scenes.map((scene) => {
          const clips = scene.clipIds
            .map((id) => project.timeline.clips.find((clip) => clip.id === id))
            .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));
          return {
            id: scene.id,
            title: scene.title,
            intent: scene.intent,
            startFrame: clips.length > 0 ? Math.min(...clips.map((clip) => clip.startFrame)) : 0,
            endFrame:
              clips.length > 0
                ? Math.max(...clips.map((clip) => clip.startFrame + clip.durationFrames))
                : 0,
            clips: clips.length,
            engine: scene.engine ?? null,
            sequenceId: scene.sequenceId ?? null,
          };
        }),
        selection: host.selection(),
        view: host.view(),
      };
      return {
        ok: true,
        summary: `${project.name}: ${data.clips} clips, ${durationFrames} frames a ${data.fps} fps`,
        data,
      };
    },
  },
  {
    name: 'project_open',
    description:
      'Abre un proyecto .editoria.json existente por ruta absoluta y entra al editor. En el puente en vivo la ruta debe estar dentro del workspace permitido.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta absoluta del archivo .editoria.json.', minLength: 3 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const path = String(args.path).trim();
      try {
        const opened = await host.openProjectAt(path);
        if (!opened) return { ok: false, summary: `no se pudo abrir el proyecto: ${path}` };
        return { ok: true, summary: `Proyecto abierto: ${path}`, data: { path } };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo abrir el proyecto',
        };
      }
    },
  },
  {
    name: 'asset_import',
    description:
      'Importa un archivo de imagen, video o audio del disco al proyecto abierto y lo agrega a Medios. En el puente en vivo la ruta debe estar dentro del workspace permitido. No crea el clip; usá clip_add después.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta absoluta del archivo a importar.', minLength: 3 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.project()) return { ok: false, summary: 'abrí un proyecto antes de importar' };
      const path = String(args.path).trim();
      try {
        const assets = await host.importAssetPath(path);
        if (!assets || assets.length === 0) {
          return { ok: false, summary: `no se pudo importar el material: ${path}` };
        }
        return {
          ok: true,
          summary: `Importado: ${assets.map((asset) => asset.label).join(', ')}`,
          data: { assets },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo importar el material',
        };
      }
    },
  },
  {
    name: 'media_find',
    description:
      'Encuentra material multimedia (video, audio o imagen) en una sola pasada y devuelve los archivos más recientes primero, con tamaño y ruta. Usala cuando el usuario pida "buscá videos", "qué audios tengo", "encontrá imágenes" o similar: reemplaza a hacer una búsqueda por extensión. Sin root recorre Descargas, Escritorio, Videos, Documentos, Imágenes y Música.',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['video', 'audio', 'image', 'all'],
          description: 'Tipo de material. Por defecto video.',
        },
        root: {
          type: 'string',
          description:
            'Carpeta donde buscar (por ejemplo la ruta de Descargas de files_roots). Opcional.',
        },
        query: {
          type: 'string',
          description: 'Filtro opcional por texto en el nombre del archivo.',
        },
        limit: { type: 'number', description: 'Máximo de archivos (1-500, por defecto 80).' },
      },
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.fsFindMedia) {
        return { ok: false, summary: 'la exploración de archivos sólo está disponible en la app' };
      }
      const rawKind = typeof args.kind === 'string' ? args.kind : 'video';
      const kind = (
        ['video', 'audio', 'image', 'all'].includes(rawKind) ? rawKind : 'video'
      ) as 'video' | 'audio' | 'image' | 'all';
      const root =
        typeof args.root === 'string' && args.root.trim() ? args.root.trim() : undefined;
      const query =
        typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      try {
        const listing = await host.fsFindMedia(kind, root, query, limit);
        const label =
          kind === 'video'
            ? 'Videos'
            : kind === 'audio'
              ? 'Audios'
              : kind === 'image'
                ? 'Imágenes'
                : 'Material';
        return {
          ok: true,
          summary: describeListing(listing, `${label} encontrados`),
          data: listing,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo buscar material',
        };
      }
    },
  },
  {
    name: 'auto_video_from_folder',
    description:
      'Arma un video completo desde una carpeta: toma las imágenes como planos (con Ken Burns y disolvencias) y el audio de voz como narración, repartiendo cada imagen según las pausas reales del audio. Importa todo a Medios y lo monta en la timeline del proyecto abierto. Usala para "hacé el video con las fotos y la voz de esta carpeta". No exporta.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description:
            'Carpeta con las imágenes y la voz. Suele salir de files_roots o media_find. Si la escribís a mano usá barras normales (D:/ruta/carpeta): las barras invertidas rompen el JSON de argumentos.',
          minLength: 2,
        },
        audio: {
          type: 'string',
          description:
            'Nombre o ruta del audio de narración. Opcional: sin esto se elige el archivo de voz más largo.',
        },
        style: {
          type: 'string',
          enum: ['pulse', 'story', 'impact'],
          description: 'pulse = rápido, story = pausado (por defecto), impact = corto.',
        },
        secondsPerImage: {
          type: 'number',
          description: 'Duración por imagen cuando no hay audio (1-20 s).',
        },
        transitionSeconds: {
          type: 'number',
          description: 'Duración de la disolvencia entre imágenes (0-2 s, por defecto 0,4).',
        },
      },
      required: ['folder'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.fsFindMedia || !host.importAssets) {
        return {
          ok: false,
          summary: 'la creación automática sólo está disponible en la app de escritorio',
        };
      }
      const project = host.project();
      if (!project) {
        return { ok: false, summary: 'abrí o creá un proyecto antes de armar el video' };
      }
      const folder = String(args.folder).trim();
      const style = (
        ['pulse', 'story', 'impact'].includes(String(args.style))
          ? String(args.style)
          : 'story'
      ) as FolderFilmStyle;
      const fps = project.video.frameRate.num / project.video.frameRate.den;
      try {
        const imageListing = await host.fsFindMedia('image', folder, undefined, 200);
        if (imageListing.entries.length === 0) {
          return { ok: false, summary: `no encontré imágenes en ${folder}` };
        }
        const audioListing = await host.fsFindMedia('audio', folder, undefined, 50);
        const wantedAudio =
          typeof args.audio === 'string' && args.audio.trim()
            ? args.audio.trim().toLowerCase()
            : '';
        const audioEntries = audioListing.entries.filter((entry) => {
          if (!wantedAudio) return true;
          return (
            entry.path.toLowerCase() === wantedAudio ||
            entry.name.toLowerCase().includes(wantedAudio)
          );
        });
        const imagePaths = imageListing.entries.map((entry) => entry.path);
        const audioPaths = audioEntries.map((entry) => entry.path);
        const imported = await host.importAssets([...imagePaths, ...audioPaths]);
        if (!imported || imported.length === 0) {
          return { ok: false, summary: 'no se pudieron importar los archivos de la carpeta' };
        }
        const imageAssets = imported.filter((asset) => asset.kind === 'image');
        if (imageAssets.length === 0) {
          return { ok: false, summary: 'los archivos no quedaron como imágenes válidas' };
        }
        const audioAssets = imported.filter((asset) => asset.kind === 'audio');

        const voiceCandidate = pickNarration(
          audioAssets.map((asset) => ({
            asset,
            label: asset.label,
            durationFrames:
              asset.media && 'durationFrames' in asset.media
                ? asset.media.durationFrames
                : 0,
          })),
        );
        let silences: { startSeconds: number; endSeconds: number }[] = [];
        let audioFrames = voiceCandidate?.durationFrames ?? 0;
        if (voiceCandidate && host.analyzeAsset) {
          try {
            const analysis = await host.analyzeAsset(voiceCandidate.asset.id);
            silences = analysis.silences.map((range) => ({
              startSeconds: range.startSeconds,
              endSeconds: range.endSeconds,
            }));
            if (audioFrames <= 0) {
              audioFrames = Math.max(1, Math.round(analysis.durationSeconds * fps));
            }
          } catch {
            // Sin análisis se reparte en partes iguales; no es bloqueante.
          }
        }

        const transitionSeconds =
          typeof args.transitionSeconds === 'number' ? args.transitionSeconds : undefined;
        const plan = planFolderFilm({
          images: imageAssets.map((asset) => ({ assetId: asset.id, label: asset.label })),
          audio: voiceCandidate
            ? { assetId: voiceCandidate.asset.id, durationFrames: audioFrames }
            : null,
          silences,
          fps,
          style,
          ...(typeof args.secondsPerImage === 'number'
            ? { secondsPerImage: args.secondsPerImage }
            : {}),
          ...(transitionSeconds != null
            ? { transitionFrames: Math.round(transitionSeconds * fps) }
            : {}),
        });
        if (plan.slides.length === 0) {
          return { ok: false, summary: 'el plan quedó vacío; revisá las imágenes' };
        }

        const assetsById = new Map(imported.map((asset) => [asset.id, asset]));
        let clipIds: readonly string[] = [];
        let audioClipId: string | null = null;
        const changed = host.mutate((current) => {
          let next = imageAssets.reduce((projectSoFar, asset) => addAsset(projectSoFar, asset), current);
          next = audioAssets.reduce((projectSoFar, asset) => addAsset(projectSoFar, asset), next);
          const applied: FolderFilmApplyResult = applyFolderFilm(next, plan, assetsById);
          clipIds = applied.clipIds;
          audioClipId = applied.audioClipId;
          return applied.project;
        });
        if (!changed) {
          return { ok: false, summary: 'no se pudo aplicar el montaje al proyecto' };
        }
        const seconds = (plan.totalFrames / fps).toFixed(1).replace('.', ',');
        const basis =
          plan.basis === 'silences'
            ? 'cortado en las pausas de la voz'
            : plan.basis === 'uniform-audio'
              ? 'repartido sobre la narración'
              : 'sin narración';
        return {
          ok: true,
          summary: `Video armado: ${clipIds.length} imágenes · ${seconds} s · ${basis}${
            audioClipId ? ' · voz montada en la pista de narración' : ''
          }`,
          data: {
            clipIds,
            audioClipId,
            totalFrames: plan.totalFrames,
            seconds: Number(seconds.replace(',', '.')),
            basis: plan.basis,
            images: imageAssets.length,
            audio: voiceCandidate?.label ?? null,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary:
            cause instanceof Error ? cause.message : 'no se pudo armar el video desde la carpeta',
        };
      }
    },
  },
  {
    name: 'files_roots',
    description:
      'Lista los puntos de partida del equipo (carpeta personal, Escritorio, Descargas, Documentos, Videos, Imágenes, Música y unidades). Usalo antes de files_list/files_search cuando no sabés en qué ruta está el material.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, host) => {
      if (!host.fsRoots) {
        return { ok: false, summary: 'la exploración de archivos sólo está disponible en la app' };
      }
      const roots = await host.fsRoots();
      return {
        ok: true,
        summary: roots.map((root) => `${root.label}: ${root.path}`).join(' · '),
        data: { roots },
      };
    },
  },
  {
    name: 'files_list',
    description:
      'Lista el contenido de una carpeta del equipo (solo metadatos: nombre, tipo, tamaño). Sin ruta devuelve las raíces conocidas. Las carpetas ocultas (que empiezan con punto) no se muestran salvo includeHidden. Si el usuario nombra una carpeta habitual (Descargas, Escritorio, Documentos, Videos), tomá su ruta exacta de files_roots.',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Ruta absoluta de la carpeta. Omitila para ver las raíces conocidas.',
        },
        limit: { type: 'number', description: 'Máximo de entradas (1-2000, por defecto 300).' },
        includeHidden: {
          type: 'boolean',
          description: 'Incluir carpetas y archivos ocultos (empiezan con punto). Por defecto, no.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.fsList) {
        return { ok: false, summary: 'la exploración de archivos sólo está disponible en la app' };
      }
      const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const includeHidden = args.includeHidden === true;
      try {
        const listing = await host.fsList(path, limit, includeHidden);
        return {
          ok: true,
          summary: describeListing(listing),
          data: listing,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo listar la carpeta',
        };
      }
    },
  },
  {
    name: 'files_search',
    description:
      'Busca archivos y carpetas por nombre (sin distinguir mayúsculas) o por extensión. Acepta query "*.mp4" o ".mov" para filtrar por tipo. Si omitís root recorre Descargas, Escritorio, Videos y Documentos: es el camino más corto para "buscá videos en Descargas". Ignora node_modules, .git, Windows, AppData y la papelera. Devuelve solo metadatos.',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Texto del nombre o extensión ("*.mp4", ".srt"). Obligatorio.',
          minLength: 1,
        },
        root: {
          type: 'string',
          description:
            'Carpeta donde empezar. Opcional: sin root se buscan Descargas, Escritorio, Videos y Documentos.',
        },
        maxDepth: { type: 'number', description: 'Profundidad máxima (1-6, por defecto 3).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.fsSearch) {
        return { ok: false, summary: 'la exploración de archivos sólo está disponible en la app' };
      }
      const query = String(args.query).trim();
      const root =
        typeof args.root === 'string' && args.root.trim() ? args.root.trim() : undefined;
      const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : undefined;
      try {
        const listing = await host.fsSearch(root, query, maxDepth);
        return {
          ok: true,
          summary: describeListing(listing, `Búsqueda "${query}"`),
          data: listing,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo buscar',
        };
      }
    },
  },
  {
    name: 'files_read_text',
    description:
      'Lee un archivo de texto pequeño (máximo 256 KB) de una lista blanca: .txt, .md, .srt, .vtt, .csv, .json, .log, .cube, .xml, .yaml, .ini. Sirve para guiones, subtítulos o configuraciones. No lee binarios ni videos.',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta absoluta del archivo de texto.', minLength: 3 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (!host.fsReadText) {
        return { ok: false, summary: 'la lectura de archivos sólo está disponible en la app' };
      }
      const path = String(args.path).trim();
      try {
        const file = await host.fsReadText(path);
        const preview = file.text.slice(0, 4_000);
        return {
          ok: true,
          summary: `${file.path} · ${humanBytes(file.bytes)}${file.truncated ? ' (recortado)' : ''}\n${preview}`,
          data: { path: file.path, bytes: file.bytes, truncated: file.truncated, preview },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo leer el archivo',
        };
      }
    },
  },
  {
    name: 'perf_stats',
    description:
      'Devuelve FPS reales de la preview en WebView2, frames caídos, fps objetivo y memoria JS mientras se reproduce.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_args, host) => {
      if (!host.perfStats) {
        return { ok: false, summary: 'la medición de preview sólo está disponible en la app' };
      }
      const stats = host.perfStats();
      if (!stats.active) {
        return { ok: true, summary: 'sin reproducción activa; dale play y volvé a medir', data: stats };
      }
      return {
        ok: true,
        summary: `${stats.fps} fps reales (objetivo ${stats.targetFps}) · ${stats.dropped} caídos${
          stats.heapMb != null ? ` · ${stats.heapMb} MB JS` : ''
        }`,
        data: stats,
      };
    },
  },
  {
    name: 'navigate',
    description: 'Abre una vista de la aplicación.',
    permission: 'ui',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', description: 'Vista destino.', enum: NAV_VIEWS },
      },
      required: ['view'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const view = String(args.view);
      host.navigate(view);
      return { ok: true, summary: `Vista abierta: ${view}`, data: { view } };
    },
  },
  {
    name: 'transport',
    description: 'Controla la reproducción y el guardado del proyecto.',
    permission: 'ui',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Acción de transporte.',
          enum: ['play', 'pause', 'save', 'undo', 'redo'],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const action = String(args.action);
      if (action === 'play') host.setPlaying(true);
      else if (action === 'pause') host.setPlaying(false);
      else if (action === 'save') await host.save();
      else if (action === 'undo') host.undo();
      else if (action === 'redo') host.redo();
      return { ok: true, summary: `Transporte: ${action}`, data: { action } };
    },
  },
  {
    name: 'motion_add',
    description:
      'Agrega un gráfico animado en el playhead y lo selecciona. Plantillas: title-card, lower-third, end-card, stat-callout.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'Plantilla de motion graphics.',
          enum: MOTION_TEMPLATES,
        },
        text: { type: 'string', description: 'Texto principal.', minLength: 1, maxLength: 200 },
        secondary: {
          type: 'string',
          description: 'Texto secundario opcional.',
          maxLength: 200,
        },
      },
      required: ['templateId', 'text'],
      additionalProperties: false,
    },
    execute: (args, host) => addMotion(host, args),
  },
  {
    name: 'clip_add',
    description:
      'Agrega un material ya importado al timeline en un frame (por defecto el playhead) y lo selecciona.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'ID del material importado.', minLength: 1 },
        trackId: { type: 'string', description: 'Pista destino opcional.', minLength: 1 },
        atFrame: {
          type: 'integer',
          description: 'Frame de inicio (por defecto el playhead).',
          minimum: 0,
        },
      },
      required: ['assetId'],
      additionalProperties: false,
    },
    execute: (args, host) => addClip(host, args),
  },
  {
    name: 'clip_split',
    description:
      'Divide un clip en un frame. Si no se indica clipId usa el clip seleccionado; si no se indica frame usa el playhead.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip a dividir (por defecto el seleccionado).', minLength: 1 },
        frame: { type: 'integer', description: 'Frame de corte (por defecto el playhead).', minimum: 0 },
      },
      additionalProperties: false,
    },
    execute: (args, host) => splitAt(host, args),
  },
  {
    name: 'export_open',
    description:
      'Abre el diálogo de exportación del proyecto. No renderiza sin confirmación del usuario.',
    permission: 'export',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_args, host) => {
      projectOrFail(host);
      host.requestExport();
      return { ok: true, summary: 'Diálogo de exportación abierto' };
    },
  },
  {
    name: 'engine_catalog',
    description:
      'Lista los motores audiovisuales con su estado real (available, partial, planned) y qué tipos de clip soportan.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({
      ok: true,
      summary: `${engineCatalog().length} motores registrados`,
      data: { engines: engineCatalog() },
    }),
  },
  {
    name: 'scene_resolve',
    description:
      'Decide con qué motor disponible resolver una escena o un clip. Si se pide un motor no implementado (parallax, 3D, tracking de objetos) devuelve blocked con la razón. Con `pin` persiste el motor elegido en la escena.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Escena a resolver.', minLength: 1 },
        clipId: { type: 'string', description: 'Clip a resolver (alternativa a sceneId).', minLength: 1 },
        request: {
          type: 'string',
          description: 'Motor pedido; sin esto el router decide automáticamente.',
          enum: ENGINES.map((engine) => engine.id),
        },
        pin: {
          type: 'boolean',
          description: 'Guardar el motor resuelto en la escena (requiere sceneId).',
        },
      },
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const sceneId = typeof args.sceneId === 'string' ? args.sceneId.trim() : '';
      const clipId = typeof args.clipId === 'string' ? args.clipId.trim() : '';
      if (Boolean(sceneId) === Boolean(clipId)) {
        return { ok: false, summary: 'pasá sceneId o clipId (uno solo)' };
      }
      if (args.pin === true && !sceneId) {
        return { ok: false, summary: 'pin requiere sceneId' };
      }
      const request =
        typeof args.request === 'string' ? (args.request as EngineId) : undefined;
      try {
        const resolution = sceneId
          ? resolveScene(project, sceneId, request ? { request } : {})
          : resolveClip(project, clipId, request ? { request } : {});
        let pinned = false;
        if (args.pin === true && sceneId && resolution.engine) {
          const updated = host.mutate((current) => ({
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.id === sceneId
                ? { ...scene, engine: resolution.engine as Scene['engine'] }
                : scene,
            ),
          }));
          if (!updated) {
            return { ok: false, summary: 'el motor no deja la escena en un estado válido' };
          }
          pinned = true;
        }
        return {
          ok: resolution.status !== 'blocked',
          summary: `${resolution.status}: ${resolution.engine ?? 'sin motor'}${
            pinned ? ' · fijado' : ''
          }`,
          data: { ...resolution, pinned },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo resolver',
        };
      }
    },
  },
  {
    name: 'three_add',
    description:
      'Hornea una escena 3D de Three.js a MP4 y la importa a Medios. Con `preset` usa cubo orbital, toroide dolly, esfera de estudio o vuelo sobre grilla; con `modelPath` carga un modelo glTF/GLB local y lo encuadra sobre el piso con la iluminación/cámara del preset. No la monta en el timeline; usá clip_add después.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          description: 'Escena 3D (por defecto orbit-cube si se importa un modelo).',
          enum: THREE_PRESETS.map((preset) => preset.id),
        },
        modelPath: {
          type: 'string',
          description: 'Ruta local a un modelo glTF/GLB (en vivo debe estar dentro del workspace).',
          minLength: 1,
          maxLength: 1024,
        },
        animation: {
          type: 'string',
          description: 'Nombre o índice del clip de animación del modelo; sin esto usa el primero.',
          minLength: 1,
          maxLength: 120,
        },
        text: {
          type: 'string',
          description: 'Rótulo 3D sobre la escena (hasta 120 caracteres).',
          minLength: 1,
          maxLength: 120,
        },
        textDepth: {
          type: 'number',
          description:
            'Con `text`: profundidad de extrusión (0,02–0,6 unidades). Sin esto el rótulo es un sprite plano.',
          minimum: 0.02,
          maximum: 0.6,
        },
        seconds: {
          type: 'number',
          description: 'Duración (1–10 s; por defecto 4).',
          minimum: 1,
          maximum: 10,
        },
      },
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const preset = typeof args.preset === 'string' ? args.preset : '';
      const modelPath = typeof args.modelPath === 'string' ? args.modelPath.trim() : '';
      if (!preset && !modelPath) {
        return { ok: false, summary: 'pasá un preset o un modelPath glTF/GLB' };
      }
      const textDepth = typeof args.textDepth === 'number' ? args.textDepth : 0;
      if (textDepth > 0 && !(typeof args.text === 'string' && args.text.trim())) {
        return { ok: false, summary: 'textDepth necesita un `text` para extruir' };
      }
      try {
        const result = await host.renderThreeScene({
          preset: preset || 'orbit-cube',
          ...(typeof args.seconds === 'number' ? { seconds: args.seconds } : {}),
          ...(modelPath ? { modelPath } : {}),
          ...(typeof args.animation === 'string' && args.animation.trim()
            ? { animation: args.animation.trim() }
            : {}),
          ...(typeof args.text === 'string' && args.text.trim()
            ? { text: args.text.trim() }
            : {}),
          ...(textDepth > 0 ? { textDepth } : {}),
        });
        if (!result) return { ok: false, summary: 'no se pudo hornear la escena 3D' };
        return {
          ok: true,
          summary: `Escena 3D${
            typeof args.text === 'string' && args.text.trim()
              ? ` con rótulo “${args.text.trim()}”`
              : ''
          } importada a Medios: ${result.label} (${result.bytes} B)`,
          data: result,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo hornear la escena 3D',
        };
      }
    },
  },
  {
    name: 'camera_move',
    description:
      'Aplica movimiento de cámara (Ken Burns) a un clip visual: zoom in/out o paneo. Reemplaza el movimiento anterior del clip.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip visual (por defecto el seleccionado).', minLength: 1 },
        type: {
          type: 'string',
          description: 'Movimiento.',
          enum: ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'],
        },
        intensity: {
          type: 'number',
          description: 'Intensidad (0,02–0,5; por defecto 0,12).',
          minimum: 0.02,
          maximum: 0.5,
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip visual o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind === 'audio') return { ok: false, summary: 'camera_move sólo aplica a clips visuales' };
      const motion = {
        type: String(args.type) as 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down',
        ...(typeof args.intensity === 'number' ? { intensity: args.intensity } : {}),
      };
      const updated = host.mutate((current) => updateClip(current, clipId, { motion }));
      if (!updated) return { ok: false, summary: 'el movimiento no deja el proyecto válido' };
      return {
        ok: true,
        summary: `Cámara ${motion.type} aplicada a ${clip.label ?? clipId}`,
        data: { clipId, motion },
      };
    },
  },
  {
    name: 'effect_apply',
    description:
      'Aplica ajustes visuales a un clip (brillo, contraste, saturación, temperatura, grano, curva, gris o sepia), conservando los efectos existentes.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip visual (por defecto el seleccionado).', minLength: 1 },
        brightness: { type: 'number', description: 'Brillo (-1..1).', minimum: -1, maximum: 1 },
        contrast: { type: 'number', description: 'Contraste (0..3).', minimum: 0, maximum: 3 },
        saturation: { type: 'number', description: 'Saturación (0..3).', minimum: 0, maximum: 3 },
        temperature: { type: 'number', description: 'Temperatura (-1..1).', minimum: -1, maximum: 1 },
        grain: { type: 'number', description: 'Grano (0..1).', minimum: 0, maximum: 1 },
        grayscale: { type: 'boolean', description: 'Blanco y negro.' },
        sepia: { type: 'boolean', description: 'Sepia.' },
        curvePreset: {
          type: 'string',
          description: 'Curva de contraste.',
          enum: [
            'contrast-soft',
            'contrast-medium',
            'contrast-strong',
            'vintage',
            'cross-process',
            'darker',
            'lighter',
          ],
        },
      },
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip visual o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind === 'audio') return { ok: false, summary: 'effect_apply sólo aplica a clips visuales' };
      const effects: Record<string, unknown> = {
        ...(('effects' in clip && clip.effects ? clip.effects : {}) as Record<string, unknown>),
      };
      for (const key of ['brightness', 'contrast', 'saturation', 'temperature', 'grain'] as const) {
        if (typeof args[key] === 'number') effects[key] = args[key];
      }
      for (const key of ['grayscale', 'sepia'] as const) {
        if (typeof args[key] === 'boolean') effects[key] = args[key];
      }
      if (typeof args.curvePreset === 'string') effects.curvePreset = args.curvePreset;
      if (Object.keys(effects).length === 0) {
        return { ok: false, summary: 'pasá al menos un ajuste para aplicar' };
      }
      const updated = host.mutate((current) =>
        updateClip(current, clipId, { effects: effects as never }),
      );
      if (!updated) return { ok: false, summary: 'los efectos no dejan el proyecto válidos' };
      return {
        ok: true,
        summary: `Efectos aplicados a ${clip.label ?? clipId}: ${Object.keys(effects).join(', ')}`,
        data: { clipId, effects },
      };
    },
  },
  {
    name: 'transition_apply',
    description: 'Aplica una transición de entrada a un clip visual (12 tipos, frames configurables).',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip visual (por defecto el seleccionado).', minLength: 1 },
        type: {
          type: 'string',
          description: 'Transición.',
          enum: [
            'dissolve',
            'fade-black',
            'fade-white',
            'slide-left',
            'slide-right',
            'slide-up',
            'slide-down',
            'wipe-left',
            'wipe-right',
            'wipe-up',
            'wipe-down',
            'iris',
          ],
        },
        frames: { type: 'integer', description: 'Duración en frames (por defecto 12).', minimum: 1, maximum: 120 },
      },
      required: ['type'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip visual o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind === 'audio') return { ok: false, summary: 'transition_apply sólo aplica a clips visuales' };
      const transition = {
        type: String(args.type),
        frames: typeof args.frames === 'number' ? args.frames : 12,
      };
      const updated = host.mutate((current) =>
        updateClip(current, clipId, { transitionIn: transition as never }),
      );
      if (!updated) return { ok: false, summary: 'la transición no deja el proyecto válido' };
      return {
        ok: true,
        summary: `Transición ${transition.type} (${transition.frames} frames) en ${clip.label ?? clipId}`,
        data: { clipId, transition },
      };
    },
  },
  {
    name: 'subtitle_add',
    description:
      'Agrega un subtítulo/cue al proyecto con texto y tiempos; crea la pista de subtítulos si hace falta.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto del subtítulo.', minLength: 1, maxLength: 500 },
        startFrame: { type: 'integer', description: 'Frame inicial (por defecto el playhead).', minimum: 0 },
        durationFrames: {
          type: 'integer',
          description: 'Duración en frames (por defecto 3 s).',
          minimum: 1,
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      try {
        const result = addCaptionCue(project, {
          text: String(args.text),
          ...(typeof args.startFrame === 'number' ? { startFrame: args.startFrame } : {}),
          ...(typeof args.durationFrames === 'number'
            ? { durationFrames: args.durationFrames }
            : {}),
        });
        const ok = host.mutate(() => result.project);
        if (!ok) return { ok: false, summary: 'el subtítulo no deja el proyecto válido' };
        return {
          ok: true,
          summary: `Subtítulo agregado en el frame ${result.startFrame}`,
          data: { cueId: result.cueId, trackId: result.trackId, startFrame: result.startFrame },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo agregar el subtítulo',
        };
      }
    },
  },
  {
    name: 'scene_create',
    description:
      'Crea una escena del proyecto con título, intención y narración; podés asociarle clips. Para producción larga el orden de escenas es el orden de creación.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título de la escena.', minLength: 1, maxLength: 200 },
        narration: { type: 'string', description: 'Narración/descripción.', minLength: 1, maxLength: 4000 },
        intent: {
          type: 'string',
          description: 'Intención narrativa.',
          enum: ['hook', 'context', 'explainer', 'demo', 'proof', 'cta', 'outro'],
        },
        clipIds: {
          type: 'array',
          description: 'Clips que pertenecen a la escena.',
          items: { type: 'string' },
          minItems: 0,
          maxItems: 50,
        },
        engine: {
          type: 'string',
          description: 'Fija el motor del router para esta escena.',
          enum: ENGINES.map((engine) => engine.id),
        },
      },
      required: ['title', 'narration'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipIds = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
      const missing = clipIds.filter(
        (id) => !project.timeline.clips.some((clip) => clip.id === id),
      );
      if (missing.length > 0) {
        return { ok: false, summary: `clips inexistentes: ${missing.join(', ')}` };
      }
      try {
        const result = addScene(project, {
          title: String(args.title),
          intent: (typeof args.intent === 'string' ? args.intent : 'demo') as Parameters<
            typeof addScene
          >[1]['intent'],
          narration: String(args.narration),
          ...(typeof args.engine === 'string'
            ? { engine: args.engine as Scene['engine'] }
            : {}),
        });
        const next =
          clipIds.length > 0
            ? {
                ...result.project,
                scenes: result.project.scenes.map((scene) =>
                  scene.id === result.sceneId ? { ...scene, clipIds } : scene,
                ),
              }
            : result.project;
        const ok = host.mutate(() => next);
        if (!ok) return { ok: false, summary: 'la escena no deja el proyecto válida' };
        return {
          ok: true,
          summary: `Escena “${String(args.title)}” creada con ${clipIds.length} clip(s)`,
          data: { sceneId: result.sceneId, clips: clipIds.length },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo crear la escena',
        };
      }
    },
  },
  {
    name: 'scene_update',
    description:
      'Edita una escena existente: título, narración, intención, estado, notas, motor (auto para quitarlo) y clips asociados. Valida que los clips existan y deja un solo undo.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Escena a editar.', minLength: 1 },
        title: { type: 'string', description: 'Nuevo título.', minLength: 1, maxLength: 200 },
        narration: { type: 'string', description: 'Nueva narración.', minLength: 1, maxLength: 4_000 },
        intent: {
          type: 'string',
          description: 'Intención narrativa.',
          enum: ['hook', 'context', 'explainer', 'demo', 'proof', 'cta', 'outro'],
        },
        status: { type: 'string', description: 'Estado de revisión.', enum: ['draft', 'reviewed', 'approved'] },
        notes: { type: 'string', description: 'Notas visuales.', maxLength: 2_000 },
        engine: {
          type: 'string',
          description: 'Motor del router; “auto” lo quita.',
          enum: [...ENGINES.map((engine) => engine.id), 'auto'],
        },
        clipIds: {
          type: 'array',
          description: 'Reemplaza los clips de la escena (0–50).',
          items: { type: 'string' },
          maxItems: 50,
        },
      },
      required: ['sceneId'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const sceneId = String(args.sceneId);
      const scene = project.scenes.find((item) => item.id === sceneId);
      if (!scene) return { ok: false, summary: `escena inexistente: ${sceneId}` };
      const clipIds = Array.isArray(args.clipIds)
        ? [...new Set(args.clipIds.map((id) => String(id)))]
        : undefined;
      const engine =
        typeof args.engine === 'string'
          ? args.engine === 'auto'
            ? null
            : (args.engine as Scene['engine'])
          : undefined;
      const patch = {
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
        ...(typeof args.narration === 'string' ? { narration: args.narration } : {}),
        ...(typeof args.intent === 'string'
          ? { intent: args.intent as Scene['intent'] }
          : {}),
        ...(typeof args.status === 'string'
          ? { status: args.status as Scene['status'] }
          : {}),
        ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
        ...(engine !== undefined ? { engine } : {}),
        ...(clipIds !== undefined ? { clipIds } : {}),
      };
      if (Object.keys(patch).length === 0) {
        return { ok: false, summary: 'indicá al menos un campo para editar' };
      }
      try {
        const ok = host.mutate((current) => updateScene(current, sceneId, patch));
        if (!ok) return { ok: false, summary: 'la edición de la escena no deja el proyecto válido' };
        return {
          ok: true,
          summary: `Escena “${patch.title ?? scene.title}” actualizada`,
          data: { sceneId, fields: Object.keys(patch) },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo editar la escena',
        };
      }
    },
  },
  {
    name: 'chapter_plan',
    description:
      'Planifica producción larga: parte un guion en capítulos (encabezados “#” o “Capítulo N”) y escenas con narración, reparte los clips existentes en orden y crea todas las escenas en una sola mutación. Requiere al menos un clip.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        narration: {
          type: 'string',
          description: 'Guion completo con párrafos y, opcionalmente, encabezados de capítulo.',
          minLength: 1,
          maxLength: 20_000,
        },
        clipIds: {
          type: 'array',
          description: 'Clips existentes que se reparten entre las escenas en round-robin.',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
        },
        maxWords: {
          type: 'integer',
          description: 'Palabras máximas por escena (20–160, por defecto 60).',
          minimum: 20,
          maximum: 160,
        },
        engine: {
          type: 'string',
          description: 'Fija el motor del router para todas las escenas.',
          enum: ENGINES.map((engine) => engine.id),
        },
      },
      required: ['narration', 'clipIds'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipIds = [
        ...new Set((Array.isArray(args.clipIds) ? args.clipIds : []).map((id) => String(id).trim())),
      ].filter(Boolean);
      if (clipIds.length === 0) return { ok: false, summary: 'indicá al menos un clip existente' };
      const missing = clipIds.filter(
        (id) => !project.timeline.clips.some((clip) => clip.id === id),
      );
      if (missing.length > 0) {
        return { ok: false, summary: `clips inexistentes: ${missing.join(', ')}` };
      }
      const plan = planChapterScenes(
        String(args.narration),
        clipIds,
        typeof args.maxWords === 'number' ? args.maxWords : 60,
      );
      if (plan.length === 0) {
        return { ok: false, summary: 'el guion no produjo escenas con texto' };
      }
      if (plan.length > 60) {
        return {
          ok: false,
          summary: `el plan generaría ${plan.length} escenas; subí maxWords o acortá el guion (máximo 60)`,
        };
      }
      try {
        const chapterTitles = [...new Set(plan.map((item) => item.chapter))];
        const nextOrder = Math.max(-1, ...project.sequences.map((sequence) => sequence.order)) + 1;
        const sequences = chapterTitles.map((title, index) => ({
          id: newId(),
          order: nextOrder + index,
          title,
        }));
        const sequenceByChapter = new Map(sequences.map((sequence) => [sequence.title, sequence.id]));
        let next = { ...project, sequences: [...project.sequences, ...sequences] };
        const scenes: { sceneId: string; chapter: string; title: string }[] = [];
        for (const item of plan) {
          const created = addScene(next, {
            title: item.title,
            intent: item.intent,
            narration: item.narration,
            notes: item.notes,
            ...(typeof args.engine === 'string'
              ? { engine: args.engine as Scene['engine'] }
              : {}),
          });
          next = {
            ...created.project,
            scenes: created.project.scenes.map((scene) =>
              scene.id === created.sceneId
                ? {
                    ...scene,
                    clipIds: [item.clipId],
                    sequenceId: sequenceByChapter.get(item.chapter),
                  }
                : scene,
            ),
          };
          scenes.push({ sceneId: created.sceneId, chapter: item.chapter, title: item.title });
        }
        const ok = host.mutate(() => next);
        if (!ok) return { ok: false, summary: 'el plan no deja el proyecto válido' };
        return {
          ok: true,
          summary: `Plan creado: ${sequences.length} capítulo(s), ${plan.length} escena(s)`,
          data: {
            chapters: sequences.map((sequence) => ({ id: sequence.id, title: sequence.title })),
            scenes,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo planificar la producción',
        };
      }
    },
  },
  {
    name: 'narrate_scenes',
    description:
      'Sintetiza voz SAPI para varias escenas, agrega cada audio a Medios, lo vincula a su escena y lo coloca en la pista de narración al inicio de los clips de la escena. Requiere confirmRights explícito.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        sceneIds: {
          type: 'array',
          description: 'Escenas a narrar (1–20). Deben tener texto y al menos un clip.',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 20,
        },
        voice: {
          type: 'string',
          description: 'Identificador de voz SAPI; sin esto usa la voz por defecto del sistema.',
          minLength: 1,
          maxLength: 120,
        },
        confirmRights: {
          type: 'boolean',
          description: 'Debe ser true: confirma que el usuario tiene derechos sobre el texto y la voz.',
        },
      },
      required: ['sceneIds', 'confirmRights'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      if (args.confirmRights !== true) {
        return {
          ok: false,
          summary: 'confirmá los derechos del texto y la voz con confirmRights:true',
        };
      }
      if (!host.synthesizeNarration) {
        return { ok: false, summary: 'la síntesis de voz sólo está disponible en la app' };
      }
      const project = projectOrFail(host);
      const sceneIds = [
        ...new Set((Array.isArray(args.sceneIds) ? args.sceneIds : []).map((id) => String(id))),
      ].filter(Boolean);
      if (sceneIds.length === 0 || sceneIds.length > 20) {
        return { ok: false, summary: 'pasá entre 1 y 20 escenas' };
      }
      const missing = sceneIds.filter((id) => !project.scenes.some((scene) => scene.id === id));
      if (missing.length > 0) {
        return { ok: false, summary: `escenas inexistentes: ${missing.join(', ')}` };
      }
      const voice = typeof args.voice === 'string' ? args.voice.trim() : '';
      const jobs: { sceneId: string; title: string; text: string; atFrame: number }[] = [];
      const skipped: { sceneId: string; reason: string }[] = [];
      for (const sceneId of sceneIds) {
        const scene = project.scenes.find((item) => item.id === sceneId)!;
        const text = scene.narration.text?.trim() ?? '';
        if (!text) {
          skipped.push({ sceneId, reason: 'sin texto' });
          continue;
        }
        const clips = scene.clipIds
          .map((id) => project.timeline.clips.find((clip) => clip.id === id))
          .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));
        if (clips.length === 0) {
          skipped.push({ sceneId, reason: 'sin clips para ubicar el audio' });
          continue;
        }
        jobs.push({
          sceneId,
          title: scene.title,
          text,
          atFrame: Math.min(...clips.map((clip) => clip.startFrame)),
        });
      }
      if (jobs.length === 0) {
        return {
          ok: false,
          summary: `no hay escenas narrables: ${skipped.map((item) => item.reason).join(', ')}`,
        };
      }
      const synthesized: { sceneId: string; title: string; asset: Asset; atFrame: number }[] = [];
      for (const job of jobs) {
        const asset = await host.synthesizeNarration(job.text, voice || undefined);
        if (!asset) {
          return { ok: false, summary: `no se pudo sintetizar la voz de “${job.title}”` };
        }
        synthesized.push({ ...job, asset });
      }
      const created: { sceneId: string; assetId: string; clipId: string | null; voice: string }[] = [];
      const ok = host.mutate((current) => {
        let next = current;
        for (const item of synthesized) {
          const result = addGeneratedNarration(next, item.asset, item.sceneId, {
            confirmRights: true,
            atFrame: item.atFrame,
            label: `Narración · ${item.title}`,
          });
          next = result.project;
          created.push({
            sceneId: item.sceneId,
            assetId: item.asset.id,
            clipId: result.clipId,
            voice: voice || 'sistema',
          });
        }
        return next;
      });
      if (!ok) return { ok: false, summary: 'la narración no deja el proyecto válido' };
      return {
        ok: true,
        summary: `Narración generada para ${created.length} escena(s)${
          skipped.length > 0 ? `; ${skipped.length} omitida(s)` : ''
        }`,
        data: { narrations: created, skipped },
      };
    },
  },
  {
    name: 'project_look',
    description:
      'Aplica un look global al compuesto (todo el proyecto): brillo, contraste, saturación, temperatura, sombras, altas luces, fade, viñeta, grano, nitidez, denoise, blur, hue, LUT, gris o sepia. Con clear:true lo quita.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        brightness: { type: 'number', description: 'Brillo (-1–1).', minimum: -1, maximum: 1 },
        contrast: { type: 'number', description: 'Contraste (0–3).', minimum: 0, maximum: 3 },
        saturation: { type: 'number', description: 'Saturación (0–3).', minimum: 0, maximum: 3 },
        temperature: { type: 'number', description: 'Temperatura (-1 frío … 1 cálido).', minimum: -1, maximum: 1 },
        shadows: { type: 'number', description: 'Sombras (-1–1).', minimum: -1, maximum: 1 },
        highlights: { type: 'number', description: 'Altas luces (-1–1).', minimum: -1, maximum: 1 },
        fade: { type: 'number', description: 'Fade (0–1).', minimum: 0, maximum: 1 },
        vignette: { type: 'number', description: 'Viñeta (0–1).', minimum: 0, maximum: 1 },
        grain: { type: 'number', description: 'Grano (0–1).', minimum: 0, maximum: 1 },
        sharpen: { type: 'number', description: 'Nitidez (0–5).', minimum: 0, maximum: 5 },
        denoise: { type: 'number', description: 'Denoise (0–1).', minimum: 0, maximum: 1 },
        blur: { type: 'number', description: 'Blur (0–50).', minimum: 0, maximum: 50 },
        hueRotateDeg: { type: 'number', description: 'Rotación de tono (-180–180).', minimum: -180, maximum: 180 },
        grayscale: { type: 'boolean', description: 'Blanco y negro.' },
        sepia: { type: 'boolean', description: 'Sepia.' },
        lutFile: { type: 'string', description: 'Ruta LUT .cube dentro del workspace.', minLength: 1, maxLength: 500 },
        lutIntensity: { type: 'number', description: 'Intensidad LUT (0–1).', minimum: 0, maximum: 1 },
        clear: { type: 'boolean', description: 'Quita el look global.' },
      },
      additionalProperties: false,
    },
    execute: (args, host) => {
      projectOrFail(host);
      const numbers = [
        'brightness',
        'contrast',
        'saturation',
        'temperature',
        'shadows',
        'highlights',
        'fade',
        'vignette',
        'grain',
        'sharpen',
        'denoise',
        'blur',
        'hueRotateDeg',
        'lutIntensity',
      ] as const;
      const patch: Record<string, number | boolean | string> = {};
      for (const key of numbers) {
        if (typeof args[key] === 'number') patch[key] = args[key] as number;
      }
      for (const key of ['grayscale', 'sepia'] as const) {
        if (typeof args[key] === 'boolean') patch[key] = args[key] as boolean;
      }
      if (typeof args.lutFile === 'string' && args.lutFile.trim()) {
        patch.lutFile = args.lutFile.trim();
      }
      const clear = args.clear === true;
      if (!clear && Object.keys(patch).length === 0) {
        return { ok: false, summary: 'indicá al menos un ajuste o clear:true' };
      }
      try {
        const ok = host.mutate((current) =>
          updateProjectLook(
            current,
            clear ? null : (patch as Parameters<typeof updateProjectLook>[1]),
          ),
        );
        if (!ok) return { ok: false, summary: 'el look no deja el proyecto válido' };
        return {
          ok: true,
          summary: clear
            ? 'Look global quitado'
            : `Look global aplicado (${Object.keys(patch).length} ajuste(s))`,
          data: { clear, patch },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo aplicar el look',
        };
      }
    },
  },
  {
    name: 'clip_edit',
    description:
      'Edita un clip existente: lo mueve de frame o de pista (ripple opcional), recorta su duración, cambia velocidad, etiqueta o enabled, en una sola mutación.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip a editar.', minLength: 1 },
        startFrame: { type: 'integer', description: 'Nuevo frame de inicio.', minimum: 0 },
        trackId: { type: 'string', description: 'Pista destino al mover.', minLength: 1 },
        durationFrames: { type: 'integer', description: 'Nueva duración desde el inicio.', minimum: 1 },
        ripple: { type: 'boolean', description: 'Mover magnético (cierra huecos).' },
        speed: { type: 'number', description: 'Velocidad (0,25–4).', minimum: 0.25, maximum: 4 },
        label: { type: 'string', description: 'Nueva etiqueta.', minLength: 1, maxLength: 200 },
        enabled: { type: 'boolean', description: 'Activa o desactiva el clip.' },
      },
      required: ['clipId'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipId = String(args.clipId);
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `clip inexistente: ${clipId}` };
      const hasMove =
        typeof args.startFrame === 'number' || typeof args.trackId === 'string';
      const hasTrim = typeof args.durationFrames === 'number';
      const hasSpeed = typeof args.speed === 'number';
      const hasPatch = typeof args.label === 'string' || typeof args.enabled === 'boolean';
      if (!hasMove && !hasTrim && !hasSpeed && !hasPatch) {
        return { ok: false, summary: 'indicá al menos una edición' };
      }
      try {
        const clipIdNow = clipId;
        const outcome: { clip: { startFrame: number; durationFrames: number } | null } = {
          clip: null,
        };
        const ok = host.mutate((current) => {
          let next = current;
          if (hasMove) {
            const targetStart =
              typeof args.startFrame === 'number' ? args.startFrame : clip.startFrame;
            const moved = args.ripple === true
              ? magneticMoveClip(next, clipIdNow, targetStart, typeof args.trackId === 'string' ? args.trackId : undefined)
              : moveClip(next, clipIdNow, targetStart, typeof args.trackId === 'string' ? args.trackId : undefined);
            if (!moved) throw new Error('el clip no se puede mover a esa posición');
            next = moved;
          }
          if (hasTrim) {
            const target = next.timeline.clips.find((item) => item.id === clipIdNow)!;
            const trimmed = trimClip(next, clipIdNow, 'end', target.startFrame + Math.round(args.durationFrames as number));
            if (!trimmed) throw new Error('no se pudo recortar el clip');
            next = trimmed;
          }
          if (hasSpeed) {
            next = setClipSpeed(next, clipIdNow, args.speed as number);
          }
          if (hasPatch) {
            next = updateClip(next, clipIdNow, {
              ...(typeof args.label === 'string' ? { label: args.label } : {}),
              ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
            });
          }
          const currentClip = next.timeline.clips.find((item) => item.id === clipIdNow);
          outcome.clip = currentClip
            ? { startFrame: currentClip.startFrame, durationFrames: currentClip.durationFrames }
            : null;
          return next;
        });
        if (!ok) return { ok: false, summary: 'la edición no deja el proyecto válido' };
        const finalClip = outcome.clip;
        return {
          ok: true,
          summary: `Clip editado${
            finalClip ? `: ${finalClip.startFrame} + ${finalClip.durationFrames} frames` : ''
          }`,
          data: finalClip ? { clipId: clipIdNow, ...finalClip } : { clipId: clipIdNow },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo editar el clip',
        };
      }
    },
  },
  {
    name: 'clip_audio',
    description:
      'Ajusta el audio de clips concretos o de todas las escenas indicadas: ganancia, paneo, EQ de 3 bandas, fades, pasa-altos/bajos, compresor, denoise, voz o mute. Es la mezcla por escena/capítulo.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipIds: {
          type: 'array',
          description: 'Clips de audio/video a ajustar.',
          items: { type: 'string' },
          maxItems: 50,
        },
        sceneIds: {
          type: 'array',
          description: 'Alternativa: aplica a los clips de audio/video de esas escenas.',
          items: { type: 'string' },
          maxItems: 20,
        },
        gainDb: { type: 'number', description: 'Ganancia del clip (-60–12 dB).', minimum: -60, maximum: 12 },
        pan: { type: 'number', description: 'Paneo (-1 izq … 1 der).', minimum: -1, maximum: 1 },
        eqLowDb: { type: 'number', description: 'EQ graves (-12–12 dB).', minimum: -12, maximum: 12 },
        eqMidDb: { type: 'number', description: 'EQ medios (-12–12 dB).', minimum: -12, maximum: 12 },
        eqHighDb: { type: 'number', description: 'EQ agudos (-12–12 dB).', minimum: -12, maximum: 12 },
        fadeInFrames: { type: 'integer', description: 'Fade de entrada en frames.', minimum: 1, maximum: 600 },
        fadeOutFrames: { type: 'integer', description: 'Fade de salida en frames.', minimum: 1, maximum: 600 },
        highPassHz: { type: 'number', description: 'Pasa-altos (20–2000 Hz).', minimum: 20, maximum: 2_000 },
        lowPassHz: { type: 'number', description: 'Pasa-bajos (1000–20000 Hz).', minimum: 1_000, maximum: 20_000 },
        compressor: { type: 'boolean', description: 'Compresor por clip.' },
        denoise: { type: 'number', description: 'Denoise de voz (0–1).', minimum: 0, maximum: 1 },
        voiceEffect: {
          type: 'string',
          description: 'Efecto de voz.',
          enum: ['deep', 'chipmunk', 'robot', 'echo', 'cave', 'radio'],
        },
        muted: { type: 'boolean', description: 'Silencia el clip.' },
      },
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipIds = [...new Set((Array.isArray(args.clipIds) ? args.clipIds : []).map((id) => String(id)))];
      const sceneIds = [...new Set((Array.isArray(args.sceneIds) ? args.sceneIds : []).map((id) => String(id)))];
      if (clipIds.length === 0 && sceneIds.length === 0) {
        return { ok: false, summary: 'pasá clipIds o sceneIds' };
      }
      const missingScenes = sceneIds.filter((id) => !project.scenes.some((scene) => scene.id === id));
      if (missingScenes.length > 0) {
        return { ok: false, summary: `escenas inexistentes: ${missingScenes.join(', ')}` };
      }
      const fromScenes = sceneIds.flatMap(
        (id) => project.scenes.find((scene) => scene.id === id)?.clipIds ?? [],
      );
      const targets = [...new Set([...clipIds, ...fromScenes])];
      const missing = targets.filter((id) => !project.timeline.clips.some((clip) => clip.id === id));
      if (missing.length > 0) {
        return { ok: false, summary: `clips inexistentes: ${missing.join(', ')}` };
      }
      const audioPatch: Record<string, number | boolean | string> = {};
      for (const key of [
        'gainDb',
        'pan',
        'eqLowDb',
        'eqMidDb',
        'eqHighDb',
        'fadeInFrames',
        'fadeOutFrames',
        'highPassHz',
        'lowPassHz',
        'denoise',
      ]) {
        if (typeof args[key] === 'number') audioPatch[key] = args[key] as number;
      }
      for (const key of ['compressor', 'muted']) {
        if (typeof args[key] === 'boolean') audioPatch[key] = args[key] as boolean;
      }
      if (typeof args.voiceEffect === 'string') audioPatch.voiceEffect = args.voiceEffect;
      if (Object.keys(audioPatch).length === 0) {
        return { ok: false, summary: 'indicá al menos un ajuste de audio' };
      }
      const eligible = targets.filter((id) => {
        const clip = project.timeline.clips.find((item) => item.id === id);
        return clip?.kind === 'audio' || clip?.kind === 'video';
      });
      if (eligible.length === 0) {
        return { ok: false, summary: 'los clips indicados no tienen audio editable' };
      }
      try {
        const ok = host.mutate((current) => {
          let next = current;
          for (const clipId of eligible) {
            const clip = next.timeline.clips.find((item) => item.id === clipId);
            if (!clip) continue;
            const existing =
              clip.kind === 'audio' || clip.kind === 'video'
                ? ((clip as { audio?: Record<string, unknown> }).audio ?? {})
                : {};
            next = updateClip(next, clipId, {
              audio: { ...existing, ...audioPatch } as Parameters<typeof updateClip>[2]['audio'],
            });
          }
          return next;
        });
        if (!ok) return { ok: false, summary: 'la mezcla no deja el proyecto válido' };
        return {
          ok: true,
          summary: `Audio ajustado en ${eligible.length} clip(s)`,
          data: { clips: eligible, patch: audioPatch },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo ajustar el audio',
        };
      }
    },
  },
  {
    name: 'audio_mix',
    description:
      'Mezcla audio: ajusta ganancia, paneo, EQ de 3 bandas, mute/solo de una pista (por id o por tipo) y el master (ganancia/limiter) en una sola mutación.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'Pista a ajustar.', minLength: 1 },
        trackKind: {
          type: 'string',
          description: 'Alternativa a trackId: aplica a todas las pistas de este tipo.',
          enum: ['video', 'image', 'audio', 'narration', 'caption', 'graphic', 'adjustment'],
        },
        gainDb: { type: 'number', description: 'Ganancia de pista (-60–12 dB).', minimum: -60, maximum: 12 },
        pan: { type: 'number', description: 'Paneo estéreo (-1 izq … 1 der).', minimum: -1, maximum: 1 },
        eqLowDb: { type: 'number', description: 'EQ graves (-12–12 dB).', minimum: -12, maximum: 12 },
        eqMidDb: { type: 'number', description: 'EQ medios (-12–12 dB).', minimum: -12, maximum: 12 },
        eqHighDb: { type: 'number', description: 'EQ agudos (-12–12 dB).', minimum: -12, maximum: 12 },
        muted: { type: 'boolean', description: 'Silencia la pista.' },
        solo: { type: 'boolean', description: 'Aísla la pista.' },
        masterGainDb: { type: 'number', description: 'Ganancia del master (-60–12 dB).', minimum: -60, maximum: 12 },
        masterLimiter: { type: 'boolean', description: 'Activa o desactiva el limiter del master.' },
      },
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const hasMaster =
        typeof args.masterGainDb === 'number' || typeof args.masterLimiter === 'boolean';
      const trackPatch: Record<string, number | boolean> = {};
      for (const key of ['gainDb', 'pan', 'eqLowDb', 'eqMidDb', 'eqHighDb']) {
        if (typeof args[key] === 'number') trackPatch[key] = args[key] as number;
      }
      for (const key of ['muted', 'solo']) {
        if (typeof args[key] === 'boolean') trackPatch[key] = args[key] as boolean;
      }
      const hasTrackPatch = Object.keys(trackPatch).length > 0;
      if (!hasTrackPatch && !hasMaster) {
        return { ok: false, summary: 'indicá al menos un ajuste de pista o master' };
      }
      const trackId = typeof args.trackId === 'string' ? args.trackId.trim() : '';
      const trackKind = typeof args.trackKind === 'string' ? args.trackKind : '';
      if (hasTrackPatch && !trackId && !trackKind) {
        return { ok: false, summary: 'para pistas pasá trackId o trackKind' };
      }
      const targets = trackId
        ? project.timeline.tracks.filter((track) => track.id === trackId)
        : trackKind
          ? project.timeline.tracks.filter((track) => track.kind === trackKind)
          : [];
      if (trackId && targets.length === 0) {
        return { ok: false, summary: `pista inexistente: ${trackId}` };
      }
      if (hasTrackPatch && targets.length === 0) {
        return { ok: false, summary: `no hay pistas de tipo ${trackKind}` };
      }
      try {
        const ok = host.mutate((current) => {
          let next = current;
          for (const track of targets) {
            next = updateTrack(next, track.id, trackPatch as Parameters<typeof updateTrack>[2]);
          }
          if (hasMaster) {
            next = updateAudioMix(next, {
              ...(typeof args.masterGainDb === 'number'
                ? { masterGainDb: args.masterGainDb }
                : {}),
              ...(typeof args.masterLimiter === 'boolean'
                ? { masterLimiter: args.masterLimiter }
                : {}),
            });
          }
          return next;
        });
        if (!ok) return { ok: false, summary: 'la mezcla no deja el proyecto válido' };
        return {
          ok: true,
          summary: `Mezcla aplicada a ${targets.length} pista(s)${
            hasMaster ? ' y master' : ''
          }`,
          data: {
            tracks: targets.map((track) => track.id),
            patch: trackPatch,
            master: hasMaster
              ? {
                  ...(typeof args.masterGainDb === 'number'
                    ? { gainDb: args.masterGainDb }
                    : {}),
                  ...(typeof args.masterLimiter === 'boolean'
                    ? { limiter: args.masterLimiter }
                    : {}),
                }
              : null,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo mezclar el audio',
        };
      }
    },
  },
  {
    name: 'motion_path',
    description:
      'Anima un clip visual por una trayectoria de puntos (x,y en píxeles) con keyframes de transform, easing y Bezier opcional. Reemplaza los keyframes de transform anteriores.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip visual (por defecto el seleccionado).', minLength: 1 },
        path: {
          type: 'array',
          description: 'Puntos x,y en píxeles: [x0,y0,x1,y1,…]. Mínimo 2 puntos.',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 40,
        },
        durationFrames: {
          type: 'integer',
          description: 'Frames que recorre la trayectoria (por defecto la duración del clip).',
          minimum: 2,
        },
        easing: {
          type: 'string',
          description: 'Interpolación de cada segmento.',
          enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'],
        },
        bezier: {
          type: 'array',
          description: 'Curva Bezier [cp1X,cp1Y,cp2X,cp2Y] (0..1) para cada segmento.',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 4,
        },
        startScale: { type: 'number', description: 'Escala al inicio (0,5..4).', minimum: 0.5, maximum: 4 },
        endScale: { type: 'number', description: 'Escala al final (0,5..4).', minimum: 0.5, maximum: 4 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip visual o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind === 'audio') return { ok: false, summary: 'motion_path sólo aplica a clips visuales' };
      const rawPath = Array.isArray(args.path) ? args.path : [];
      if (rawPath.length < 4 || rawPath.length % 2 !== 0) {
        return { ok: false, summary: 'path necesita pares x,y (mínimo 2 puntos)' };
      }
      const points = [];
      for (let index = 0; index < rawPath.length; index += 2) {
        const x = Number(rawPath[index]);
        const y = Number(rawPath[index + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { ok: false, summary: 'path contiene un punto inválido' };
        }
        points.push({ x: Math.round(x), y: Math.round(y) });
      }
      if (points.length > 24) return { ok: false, summary: 'máximo 24 puntos de trayectoria' };
      const duration = Math.max(
        points.length,
        Math.min(
          clip.durationFrames,
          typeof args.durationFrames === 'number' ? Math.round(args.durationFrames) : clip.durationFrames,
        ),
      );
      const easing =
        typeof args.easing === 'string' &&
        ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(args.easing)
          ? (args.easing as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out')
          : 'ease-in-out';
      let bezier: { cp1X: number; cp1Y: number; cp2X: number; cp2Y: number } | undefined;
      if (Array.isArray(args.bezier) && args.bezier.length === 4) {
        const values = args.bezier.map(Number);
        if (values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
          bezier = { cp1X: values[0]!, cp1Y: values[1]!, cp2X: values[2]!, cp2Y: values[3]! };
        } else {
          return { ok: false, summary: 'bezier necesita 4 valores entre 0 y 1' };
        }
      }
      const startScale = typeof args.startScale === 'number' ? args.startScale : undefined;
      const endScale = typeof args.endScale === 'number' ? args.endScale : undefined;
      const keyframes = points.map((point, index) => {
        const ratio = points.length > 1 ? index / (points.length - 1) : 0;
        const frame = Math.round(ratio * (duration - 1));
        const keyframe: Record<string, unknown> = {
          frame,
          offsetX: point.x,
          offsetY: point.y,
        };
        if (startScale !== undefined || endScale !== undefined) {
          const from = startScale ?? endScale ?? 1;
          const to = endScale ?? startScale ?? 1;
          keyframe.scale = Number((from + (to - from) * ratio).toFixed(4));
        }
        if (index < points.length - 1) {
          keyframe.easing = easing;
          if (bezier) keyframe.bezier = bezier;
        }
        return keyframe;
      });
      const staticTransform = 'transform' in clip && clip.transform ? clip.transform : {};
      const transform = {
        ...staticTransform,
        keyframes: keyframes as never,
      };
      const updated = host.mutate((current) => updateClip(current, clipId, { transform }));
      if (!updated) return { ok: false, summary: 'la trayectoria no deja el proyecto válida' };
      return {
        ok: true,
        summary: `Trayectoria de ${points.length} puntos en ${duration} frames (${easing})`,
        data: { clipId, keyframes: keyframes.length, durationFrames: duration, easing, points },
      };
    },
  },
  {
    name: 'edit_transaction',
    description:
      'Aplica varias ediciones puras (clip, motion, efectos, transición, subtítulo, escena, parallax, cámara o pin de motor) como una sola transacción: si una falla no se guarda nada y el undo revierte todo junto.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Operaciones en orden; `arguments` es el JSON del esquema de cada herramienta.',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                description: 'Herramienta de edición.',
                minLength: 1,
                maxLength: 80,
              },
              arguments: {
                type: 'string',
                description: 'Argumentos JSON de la herramienta.',
                minLength: 2,
                maxLength: 4_000,
              },
            },
            required: ['tool', 'arguments'],
          },
          minItems: 1,
          maxItems: 20,
        },
      },
      required: ['operations'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const project = projectOrFail(host);
      const raw = Array.isArray(args.operations)
        ? (args.operations as ReadonlyArray<Record<string, unknown>>)
        : [];
      if (raw.length === 0) return { ok: false, summary: 'operations no puede estar vacío' };
      let working = project;
      let lastClipId: string | undefined;
      const results: Array<{ tool: string; summary: string }> = [];
      try {
        for (const [index, entry] of raw.entries()) {
          const name = String(entry.tool ?? '');
          const tool = findAssistantTool(name);
          if (!tool || !TRANSACTION_TOOLS.has(name)) {
            return {
              ok: false,
              summary: `operación ${index + 1}: "${name}" no se permite en una transacción`,
              data: { results },
            };
          }
          let opArgs: Record<string, unknown>;
          try {
            const parsed = JSON.parse(String(entry.arguments ?? '{}')) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('no es un objeto');
            }
            opArgs = parsed as Record<string, unknown>;
          } catch {
            return {
              ok: false,
              summary: `operación ${index + 1} (${name}): arguments no es JSON de objeto`,
              data: { results },
            };
          }
          const errors = validateToolArguments(tool.parameters, opArgs);
          if (errors.length > 0) {
            return {
              ok: false,
              summary: `operación ${index + 1} (${name}): ${errors.join('; ')}`,
              data: { results },
            };
          }
          const wrapper: AssistantToolHost = {
            ...host,
            project: () => working,
            mutate: (update) => {
              working = update(working);
              return true;
            },
            save: async () => undefined,
            navigate: () => undefined,
            selectClip: (clipId) => {
              lastClipId = clipId;
            },
          };
          const outcome = await tool.execute(opArgs, wrapper);
          if (!outcome.ok) {
            return {
              ok: false,
              summary: `operación ${index + 1} (${name}): ${outcome.summary}`,
              data: { results, failed: index + 1 },
            };
          }
          if (
            outcome.data &&
            typeof outcome.data === 'object' &&
            typeof (outcome.data as { clipId?: unknown }).clipId === 'string'
          ) {
            lastClipId = (outcome.data as { clipId: string }).clipId;
          }
          results.push({ tool: name, summary: outcome.summary });
        }
        const committed = host.mutate(() => working);
        if (!committed) {
          return { ok: false, summary: 'la transacción no deja el proyecto válido' };
        }
        if (lastClipId) host.selectClip(lastClipId);
        return {
          ok: true,
          summary: `${results.length} operación(es) aplicadas en una transacción`,
          data: { results, operations: results.length },
        };
      } catch (cause) {
        return {
          ok: false,
          summary:
            cause instanceof Error ? cause.message : 'la transacción no se pudo aplicar',
          data: { results },
        };
      }
    },
  },
  {
    name: 'render_scene',
    description:
      'Renderiza una sola escena a un segmento MP4 estable en la carpeta del proyecto. Si el segmento ya existe y tiene bytes, lo reutiliza (reanudación). Después uní los segmentos con video_concat.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Escena a renderizar.', minLength: 1 },
        includeCaptions: { type: 'boolean', description: 'Quemar subtítulos del rango.' },
      },
      required: ['sceneId'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      projectOrFail(host);
      const sceneId = String(args.sceneId);
      try {
        const result = await host.renderSceneSegment({
          sceneId,
          includeCaptions: args.includeCaptions === true,
        });
        if (!result) {
          return { ok: false, summary: `no se pudo renderizar la escena ${sceneId}` };
        }
        return {
          ok: true,
          summary: result.skipped
            ? `Escena reutilizada (${result.bytes} B): ${result.outputPath}`
            : `Escena en render (${result.profileName}) · job ${result.jobId}`,
          data: result,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo renderizar la escena',
        };
      }
    },
  },
  {
    name: 'video_concat',
    description:
      'Une segmentos MP4 idénticos (render por escenas) en un solo archivo sin recodificar. Pasá las rutas devueltas por render_scene.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description: 'Rutas absolutas de los segmentos, en orden.',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 64,
        },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      projectOrFail(host);
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      if (paths.length === 0) return { ok: false, summary: 'pasá al menos un segmento' };
      try {
        const result = await host.concatVideos(paths);
        if (!result) return { ok: false, summary: 'no se pudieron concatenar los segmentos' };
        return {
          ok: true,
          summary: `Video final: ${result.outputPath} (${result.bytes} B, ${result.durationSeconds.toFixed(2)} s)`,
          data: result,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudieron concatenar los segmentos',
        };
      }
    },
  },
  {
    name: 'track_point',
    description:
      'Sigue un punto (0..1) sobre un clip de video con el tracker NCC y aplica la trayectoria como máscara poligonal con keyframes. Usá el clip seleccionado si no pasás clipId.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip de video (por defecto el seleccionado).', minLength: 1 },
        x: { type: 'number', description: 'Centro inicial X normalizado (0..1).', minimum: 0, maximum: 1 },
        y: { type: 'number', description: 'Centro inicial Y normalizado (0..1).', minimum: 0, maximum: 1 },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip de video o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind !== 'video' || clip.source.type !== 'asset') {
        return { ok: false, summary: 'el seguimiento de punto sólo aplica a clips de video' };
      }
      const asset = project.assets.find((item) => item.id === clip.source.assetId);
      if (!asset) return { ok: false, summary: 'el clip no tiene material asociado' };
      const fps = fpsOf(project);
      try {
        const result = await host.trackPoint({
          path: asset.source.path,
          startSeconds: clip.source.inFrame / fps,
          endSeconds: clip.source.outFrame / fps,
          x: Number(args.x),
          y: Number(args.y),
        });
        const mask = maskFromPointTrack(result, fps, 0.15);
        if (!mask) {
          return { ok: false, summary: 'el tracker no encontró el punto con suficiente confianza' };
        }
        const updated = host.mutate((current) =>
          updateClip(current, clipId, { mask }),
        );
        if (!updated) {
          return { ok: false, summary: 'la máscara no deja el proyecto en un estado válido' };
        }
        host.selectClip(clipId);
        return {
          ok: true,
          summary: `Punto seguido: ${result.points.length} muestras, ${mask.keyframes?.length ?? 0} claves`,
          data: { clipId, keyframes: mask.keyframes?.length ?? 0, points: result.points.length },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo seguir el punto',
        };
      }
    },
  },
  {
    name: 'track_object',
    description:
      'Sigue una caja (objeto) sobre un clip de video con el tracker NCC de región y aplica una máscara rectangular con keyframes. Pasá x/y del centro y width/height de la caja (0..1). Sin detección semántica: vos elegís la caja.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Clip de video (por defecto el seleccionado).', minLength: 1 },
        x: { type: 'number', description: 'Centro inicial X normalizado (0..1).', minimum: 0, maximum: 1 },
        y: { type: 'number', description: 'Centro inicial Y normalizado (0..1).', minimum: 0, maximum: 1 },
        width: { type: 'number', description: 'Ancho de la caja normalizado (0,01..1).', minimum: 0.01, maximum: 1 },
        height: { type: 'number', description: 'Alto de la caja normalizado (0,01..1).', minimum: 0.01, maximum: 1 },
      },
      required: ['x', 'y', 'width', 'height'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const project = projectOrFail(host);
      const clipId =
        typeof args.clipId === 'string' && args.clipId.trim()
          ? args.clipId.trim()
          : selectedClipId(host);
      if (!clipId) return { ok: false, summary: 'elegí un clip de video o pasá clipId' };
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return { ok: false, summary: `no existe el clip ${clipId}` };
      if (clip.kind !== 'video' || clip.source.type !== 'asset') {
        return { ok: false, summary: 'el seguimiento de objeto sólo aplica a clips de video' };
      }
      const asset = project.assets.find((item) => item.id === clip.source.assetId);
      if (!asset) return { ok: false, summary: 'el clip no tiene material asociado' };
      const fps = fpsOf(project);
      try {
        const result = await host.trackObject({
          path: asset.source.path,
          startSeconds: clip.source.inFrame / fps,
          endSeconds: clip.source.outFrame / fps,
          x: Number(args.x),
          y: Number(args.y),
          width: Number(args.width),
          height: Number(args.height),
        });
        const mask = maskFromObjectTrack(result, fps);
        if (!mask) {
          return { ok: false, summary: 'el tracker no encontró el objeto con suficiente confianza' };
        }
        const updated = host.mutate((current) =>
          updateClip(current, clipId, { mask }),
        );
        if (!updated) {
          return { ok: false, summary: 'la máscara no deja el proyecto en un estado válido' };
        }
        host.selectClip(clipId);
        return {
          ok: true,
          summary: `Objeto seguido: ${result.points.length} muestras, ${mask.keyframes?.length ?? 0} claves, caja ${Math.round(result.regionWidth * 100)}×${Math.round(result.regionHeight * 100)} %`,
          data: {
            clipId,
            keyframes: mask.keyframes?.length ?? 0,
            points: result.points.length,
            regionWidth: result.regionWidth,
            regionHeight: result.regionHeight,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo seguir el objeto',
        };
      }
    },
  },
  {
    name: 'render_start',
    description:
      'Inicia un render MP4 del proyecto con un perfil (por defecto el primero). Devuelve el jobId; usá render_status para seguir el progreso. Consume CPU/GPU y puede tardar.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Perfil de entrega; vacío usa el primero.', minLength: 1 },
        includeCaptions: { type: 'boolean', description: 'Quemar subtítulos en el video.' },
      },
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const project = projectOrFail(host);
      const profileId =
        typeof args.profileId === 'string' && args.profileId.trim()
          ? args.profileId.trim()
          : null;
      try {
        const started = await host.startRender(profileId, args.includeCaptions === true);
        if (!started) {
          return { ok: false, summary: 'ya hay un render activo; esperá o cancelalo' };
        }
        return {
          ok: true,
          summary: `Render iniciado (${started.profileName}) · job ${started.jobId}`,
          data: { project: project.name, ...started },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo iniciar el render',
        };
      }
    },
  },
  {
    name: 'render_status',
    description:
      'Consulta el render activo y el último progreso/finalización conocido, con ruta y bytes del archivo si terminó.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, host) => {
      try {
        const active = await host.activeRender();
        const last = host.lastRenderEvent();
        const finished = last?.finished;
        const progress = last?.progress;
        const parts: string[] = [];
        if (active) parts.push(`activo: ${active}`);
        if (progress) parts.push(`${progress.phase} ${Math.round(progress.percent)}%`);
        if (finished) {
          parts.push(
            `${finished.status}${finished.outputPath ? ` · ${finished.outputPath}` : ''}${
              finished.outputBytes ? ` · ${finished.outputBytes} B` : ''
            }`,
          );
        }
        return {
          ok: true,
          summary: parts.length > 0 ? parts.join(' · ') : 'sin renders en esta sesión',
          data: {
            active,
            progress: progress ?? null,
            finished: finished ?? null,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo consultar el render',
        };
      }
    },
  },
  {
    name: 'render_cancel',
    description: 'Cancela el render activo o el job indicado.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job a cancelar; vacío usa el activo.', minLength: 1 },
      },
      additionalProperties: false,
    },
    execute: async (args, host) => {
      try {
        const jobId =
          typeof args.jobId === 'string' && args.jobId.trim()
            ? args.jobId.trim()
            : await host.activeRender();
        if (!jobId) return { ok: false, summary: 'no hay un render activo para cancelar' };
        await host.cancelRender(jobId);
        return { ok: true, summary: `Render ${jobId} cancelado`, data: { jobId } };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo cancelar el render',
        };
      }
    },
  },
  {
    name: 'render_queue_add',
    description:
      'Encola escenas para renderizarlas de a una en segundo plano, con estado persistente entre cierres. Cada segmento ya es reanudable; devuelve los ids de los trabajos nuevos.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        sceneIds: {
          type: 'array',
          description: 'Escenas a encolar (1–50).',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
        },
        includeCaptions: {
          type: 'boolean',
          description: 'Quemar subtítulos en cada segmento (por defecto no).',
        },
        concat: {
          type: 'boolean',
          description: 'Unir los segmentos automáticamente al terminar el lote.',
        },
      },
      required: ['sceneIds'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      try {
        if (!host.renderQueueAdd) {
          return { ok: false, summary: 'la cola de render vive en la app; abrí el proyecto en Olyvia' };
        }
        projectOrFail(host);
        const sceneIds = Array.isArray(args.sceneIds)
          ? args.sceneIds.map((id) => String(id)).filter(Boolean)
          : [];
        if (sceneIds.length === 0) return { ok: false, summary: 'sceneIds no puede estar vacío' };
        const outcome = await host.renderQueueAdd({
          sceneIds,
          includeCaptions: args.includeCaptions === true,
          ...(args.concat === true ? { concat: true } : {}),
        });
        if (outcome.ids.length === 0) {
          return {
            ok: false,
            summary: 'esas escenas ya están en cola o no existen',
            data: outcome.snapshot,
          };
        }
        return {
          ok: true,
          summary: `${outcome.ids.length} escena(s) en cola${
            args.concat === true ? ' · concat al terminar' : ''
          }`,
          data: { ids: outcome.ids, ...outcome.snapshot },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo encolar el render',
        };
      }
    },
  },
  {
    name: 'render_queue_status',
    description:
      'Lista la cola de render: pausa, trabajo en curso, estados, rutas y errores de cada escena.',
    permission: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, host) => {
      try {
        if (!host.renderQueueStatus) {
          return { ok: false, summary: 'la cola de render vive en la app; abrí el proyecto en Olyvia' };
        }
        const snapshot = host.renderQueueStatus();
        const counts = snapshot.items.reduce<Record<string, number>>((acc, item) => {
          acc[item.status] = (acc[item.status] ?? 0) + 1;
          return acc;
        }, {});
        const parts = Object.entries(counts).map(([status, count]) => `${count} ${status}`);
        const final = snapshot.finals?.[0];
        return {
          ok: true,
          summary: `${snapshot.paused ? 'pausada' : 'activa'}${
            snapshot.runningId ? ' · renderizando' : ''
          }${parts.length > 0 ? ` · ${parts.join(', ')}` : ' · vacía'}${
            final ? ` · final: ${final.outputPath}` : ''
          }`,
          data: snapshot,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo consultar la cola',
        };
      }
    },
  },
  {
    name: 'render_queue_control',
    description:
      'Controla la cola de render: pausar, reanudar, cancelar un trabajo en cola o vaciar los terminados.',
    permission: 'export',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Acción sobre la cola.',
          enum: ['pause', 'resume', 'cancel', 'clear-finished'],
        },
        jobId: {
          type: 'string',
          description: 'Trabajo a cancelar (sólo si sigue en cola).',
          minLength: 1,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      try {
        if (!host.renderQueueControl) {
          return { ok: false, summary: 'la cola de render vive en la app; abrí el proyecto en Olyvia' };
        }
        const action = String(args.action) as RenderQueueAction;
        if (!['pause', 'resume', 'cancel', 'clear-finished'].includes(action)) {
          return { ok: false, summary: `acción desconocida: ${action}` };
        }
        const jobId = typeof args.jobId === 'string' && args.jobId.trim() ? args.jobId.trim() : undefined;
        const snapshot = host.renderQueueControl(action, jobId);
        const labels: Record<RenderQueueAction, string> = {
          pause: 'Cola pausada',
          resume: 'Cola reanudada',
          cancel: jobId ? `Trabajo ${jobId} cancelado` : 'Trabajos en cola cancelados',
          'clear-finished': 'Terminados eliminados de la cola',
        };
        return { ok: true, summary: labels[action], data: snapshot };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo controlar la cola',
        };
      }
    },
  },
  {
    name: 'parallax_add',
    description:
      'Crea una composición 2.5D con fondo y recorte en pistas nuevas (Ken Burns, parallax suave, push/pull, drift, separación, depth zoom, pan/tilt). El recorte lo aporta el usuario; no hay segmentación automática.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        backgroundAssetId: {
          type: 'string',
          description: 'Material de fondo (imagen o video).',
          minLength: 1,
        },
        foregroundAssetId: {
          type: 'string',
          description: 'Recorte de primer plano (imagen o video con alfa). Obligatorio en los presets de dos capas.',
          minLength: 1,
        },
        preset: {
          type: 'string',
          description: 'Preset de parallax.',
          enum: PARALLAX_PRESETS.map((preset) => preset.id),
        },
        direction: {
          type: 'string',
          description: 'Dirección del paneo.',
          enum: ['left', 'right', 'up', 'down'],
        },
        intensity: {
          type: 'number',
          description: 'Intensidad del movimiento (0,02–0,5; por defecto 0,12).',
          minimum: 0.02,
          maximum: 0.5,
        },
        atFrame: {
          type: 'integer',
          description: 'Frame inicial (por defecto el playhead).',
          minimum: 0,
        },
        durationFrames: {
          type: 'integer',
          description: 'Duración en frames (por defecto 4 s).',
          minimum: 1,
        },
      },
      required: ['backgroundAssetId', 'preset'],
      additionalProperties: false,
    },
    execute: (args, host) => {
      const project = projectOrFail(host);
      try {
        const result = addParallaxScene(project, {
          backgroundAssetId: String(args.backgroundAssetId),
          ...(typeof args.foregroundAssetId === 'string'
            ? { foregroundAssetId: args.foregroundAssetId }
            : {}),
          preset: String(args.preset) as ParallaxPreset,
          ...(typeof args.direction === 'string'
            ? { direction: args.direction as 'left' | 'right' | 'up' | 'down' }
            : {}),
          ...(typeof args.intensity === 'number' ? { intensity: args.intensity } : {}),
          ...(typeof args.atFrame === 'number' ? { atFrame: args.atFrame } : {}),
          ...(typeof args.durationFrames === 'number'
            ? { durationFrames: args.durationFrames }
            : {}),
        });
        const ok = host.mutate(() => result.project);
        if (!ok) {
          return { ok: false, summary: 'la composición no deja el proyecto en un estado válido' };
        }
        host.selectClip(result.foregroundClipId ?? result.backgroundClipId);
        host.navigate('editor');
        return {
          ok: true,
          summary: `Parallax ${result.preset} creado (${result.foregroundClipId ? '2 capas' : '1 capa'})`,
          data: {
            backgroundClipId: result.backgroundClipId,
            foregroundClipId: result.foregroundClipId,
            preset: result.preset,
            direction: result.direction,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo crear el parallax',
        };
      }
    },
  },
  {
    name: 'rig_add',
    description:
      'Genera una animación de personaje 2D (stickman con esqueleto procedural: reposo, caminar, correr, saltar, saludar o alcanzar con IK), la hornea a MP4 y la importa a Medios. No la coloca en el timeline; usá clip_add después. No hace rigging automático desde fotos.',
    permission: 'edit',
    parameters: {
      type: 'object',
      properties: {
        clip: {
          type: 'string',
          description: 'Ciclo de animación.',
          enum: RIG_CLIPS.map((clip) => clip.id),
        },
        palette: {
          type: 'string',
          description: 'Paleta del personaje.',
          enum: RIG_PALETTES.map((palette) => palette.id),
        },
        seconds: {
          type: 'number',
          description: 'Duración del clip (1–10 s; por defecto 2).',
          minimum: 1,
          maximum: 10,
        },
        target: {
          type: 'array',
          description: 'Objetivo IK normalizado [x,y] (0..1) para el clip reach.',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['clip'],
      additionalProperties: false,
    },
    execute: async (args, host) => {
      const clip = String(args.clip) as RigClipId;
      if (!RIG_CLIPS.some((entry) => entry.id === clip)) {
        return { ok: false, summary: `clip desconocido: ${clip}` };
      }
      let target: { x: number; y: number } | undefined;
      if (args.target !== undefined) {
        const raw = Array.isArray(args.target) ? args.target : [];
        const values = raw.map(Number);
        if (
          clip !== 'reach' ||
          values.length !== 2 ||
          !values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
        ) {
          return {
            ok: false,
            summary: 'target sólo aplica a reach y necesita [x,y] entre 0 y 1',
          };
        }
        target = { x: values[0]!, y: values[1]! };
      }
      const paletteId =
        typeof args.palette === 'string' && RIG_PALETTES.some((entry) => entry.id === args.palette)
          ? args.palette
          : 'cyan';
      try {
        const result = await host.renderRigClip({
          clip,
          paletteId,
          ...(typeof args.seconds === 'number' ? { seconds: args.seconds } : {}),
          ...(target ? { target } : {}),
        });
        if (!result) {
          return { ok: false, summary: 'no se pudo generar el personaje 2D (abrí un proyecto)' };
        }
        return {
          ok: true,
          summary: `Personaje 2D ${clip}${
            target ? ` → (${target.x.toFixed(2)}, ${target.y.toFixed(2)})` : ''
          } importado a Medios: ${result.label} (${result.bytes} B)`,
          data: result,
        };
      } catch (cause) {
        return {
          ok: false,
          summary: cause instanceof Error ? cause.message : 'no se pudo generar el personaje 2D',
        };
      }
    },
  },
];

export function findAssistantTool(name: string): AssistantToolDefinition | null {
  return ASSISTANT_TOOLS.find((tool) => tool.name === name) ?? null;
}

/** Esquema que recibe el proveedor (formato OpenAI function calling). */
/**
 * Selección de herramientas por intención. Enviar las 43 definiciones en cada
 * ronda cuesta ~30 KB de esquemas por llamada; el router manda solo el grupo
 * que la frase necesita, con un conjunto base mínimo. Es determinista: no usa
 * tokens para decidir.
 */
export type ToolIntent =
  | 'core'
  | 'files'
  | 'edit'
  | 'audio'
  | 'render'
  | 'script'
  | 'motion'
  | 'effects'
  | 'project';

/** Herramientas que siempre viajan: inspeccionar, navegar y reproducir. */
const CORE_TOOLS = ['project_inspect', 'navigate', 'transport'] as const;

const INTENT_TOOLS: Record<Exclude<ToolIntent, 'core'>, readonly string[]> = {
  files: [
    'files_roots',
    'files_search',
    'files_list',
    'media_find',
    'files_read_text',
    'auto_video_from_folder',
    'asset_import',
  ],
  edit: ['clip_edit', 'clip_split', 'clip_add', 'edit_transaction'],
  audio: ['audio_mix', 'clip_audio', 'narrate_scenes'],
  render: [
    'export_open',
    'render_start',
    'render_status',
    'render_cancel',
    'render_scene',
    'video_concat',
  ],
  script: [
    'scene_create',
    'scene_update',
    'scene_resolve',
    'chapter_plan',
    'narrate_scenes',
    'subtitle_add',
  ],
  motion: [
    'motion_add',
    'motion_path',
    'three_add',
    'camera_move',
    'parallax_add',
    'rig_add',
    'track_point',
    'track_object',
  ],
  effects: ['effect_apply', 'transition_apply', 'project_look'],
  project: ['project_open', 'engine_catalog'],
};

/** Si la frase no coincide con nada, este set alcanza para empezar. */
const GENERAL_TOOLS = [
  'files_roots',
  'media_find',
  'clip_edit',
  'export_open',
  'scene_create',
] as const;

const MAX_TOOLS_PER_REQUEST = 14;

const INTENT_PATTERNS: ReadonlyArray<{ intent: Exclude<ToolIntent, 'core'>; pattern: RegExp }> = [
  {
    intent: 'files',
    pattern:
      /\b(archiv\w*|carpetas?|disco|busca\w*|busc[aá]\w*|encontr\w*|descargas?|escritorio|documentos?|fotos?|im[aá]genes?|material)\b/i,
  },
  { intent: 'edit', pattern: /\b(cort\w*|recort\w*|mover?|mov[eé]\w*|clips?|pistas?|timeline|divid\w*|duplic\w*|borrar|eliminar|fade)\b/i },
  { intent: 'audio', pattern: /\b(volumen|ganancia|paneo|pan|eq|mezcla\w*|mute|silencio\w*|narraci[oó]n|voz|audio)\b/i },
  { intent: 'render', pattern: /\b(export\w*|render\w*|mp4|guardar el video|procesar|entregar)\b/i },
  { intent: 'script', pattern: /\b(guion|gui[oó]n|escenas?|cap[ií]tulos?|historia|subt[ií]tulos?|narrar)\b/i },
  { intent: 'motion', pattern: /\b(motion|t[ií]tulos?|gr[aá]fico\w*|animaci[oó]n|3d|three|part[ií]culas?|logo|lower third|parallax|rig)\b/i },
  { intent: 'effects', pattern: /\b(efectos?|look|color|filtros?|lut|vi[nñ]eta|grano|transici[oó]n)\b/i },
  { intent: 'project', pattern: /\b(proyecto|abrir|guardar|fps|formato|resoluci[oó]n)\b/i },
];

export function selectToolIntents(text: string): Array<Exclude<ToolIntent, 'core'>> {
  const found: Array<Exclude<ToolIntent, 'core'>> = [];
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(text) && !found.includes(intent)) found.push(intent);
  }
  return found;
}

/**
 * Subconjunto de herramientas para una frase. Nunca devuelve vacío ni más de
 * `MAX_TOOLS_PER_REQUEST` definiciones.
 */
export function selectToolsForMessage(
  text: string,
  tools: readonly AssistantToolDefinition[] = ASSISTANT_TOOLS,
): readonly AssistantToolDefinition[] {
  const intents = selectToolIntents(text);
  const names = new Set<string>(CORE_TOOLS);
  const groups = intents.length > 0 ? intents : [];
  for (const intent of groups) {
    for (const name of INTENT_TOOLS[intent]) names.add(name);
  }
  if (names.size <= CORE_TOOLS.length) {
    for (const name of GENERAL_TOOLS) names.add(name);
  }
  const selected = tools.filter((tool) => names.has(tool.name));
  return selected.slice(0, MAX_TOOLS_PER_REQUEST);
}

/** Estimación gruesa (4 caracteres por token) del peso de los esquemas. */
export function estimateSchemaTokens(tools: readonly AssistantToolDefinition[]): number {
  return Math.round(JSON.stringify(assistantToolPayload(tools)).length / 4);
}

export function assistantToolPayload(
  tools: readonly AssistantToolDefinition[] = ASSISTANT_TOOLS,
): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: ToolParameters };
}> {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
