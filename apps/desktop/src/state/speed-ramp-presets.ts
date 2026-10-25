import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  setClipSpeed,
  splitClipAtFrames,
  updateClip,
} from './project-actions';

/**
 * Presets de rampa de velocidad (estilo CapCut) para el Inspector.
 *
 * El schema guarda UNA velocidad constante por clip (`speed` en los clips de
 * video y audio, con el invariante `durationFrames x speed.num =
 * sourceFrames x speed.den`), así que una rampa no es un dato del proyecto:
 * es la acción de reemplazar un clip por varios tramos contiguos, cada uno con
 * su velocidad constante. Es la misma mecánica de `applySpeedRamp` (3 tramos)
 * y `applySpeedCurve` (N tramos suaves).
 *
 * Cada preset describe tramos como `{ velocidad, hasta }`, donde `hasta` es la
 * fracción acumulada de la duración ORIGINAL del clip en la que termina el
 * tramo. El aplicador traduce esos tramos usando sólo acciones existentes:
 * `splitClipAtFrames` corta el clip en los límites de cada tramo y
 * `setClipSpeed` les aplica la velocidad prescripta, igual que el control de
 * velocidad del Inspector. Por eso los tramos lentos ocupan más tiempo en la
 * pista y los clips siguientes se desplazan, tal como documenta ese control.
 */

/** Límites de velocidad que imponen las acciones existentes (0.1x a 4x). */
export const MIN_RAMP_SPEED = 0.1;
export const MAX_RAMP_SPEED = 4;

/** Mínimo de frames por tramo: un tramo de un solo frame no tiene sentido. */
export const MIN_SEGMENT_FRAMES = 2;

/** Un tramo del rampa: velocidad constante hasta esa fracción de la duración. */
export interface SpeedRampSegment {
  /** Velocidad de reproducción del tramo, en múltiplos (entre 0.1 y 4). */
  readonly velocidad: number;
  /** Fracción acumulada de la duración del clip donde termina el tramo (0..1]. */
  readonly hasta: number;
}

export type SpeedRampPresetId =
  | 'heroe'
  | 'montaje-ritmico'
  | 'congela-y-sigue'
  | 'entrada-lenta'
  | 'salida-rapida'
  | 'tiempo-bala';

export interface SpeedRampPreset {
  readonly id: SpeedRampPresetId;
  /** Etiqueta visible del botón, en español. */
  readonly nombre: string;
  /** Qué hace el preset, para el tooltip y los avisos. */
  readonly descripcion: string;
  /** Tramos en orden; el último debe cerrar en `hasta: 1`. */
  readonly tramos: readonly SpeedRampSegment[];
}

/** Presets de rampa listos para aplicar, en el orden en que se muestran. */
export const SPEED_RAMP_PRESETS: readonly SpeedRampPreset[] = [
  {
    id: 'heroe',
    nombre: 'Héroe',
    descripcion:
      'Arranca en cámara lenta (0.5×), acelera al máximo (2×) y cierra a 1×. El clásico énfasis de apertura.',
    tramos: [
      { velocidad: 0.5, hasta: 1 / 3 },
      { velocidad: 2, hasta: 2 / 3 },
      { velocidad: 1, hasta: 1 },
    ],
  },
  {
    id: 'montaje-ritmico',
    nombre: 'Montaje rítmico',
    descripcion:
      'Pulsos alternados de 1× y 1.5× en cuatro cuartos, para cortar al compás de la música.',
    tramos: [
      { velocidad: 1, hasta: 0.25 },
      { velocidad: 1.5, hasta: 0.5 },
      { velocidad: 1, hasta: 0.75 },
      { velocidad: 1.5, hasta: 1 },
    ],
  },
  {
    id: 'congela-y-sigue',
    nombre: 'Congela y sigue',
    descripcion:
      'Un instante casi congelado (0.1×) y el resto a 1×: estira el momento clave y reanuda la acción.',
    tramos: [
      { velocidad: 0.1, hasta: 0.05 },
      { velocidad: 1, hasta: 1 },
    ],
  },
  {
    id: 'entrada-lenta',
    nombre: 'Entrada lenta',
    descripcion: 'Entra en cámara lenta (0.5×) durante la mitad y termina a velocidad normal.',
    tramos: [
      { velocidad: 0.5, hasta: 0.5 },
      { velocidad: 1, hasta: 1 },
    ],
  },
  {
    id: 'salida-rapida',
    nombre: 'Salida rápida',
    descripcion: 'Mantiene 1× y acelera el final a 3× para que el clip cierre con energía.',
    tramos: [
      { velocidad: 1, hasta: 0.6 },
      { velocidad: 3, hasta: 1 },
    ],
  },
  {
    id: 'tiempo-bala',
    nombre: 'Tiempo bala',
    descripcion:
      'Entra veloz (1.5×), clava el momento en cámara lenta (0.25×) y sale veloz (1.5×).',
    tramos: [
      { velocidad: 1.5, hasta: 0.35 },
      { velocidad: 0.25, hasta: 0.65 },
      { velocidad: 1.5, hasta: 1 },
    ],
  },
];

