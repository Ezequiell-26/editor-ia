/**
 * Smart Engine Router: decide con qué motor disponible se resuelve una escena
 * o un clip, mirando el proyecto real y sin inventar capacidades.
 *
 * Un motor pedido que todavía no existe devuelve `blocked` con la razón; el
 * router nunca elige un motor `planned` como si estuviera listo.
 */
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';

export type EngineId =
  | 'ken-burns'
  | 'parallax'
  | 'motion-graphics'
  | 'lottie'
  | 'rig'
  | 'three'
  | 'face-tracking'
  | 'object-tracking'
  | 'effects'
  | 'transition';

export type EngineStatus = 'available' | 'partial' | 'planned' | 'blocked';

export interface EngineCapability {
  readonly id: EngineId;
  readonly phase: number;
  readonly status: EngineStatus;
  readonly summary: string;
  readonly supports: readonly Clip['kind'][];
  readonly note?: string;
}

export const ENGINES: readonly EngineCapability[] = [
  {
    id: 'ken-burns',
    phase: 4,
    status: 'available',
    summary: 'Zoom y paneo progresivo sobre imágenes o video (presets de ClipMotion).',
    supports: ['image', 'video'],
  },
  {
    id: 'parallax',
    phase: 4,
    status: 'partial',
    summary: 'Presets 2.5D de dos capas (fondo y recorte) con movimiento relativo.',
    supports: ['image', 'video'],
    note: 'El recorte lo aporta el usuario; no hay mapa de profundidad ni segmentación automática.',
  },
  {
    id: 'motion-graphics',
    phase: 6,
    status: 'available',
    summary: 'Plantillas de títulos y gráficos con ASS determinista en la exportación.',
    supports: ['graphic'],
  },
  {
    id: 'lottie',
    phase: 3,
    status: 'partial',
    summary: 'Lottie/dotLottie en la biblioteca y previews; no es un clip de timeline completo.',
    supports: ['graphic'],
  },
  {
    id: 'rig',
    phase: 3,
    status: 'partial',
    summary: 'Personaje stickman con esqueleto procedural y 5 ciclos horneados a MP4.',
    supports: ['video'],
    note: 'Sin rigs importados, IK ni retargeting; el clip entra a Medios.',
  },
  {
    id: 'three',
    phase: 5,
    status: 'partial',
    summary: 'Escenas Three.js horneadas a MP4 VP9 con WebCodecs.',
    supports: ['video', 'image', 'graphic'],
    note: 'Acepta glTF/GLB con su primer clip de animación; sin alpha ni render 3D en vivo, se hornea a Medios.',
  },
  {
    id: 'face-tracking',
    phase: 9,
    status: 'partial',
    summary: 'Detección y seguimiento facial SeetaFace con máscaras VFX.',
    supports: ['video'],
    note: 'No hay tracking de objetos ni pose.',
  },
  {
    id: 'object-tracking',
    phase: 9,
    status: 'partial',
    summary: 'Seguimiento de punto o caja (NCC) sobre frames extraídos por FFmpeg.',
    supports: ['video'],
    note: 'Sin detección semántica de objetos ni estimación de pose; la caja la define el usuario.',
  },
  {
    id: 'effects',
    phase: 8,
    status: 'available',
    summary: 'Catálogo de 21 efectos con preview WebGL y paridad de export.',
    supports: ['video', 'image', 'graphic', 'adjustment'],
  },
  {
    id: 'transition',
    phase: 8,
    status: 'available',
    summary: '12 transiciones con preview en vivo y render FFmpeg.',
    supports: ['video', 'image', 'graphic'],
  },
];

export type ResolutionStatus = 'ready' | 'partial' | 'needs-input' | 'blocked';

export interface EngineResolution {
  readonly target: { readonly kind: 'scene' | 'clip'; readonly id: string; readonly title?: string };
  readonly status: ResolutionStatus;
  readonly engine: EngineId | null;
  readonly supporting: readonly EngineId[];
  readonly rationale: string;
  readonly blocked: readonly { readonly engine: EngineId; readonly reason: string }[];
  readonly clips: readonly { readonly id: string; readonly kind: Clip['kind']; readonly label: string }[];
}

function capability(id: EngineId): EngineCapability | undefined {
  return ENGINES.find((engine) => engine.id === id);
}

function isUsable(status: EngineStatus): boolean {
  return status === 'available' || status === 'partial';
}

function resolutionStatus(status: EngineStatus): ResolutionStatus {
  return status === 'available' ? 'ready' : 'partial';
}

function hasTransition(clip: Clip): boolean {
  return 'transitionIn' in clip && Boolean(clip.transitionIn);
}

function clipSummary(clip: Clip): { id: string; kind: Clip['kind']; label: string } {
  return { id: clip.id, kind: clip.kind, label: clip.label ?? clip.id };
}

