/**
 * Herramientas MCP del proyecto. Reutiliza el registro del asistente para
 * inspeccionar y editar (mismas validaciones y acciones) y agrega las
 * operaciones propias de un servidor de archivos: crear, guardar, listar
 * timeline y materiales, y mover el playhead lógico.
 */
import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  findAssistantTool,
  validateToolArguments,
  type AssistantToolHost,
  type ToolOutcome,
  type ToolParameters,
} from '../../desktop/src/features/assistant/assistant-tools';
import type { ProjectSession } from './session';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolParameters;
  readonly run: (args: Readonly<Record<string, unknown>>) => Promise<ToolOutcome>;
}

const REUSED = [
  'project_inspect',
  'motion_add',
  'motion_path',
  'clip_add',
  'clip_split',
  'engine_catalog',
  'scene_resolve',
  'parallax_add',
] as const;

function totalFrames(project: ProjectDocument): number {
  let end = 0;
  for (const clip of project.timeline.clips) {
    end = Math.max(end, clip.startFrame + clip.durationFrames);
  }
  return end;
}

export function createMcpTools(session: ProjectSession): {
  tools: readonly McpToolDefinition[];
  host: AssistantToolHost;
} {
  const state: {
    playhead: number;
    selection: { kind: string; id?: string };
  } = { playhead: 0, selection: { kind: 'none' } };

  const host: AssistantToolHost = {
    project: () => session.project,
    playheadFrame: () => state.playhead,
    selection: () => state.selection,
    view: () => 'mcp',
    navigate: () => undefined,
    setPlaying: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    save: async () => {
      session.save();
    },
    requestExport: () => undefined,
    mutate: (update) => {
      session.mutate(update);
      return true;
    },
    selectClip: (clipId) => {
      state.selection = { kind: 'clip', id: clipId };
    },
    openProjectAt: async () => {
      throw new Error(
        'abrir un proyecto por ruta vive en la app; usá project_create/save o el modo --live',
      );
    },
    importAssetPath: async () => {
      throw new Error(
        'importar material vive en la app; no está disponible en el MCP de archivos',
      );
    },
    renderRigClip: async () => {
      throw new Error(
        'el rig 2D se hornea con WebCodecs en la app; no está disponible en el MCP de archivos',
      );
    },
    renderThreeScene: async () => {
      throw new Error(
        'la escena 3D se hornea con WebGL/WebCodecs en la app; no está disponible en el MCP de archivos',
      );
    },
    renderSceneSegment: async () => {
      throw new Error('el render por escenas vive en la app; no está disponible en el MCP de archivos');
    },
    concatVideos: async () => {
      throw new Error('el concat de segmentos vive en la app; no está disponible en el MCP de archivos');
    },
    trackPoint: async () => {
      throw new Error(
        'el seguimiento de punto requiere FFmpeg y vive en la app; no está disponible en el MCP de archivos',
      );
    },
    trackObject: async () => {
      throw new Error(
        'el seguimiento de objeto requiere FFmpeg y vive en la app; no está disponible en el MCP de archivos',
      );
    },
    startRender: async () => {
      throw new Error('el render vive en la app; no está disponible en el MCP de archivos');
    },
    cancelRender: async () => {
      throw new Error('el render vive en la app; no está disponible en el MCP de archivos');
    },
    activeRender: async () => null,
    lastRenderEvent: () => null,
  };

  const reused: McpToolDefinition[] = REUSED.map((name) => {
    const tool = findAssistantTool(name);
    if (!tool) throw new Error(`herramienta interna ausente: ${name}`);
    return {
      name: tool.name,
      description:
        name === 'clip_add' || name === 'motion_add'
          ? `${tool.description} En MCP se agrega en el playhead lógico (por defecto 0; usá timeline_seek para moverlo).`
          : tool.description,
      inputSchema: tool.parameters,
      run: async (args) => {
        const errors = validateToolArguments(tool.parameters, args);
        if (errors.length > 0) {
          return { ok: false, summary: `argumentos inválidos: ${errors.join('; ')}` };
        }
        return tool.execute(args, host);
      },
    };
  });

  const custom: McpToolDefinition[] = [
    {
      name: 'project_create',
      description:
        'Crea el proyecto configurado en el servidor si el archivo no existe. No sobrescribe proyectos existentes.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del proyecto.', minLength: 1, maxLength: 120 },
          width: { type: 'integer', description: 'Ancho en píxeles (por defecto 1920).', minimum: 16, maximum: 7680 },
          height: { type: 'integer', description: 'Alto en píxeles (por defecto 1080).', minimum: 16, maximum: 4320 },
          fps: { type: 'number', description: 'FPS del proyecto (por defecto 30).', minimum: 1, maximum: 240 },
        },
        required: ['name'],
        additionalProperties: false,
      },
      run: async (args) => {
        try {
          const project = session.create(String(args.name), {
            ...(typeof args.width === 'number' ? { width: args.width } : {}),
            ...(typeof args.height === 'number' ? { height: args.height } : {}),
            ...(typeof args.fps === 'number' ? { fps: args.fps } : {}),
          });
          return {
            ok: true,
            summary: `Proyecto creado: ${project.name}`,
            data: { path: session.projectPath, revision: project.revision },
          };
        } catch (cause) {
          return { ok: false, summary: cause instanceof Error ? cause.message : 'no se pudo crear' };
        }
      },
    },
    {
      name: 'project_save',
      description: 'Guarda el proyecto abierto si no cambió en disco desde la última lectura.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        try {
          const project = session.save();
          return {
            ok: true,
            summary: `Proyecto guardado (revisión ${project.revision})`,
            data: { path: session.projectPath },
          };
        } catch (cause) {
          return { ok: false, summary: cause instanceof Error ? cause.message : 'no se pudo guardar' };
        }
      },
    },
    {
      name: 'timeline_list',
      description:
        'Lista pistas y clips con ids, tipo, etiqueta, frame inicial, duración y fuente.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const project = session.project;
        if (!project) return { ok: false, summary: 'no hay un proyecto abierto' };
        return {
          ok: true,
          summary: `${project.timeline.tracks.length} pistas, ${project.timeline.clips.length} clips`,
          data: {
            fps: project.video.frameRate.num / project.video.frameRate.den,
            durationFrames: totalFrames(project),
            tracks: project.timeline.tracks.map((track) => ({
              id: track.id,
              kind: track.kind,
              label: track.label,
              locked: track.locked,
              muted: track.muted,
              hidden: track.hidden,
            })),
            clips: project.timeline.clips.map((clip) => ({
              id: clip.id,
              trackId: clip.trackId,
              kind: clip.kind,
              label: clip.label,
              startFrame: clip.startFrame,
              durationFrames: clip.durationFrames,
              endFrame: clip.startFrame + clip.durationFrames,
              source: clip.source,
            })),
          },
        };
      },
    },
    {
      name: 'asset_list',
      description: 'Lista los materiales importados con id, etiqueta, tipo, estado y medios.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const project = session.project;
        if (!project) return { ok: false, summary: 'no hay un proyecto abierto' };
        return {
          ok: true,
          summary: `${project.assets.length} materiales`,
          data: {
            assets: project.assets.map((asset) => ({
              id: asset.id,
              label: asset.label,
              kind: asset.kind,
              status: asset.status,
              source: asset.source,
              media: 'media' in asset ? asset.media : null,
            })),
          },
        };
      },
    },
    {
      name: 'timeline_seek',
      description: 'Mueve el playhead lógico del servidor MCP (lo usan clip_add y clip_split).',
      inputSchema: {
        type: 'object',
        properties: {
          frame: { type: 'integer', description: 'Frame destino.', minimum: 0 },
        },
        required: ['frame'],
        additionalProperties: false,
      },
      run: async (args) => {
        if (typeof args.frame !== 'number') {
          return { ok: false, summary: 'frame debe ser un número' };
        }
        state.playhead = Math.max(0, Math.round(args.frame));
        return { ok: true, summary: `Playhead en frame ${state.playhead}`, data: { frame: state.playhead } };
      },
    },
  ];

  return { tools: [...reused, ...custom], host };
}
