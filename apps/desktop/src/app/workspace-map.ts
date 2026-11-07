/**
 * Mapa único del estudio.
 *
 * Antes de este archivo la app tenía cuatro recorridos de aprendizaje
 * distintos (PipelineGuide 6 pasos, LearnView 5, OnboardingTour 6 diferentes y
 * el editor vacío 3) y 33 `ViewId` repartidos entre tres registros sin una
 * relación explícita. Acá hay UNA sola fuente de verdad:
 *
 *  - `WORKSPACE_STEPS`: las seis etapas reales, derivadas de `app/pipeline.ts`
 *    (que además es quien calcula el progreso desde el proyecto).
 *  - `WORKSPACE_GROUPS`: los 33 `ViewId` agrupados, exactamente una vez.
 *
 * Las etiquetas y hints NO se copian: se leen de `NAV_VIEWS`. La ruta canónica
 * de cada vista NO se copia: se resuelve con `resolveViewRoute`.
 */

import type { ViewId } from './navigation';
import { NAV_VIEWS } from './navigation';
import {
  PIPELINE_STAGES,
  type PipelineProgress,
  type PipelineStage,
  type PipelineStageId,
} from './pipeline';
import { resolveViewRoute } from './view-routing';

export interface WorkspaceStep extends PipelineStage {
  /** Explicación de una línea para la guía de aprendizaje. */
  readonly detail: string;
  /** Atajo o dato concreto que evita que el usuario tenga que adivinar. */
  readonly tip: string;
}

const STEP_COPY: Readonly<
  Record<PipelineStageId, { readonly detail: string; readonly tip: string }>
> = {
  project: {
    detail: 'Elegí formato, fps y carpeta. El proyecto es local: nada se sube a la nube.',
    tip: 'Podés abrir un proyecto reciente desde Inicio o con Ctrl+O.',
  },
  script: {
    detail: 'Escribí las escenas a mano o con el asistente, y definí la narración de cada una.',
    tip: 'Cada escena puede llevar su propio prompt visual para buscar material.',
  },
  media: {
    detail: 'Importá videos, imágenes y audio; confirmá derechos y licencia antes de montar.',
    tip: 'También podés descargar material desde la web o generarlo con Flow.',
  },
  voice: {
    detail: 'Sintetizá la narración por escena y revisá niveles antes de armar la timeline.',
    tip: 'Producción genera la voz, los subtítulos y el montaje automático.',
  },
  edit: {
    detail: 'Montá los clips en la timeline, ajustá ritmo, color, audio y subtítulos.',
    tip: 'S divide en el cabezal; la timeline nunca desaparece al cambiar de herramienta.',
  },
  export: {
    detail: 'Elegí un perfil, renderizá con FFmpeg y verificá el MP4 antes de entregarlo.',
    tip: 'Ctrl+E abre el exportador; el resultado se comprueba con FFprobe.',
  },
};

/** Las seis etapas canónicas. Cualquier guía de la app debe usar esta lista. */
export const WORKSPACE_STEPS: readonly WorkspaceStep[] = PIPELINE_STAGES.map((stage) => ({
  ...stage,
  detail: STEP_COPY[stage.id].detail,
  tip: STEP_COPY[stage.id].tip,
}));

export const WORKSPACE_STEP_COUNT = WORKSPACE_STEPS.length;

export type WorkspaceGroupId = 'preparar' | 'editar' | 'potenciar' | 'configurar';

export interface WorkspaceGroup {
  readonly id: WorkspaceGroupId;
  readonly label: string;
  readonly hint: string;
  readonly views: readonly ViewId[];
}

/**
 * Los 33 `ViewId` en cuatro grupos. La unión debe ser exactamente `NAV_VIEWS`
 * y no puede repetir ninguno; `workspace-map.test.ts` lo verifica.
 */
export const WORKSPACE_GROUPS: readonly WorkspaceGroup[] = [
  {
    id: 'preparar',
    label: 'Preparar',
    hint: 'De la idea al material listo para montar',
    views: ['home', 'projects', 'script', 'assets', 'production', 'download', 'youtube', 'compliance'],
  },
  {
    id: 'editar',
    label: 'Editar',
    hint: 'Timeline, audio, efectos y piezas de publicación',
    views: [
      'editor', 'text-edit', 'multicam', 'mixer', 'vfx', 'nodes', 'motion',
      'visuals', 'factory', 'creator', 'thumbnails', 'localization',
    ],
  },
  {
    id: 'potenciar',
    label: 'Potenciar',
    hint: 'Análisis, IA local y utilidades de laboratorio',
    views: [
      'director', 'auto-edit', 'ai-hub', 'mcp', 'lab', 'convert',
      'compare', 'compress', 'denoise', 'sharpen', 'background', 'upscale',
      'record',
    ],
  },
  {
    id: 'configurar',
    label: 'Aprender y ajustar',
    hint: 'Guía, atajos y preferencias del estudio',
    views: ['learn', 'settings'],
  },
];

export interface WorkspaceTool {
  readonly view: ViewId;
  readonly label: string;
  readonly hint: string;
  readonly group: WorkspaceGroupId;
  /** Superficie canónica: nunca renderiza una pantalla duplicada. */
  readonly canonicalView: ViewId;
  readonly editorMode?: string;
  readonly hubTab?: string;
}

const NAV_BY_ID = new Map(NAV_VIEWS.map((view) => [view.id, view]));

/** Una sola entrada por vista, con su etiqueta real y su ruta canónica. */
export const WORKSPACE_TOOLS: readonly WorkspaceTool[] = WORKSPACE_GROUPS.flatMap((group) =>
  group.views.map((view) => {
    const nav = NAV_BY_ID.get(view);
    const route = resolveViewRoute(view);
    return {
      view,
      label: nav?.label ?? view,
      hint: nav?.hint ?? '',
      group: group.id,
      canonicalView: route.view,
      ...(route.editorMode ? { editorMode: route.editorMode } : {}),
      ...(route.hubTab ? { hubTab: route.hubTab } : {}),
    };
  }),
);

export function workspaceToolFor(view: ViewId): WorkspaceTool | undefined {
  return WORKSPACE_TOOLS.find((tool) => tool.view === view);
}

export function workspaceGroupFor(view: ViewId): WorkspaceGroup | undefined {
  return WORKSPACE_GROUPS.find((group) => group.views.includes(view));
}

/** Primera etapa sin completar, o `null` si el recorrido terminó. */
export function currentWorkspaceStep(progress: PipelineProgress): WorkspaceStep | null {
  const id = progress.next?.id;
  return id ? WORKSPACE_STEPS.find((step) => step.id === id) ?? null : null;
}

export function workspaceStepForView(view: ViewId): WorkspaceStep | undefined {
  return WORKSPACE_STEPS.find((step) => step.view === view);
}
