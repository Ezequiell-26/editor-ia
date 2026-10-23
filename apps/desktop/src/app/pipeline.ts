/**
 * Ruta de producción de la app.
 *
 * Es el orden en el que se hace un video de punta a punta: proyecto → guion →
 * medios → voz → edición → exportación. Cada etapa sabe en qué vista se trabaja
 * y cómo se reconoce que está hecha, para que la interfaz pueda decir siempre
 * cuál es el siguiente paso sin que el usuario tenga que adivinarlo.
 *
 * El avance se calcula desde el propio proyecto (escenas, medios, clips). La
 * única señal que no vive en el `.editoria.json` es “ya se exportó”: se guarda
 * por proyecto en `localStorage` porque no forma parte del documento.
 */

import type { ProjectDocument } from '@editor-ia/project-schema';
import type { IconName } from '../components/Icon';
import type { ViewId } from './navigation';

export const PIPELINE_STORAGE_KEY = 'editoria.pipeline.v1';
const MAX_FLAGS = 60;

export type PipelineStageId = 'project' | 'script' | 'media' | 'voice' | 'edit' | 'export';

export interface PipelineStage {
  readonly id: PipelineStageId;
  readonly label: string;
  /** Qué se hace en esta etapa, en una línea. */
  readonly action: string;
  /** Dónde se trabaja. */
  readonly view: ViewId;
  readonly icon: IconName;
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: 'project',
    label: 'Proyecto',
    action: 'Creá el proyecto con su formato, o abrí uno de los recientes.',
    view: 'projects',
    icon: 'projects',
  },
  {
    id: 'script',
    label: 'Guion',
    action: 'Escribí las escenas y su narración con el asistente o a mano.',
    view: 'script',
    icon: 'script',
  },
  {
    id: 'media',
    label: 'Medios',
    action: 'Sumá imágenes y videos: importalos, descargalos de la web o generalos con Flow.',
    view: 'assets',
    icon: 'assets',
  },
  {
    id: 'voice',
    label: 'Voz',
    action: 'Sintetizá la narración de cada escena y confirmá los derechos del audio.',
    view: 'production',
    icon: 'audio',
  },
  {
    id: 'edit',
    label: 'Edición',
    action: 'Montá los clips en la timeline, ajustá el ritmo y los subtítulos.',
    view: 'editor',
    icon: 'editor',
  },
  {
    id: 'export',
    label: 'Exportar',
    action: 'Renderizá el MP4 con un perfil, revisá el resultado y guardá la entrega.',
    view: 'production',
    icon: 'export',
  },
];

export type StageState = 'done' | 'current' | 'pending';

export interface PipelineSignals {
  readonly hasProject: boolean;
  readonly scenes: number;
  readonly media: number;
  readonly audio: number;
  readonly clips: number;
  readonly exported: boolean;
}

export interface PipelineStepState {
  readonly stage: PipelineStage;
  readonly state: StageState;
  readonly detail: string;
}

export interface PipelineProgress {
  readonly steps: readonly PipelineStepState[];
  readonly currentIndex: number;
  readonly doneCount: number;
  readonly total: number;
  readonly percent: number;
  readonly next: PipelineStage | null;
  /** `true` cuando las seis etapas están completas. */
  readonly complete: boolean;
}

/** Cuenta lo que el proyecto ya tiene, sin mirar la interfaz. */
export function pipelineSignals(
  project: ProjectDocument | null,
  exported: boolean,
): PipelineSignals {
  if (!project) {
    return { hasProject: false, scenes: 0, media: 0, audio: 0, clips: 0, exported: false };
  }
  const media = project.assets.filter(
    (asset) => asset.kind === 'image' || asset.kind === 'video',
  ).length;
  const audio = project.assets.filter((asset) => asset.kind === 'audio').length;
  return {
    hasProject: true,
    scenes: project.scenes.length,
    media,
    audio,
    clips: project.timeline.clips.length,
    exported,
  };
}

function detailFor(id: PipelineStageId, signals: PipelineSignals): string {
  switch (id) {
    case 'project':
      return signals.hasProject ? 'Proyecto abierto' : 'Sin proyecto';
    case 'script':
      return signals.scenes > 0 ? plural(signals.scenes, 'escena', 'escenas') : 'Sin escenas';
    case 'media':
      return signals.media > 0 ? plural(signals.media, 'medio', 'medios') : 'Sin medios';
    case 'voice':
      return signals.audio > 0 ? plural(signals.audio, 'audio', 'audios') : 'Sin narración';
    case 'edit':
      return signals.clips > 0 ? plural(signals.clips, 'clip', 'clips') : 'Timeline vacía';
    case 'export':
      return signals.exported ? 'Render completado' : 'Sin render';
  }
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function doneFor(id: PipelineStageId, signals: PipelineSignals): boolean {
  switch (id) {
    case 'project':
      return signals.hasProject;
    case 'script':
      return signals.scenes > 0;
    case 'media':
      return signals.media > 0;
    case 'voice':
      return signals.audio > 0;
    case 'edit':
      return signals.clips > 0;
    case 'export':
      return signals.exported;
  }
}

/**
 * Estado de cada etapa.
 *
 * La primera etapa sin completar es la actual, aunque más adelante haya trabajo
 * hecho: si alguien importó clips sin escribir el guion, la ruta sigue señalando
 * el guion en lugar de dar todo por terminado.
 */
export function computePipeline(signals: PipelineSignals): PipelineProgress {
  const flags = PIPELINE_STAGES.map((stage) => doneFor(stage.id, signals));
  const firstPending = flags.findIndex((done) => !done);
  const currentIndex = firstPending;
  const doneCount = flags.filter(Boolean).length;

  const steps = PIPELINE_STAGES.map((stage, index) => ({
    stage,
    state: flags[index]
      ? ('done' as const)
      : index === currentIndex
        ? ('current' as const)
        : ('pending' as const),
    detail: detailFor(stage.id, signals),
  }));

  const nextStage = currentIndex >= 0 ? PIPELINE_STAGES[currentIndex] ?? null : null;

  return {
    steps,
    currentIndex,
    doneCount,
    total: PIPELINE_STAGES.length,
    percent: Math.round((doneCount / PIPELINE_STAGES.length) * 100),
    next: nextStage,
    complete: currentIndex < 0,
  };
}

// ---------------------------------------------------------------------------
// “Ya se exportó” por proyecto
// ---------------------------------------------------------------------------

type Flags = Record<string, string>;

/** Lo mínimo que hace falta para leer y escribir el registro. */
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readFlags(store: Store | null = storage()): Flags {
  if (!store) return {};
  try {
    const text = store.getItem(PIPELINE_STORAGE_KEY);
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const flags: Flags = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') flags[key] = value;
    }
    return flags;
  } catch {
    return {};
  }
}

export function isProjectExported(
  projectId: string | null | undefined,
  store: Store | null = storage(),
): boolean {
  if (!projectId) return false;
  return Boolean(readFlags(store)[projectId]);
}

/** Marca el proyecto como exportado. Devuelve `false` si no se pudo guardar. */
export function markProjectExported(
  projectId: string,
  at: string = new Date().toISOString(),
  store: Store | null = storage(),
): boolean {
  if (!store) return false;
  const flags = readFlags(store);
  flags[projectId] = at;
  const entries = Object.entries(flags)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, MAX_FLAGS);
  try {
    store.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    return false;
  }
}

export function clearProjectExported(projectId: string, store: Store | null = storage()): void {
  if (!store) return;
  const flags = readFlags(store);
  delete flags[projectId];
  try {
    store.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // sin almacenamiento no hay nada que limpiar
  }
}