/**
 * Forma racional exacta de una velocidad, con la misma aritmética de
 * `setClipSpeed` (redondeo a tres decimales y reducción de la fracción). Es la
 * estructura que el schema acepta en `speed` de los clips de video y audio.
 */
export function speedRatioOf(velocidad: number): { num: number; den: number } {
  const rawDen = 1_000;
  const rawNum = Math.max(1, Math.round(velocidad * rawDen));
  const divisor = gcd(rawNum, rawDen);
  return { num: rawNum / divisor, den: rawDen / divisor };
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right > 0) {
    const rest = left % right;
    left = right;
    right = rest;
  }
  return left || 1;
}

/** Valida la forma de un preset antes de aplicarlo; los mensajes van en español. */
function assertValidPreset(preset: SpeedRampPreset): void {
  if (preset.tramos.length === 0) {
    throw new ProjectActionError(`el preset “${preset.nombre}” no tiene tramos`);
  }
  let previous = 0;
  for (const tramo of preset.tramos) {
    if (tramo.hasta <= previous || tramo.hasta > 1) {
      throw new ProjectActionError(
        `los tramos del preset “${preset.nombre}” deben avanzar sin huecos ni solapes hasta 1`,
      );
    }
    if (tramo.velocidad < MIN_RAMP_SPEED || tramo.velocidad > MAX_RAMP_SPEED) {
      throw new ProjectActionError(
        `las velocidades del preset “${preset.nombre}” deben estar entre ${MIN_RAMP_SPEED}x y ${MAX_RAMP_SPEED}x`,
      );
    }
    previous = tramo.hasta;
  }
  if (preset.tramos[preset.tramos.length - 1]!.hasta !== 1) {
    throw new ProjectActionError(
      `el último tramo del preset “${preset.nombre}” debe cerrar en la duración completa del clip`,
    );
  }
}

export interface SpeedRampApplication {
  readonly project: ProjectDocument;
  /** Ids de los tramos resultantes, en orden de reproducción. */
  readonly clipIds: readonly string[];
  /** Velocidad efectiva de cada tramo, leída del proyecto resultante. */
  readonly velocidades: readonly number[];
}

/**
 * Aplica un preset de rampa al clip usando sólo acciones existentes: divide el
 * clip en los límites de cada tramo (`splitClipAtFrames`) y les aplica la
 * velocidad prescripta (`setClipSpeed`), como haría el control de velocidad
 * tramo por tramo. La duración total de la región cambia con las velocidades y
 * el resto de la pista se desplaza, igual que al cambiar la velocidad de un
 * clip entero.
 */
export function applySpeedRampPreset(
  project: ProjectDocument,
  clipId: string,
  preset: SpeedRampPreset,
): SpeedRampApplication {
  assertValidPreset(preset);
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new ProjectActionError('el preset de rampa necesita un clip de video o audio');
  }
  const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar el preset',
    );
  }
  if ('motion' in clip && clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de aplicar el preset; después podés aplicarlo por tramo',
    );
  }
  if ('reverse' in clip && clip.reverse) {
    throw new ProjectActionError(
      'quitá el reverse antes de aplicar el preset; después podés invertir cada tramo',
    );
  }

  const start = clip.startFrame;
  const end = start + clip.durationFrames;
  const cuts: number[] = [];
  for (let index = 0; index < preset.tramos.length - 1; index += 1) {
    const frame = Math.round(start + preset.tramos[index]!.hasta * clip.durationFrames);
    if (frame > start && frame < end && !cuts.includes(frame)) cuts.push(frame);
  }
  const bounds = [start, ...cuts, end];
  const tooShort = bounds.some(
    (bound, index) => index > 0 && bound - bounds[index - 1]! < MIN_SEGMENT_FRAMES,
  );
  if (tooShort || cuts.length !== preset.tramos.length - 1) {
    throw new ProjectActionError(
      `el clip es demasiado corto para el preset “${preset.nombre}”`,
    );
  }

  const split = splitClipAtFrames(project, clipId, cuts);
  if (!split || split.clipIds.length !== preset.tramos.length) {
    throw new ProjectActionError(
      `no se pudo dividir el clip para el preset “${preset.nombre}”`,
    );
  }

  const baseLabel = clip.label ?? 'Clip';
  let current = split.project;
  split.clipIds.forEach((segmentId, index) => {
    current = setClipSpeed(current, segmentId, preset.tramos[index]!.velocidad);
    current = updateClip(current, segmentId, {
      label: `${baseLabel} · ${preset.nombre} ${index + 1}/${preset.tramos.length}`.slice(0, 200),
    });
  });

  const velocidades = split.clipIds.map((segmentId) => {
    const segment = current.timeline.clips.find((item) => item.id === segmentId);
    if (!segment || (segment.kind !== 'video' && segment.kind !== 'audio')) return 1;
    return (segment.speed?.num ?? 1) / (segment.speed?.den ?? 1);
  });
  return { project: current, clipIds: split.clipIds, velocidades };
}