function blockedFor(id: EngineId, clips: readonly Clip[]): EngineResolution['blocked'][number] | null {
  const engine = capability(id);
  if (!engine) {
    return { engine: id, reason: `motor desconocido: ${id}` };
  }
  if (!isUsable(engine.status)) {
    const detail = engine.status === 'planned' ? 'todavía no está implementado' : 'está bloqueado';
    return { engine: id, reason: `${engine.summary} ${detail}${engine.note ? ` (${engine.note})` : ''}` };
  }
  if (clips.length === 0) return null;
  const compatible = clips.some((clip) => engine.supports.includes(clip.kind));
  if (!compatible) {
    return {
      engine: id,
      reason: `el motor no soporta los tipos de clip presentes (${clips.map((clip) => clip.kind).join(', ')})`,
    };
  }
  return null;
}

function autoEngine(clips: readonly Clip[]): {
  engine: EngineId | null;
  supporting: EngineId[];
  rationale: string;
  status: ResolutionStatus;
} {
  const visual = clips.filter((clip) => clip.kind !== 'audio');
  if (visual.length === 0) {
    return {
      engine: null,
      supporting: [],
      rationale: 'La escena no tiene clips visuales; asigná un clip o narración visual.',
      status: 'needs-input',
    };
  }
  const graphic = visual.find((clip) => clip.kind === 'graphic');
  if (graphic) {
    const supporting: EngineId[] = [];
    if (visual.some(hasTransition)) supporting.push('transition');
    return {
      engine: 'motion-graphics',
      supporting,
      rationale: `La escena contiene el gráfico “${graphic.label}”; se resuelve con las plantillas de motion graphics.`,
      status: 'ready',
    };
  }
  const image = visual.find((clip) => clip.kind === 'image');
  if (image) {
    const hasMotion = visual.some((clip) => clip.kind === 'image' && clip.motion);
    const supporting: EngineId[] = [];
    if (visual.some(hasTransition)) supporting.push('transition');
    return {
      engine: 'ken-burns',
      supporting,
      rationale: hasMotion
        ? `La imagen “${image.label}” ya tiene movimiento; se mantiene Ken Burns.`
        : `La escena es una imagen fija (“${image.label}”); conviene Ken Burns antes que un gráfico.`,
      status: 'ready',
    };
  }
  const supporting: EngineId[] = ['effects'];
  if (visual.some(hasTransition)) supporting.push('transition');
  return {
    engine: 'effects',
    supporting,
    rationale:
      'La escena es video; el motor base es efectos (grade/LUT/denoise) y las transiciones ya existen.',
    status: 'ready',
  };
}

function buildResolution(
  target: EngineResolution['target'],
  clips: readonly Clip[],
  request?: EngineId,
): EngineResolution {
  if (request) {
    const engine = capability(request);
    if (!engine) {
      return {
        target,
        status: 'blocked',
        engine: null,
        supporting: [],
        rationale: `No existe el motor “${request}”.`,
        blocked: [{ engine: request, reason: 'motor desconocido' }],
        clips: clips.map(clipSummary),
      };
    }
    const blocked = blockedFor(request, clips);
    if (blocked) {
      return {
        target,
        status: 'blocked',
        engine: null,
        supporting: [],
        rationale: `El motor pedido no puede resolver esta escena: ${blocked.reason}`,
        blocked: [blocked],
        clips: clips.map(clipSummary),
      };
    }
    return {
      target,
      status: resolutionStatus(engine.status),
      engine: request,
      supporting: [],
      rationale: `${engine.summary}${engine.status === 'partial' ? ' (capacidad parcial)' : ''}`,
      blocked: [],
      clips: clips.map(clipSummary),
    };
  }
  const automatic = autoEngine(clips);
  return {
    target,
    status: automatic.status,
    engine: automatic.engine,
    supporting: automatic.supporting,
    rationale: automatic.rationale,
    blocked: [],
    clips: clips.map(clipSummary),
  };
}

export function resolveClip(
  project: ProjectDocument,
  clipId: string,
  options: { request?: EngineId } = {},
): EngineResolution {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new Error(`no existe el clip ${clipId}`);
  }
  return buildResolution(
    clip.label
      ? { kind: 'clip', id: clip.id, title: clip.label }
      : { kind: 'clip', id: clip.id },
    [clip],
    options.request,
  );
}

export function resolveScene(
  project: ProjectDocument,
  sceneId: string,
  options: { request?: EngineId } = {},
): EngineResolution {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new Error(`no existe la escena ${sceneId}`);
  }
  const clips = scene.clipIds
    .map((id) => project.timeline.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => Boolean(clip));
  return buildResolution(
    { kind: 'scene', id: scene.id, title: scene.title },
    clips,
    options.request,
  );
}

export function engineCatalog(): EngineCapability[] {
  return ENGINES.map((engine) => ({ ...engine, supports: [...engine.supports] }));
}
