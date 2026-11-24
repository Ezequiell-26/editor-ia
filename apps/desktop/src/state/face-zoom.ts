import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { cloneProject, touch } from './project-actions-core';
import { setTransformKeyframe } from './keyframe-actions';

/**
 * Coordenadas de objetivo facial o sujeto, normalizadas 0..1 del cuadro.
 */
export interface FaceTarget {
  /** Centro horizontal (0 = izquierda, 0.5 = centro, 1 = derecha). */
  readonly centerX: number;
  /** Centro vertical (0 = arriba, 0.5 = centro, 1 = abajo). */
  readonly centerY: number;
  /** Diámetro aproximado del rostro/sujeto normalizado 0..1. */
  readonly size?: number;
}

/**
 * Heurística por defecto para planos de busto/habla (talking head) en YouTube:
 * En encuadres clásicos (regla de los tercios), la cabeza se ubica centrada
 * horizontalmente y en el tercio superior (~35 % desde arriba).
 */
export const TALKING_HEAD_DEFAULT_FACE: FaceTarget = {
  centerX: 0.5,
  centerY: 0.35,
};

export interface ComputeFaceOffsetOptions {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly face: FaceTarget;
  readonly scale: number;
  /**
   * Posición vertical objetivo donde queremos encuadrar el rostro en pantalla
   * (0..1). Por defecto 0.40 para mantener aire sobre la cabeza (headroom).
   */
  readonly targetY?: number;
  /**
   * Posición horizontal objetivo donde queremos encuadrar el rostro en pantalla
   * (0..1). Por defecto 0.50 (centrado horizontal).
   */
  readonly targetX?: number;
}

export interface FaceCenteredOffsets {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly maxOffsetX: number;
  readonly maxOffsetY: number;
}

export type FaceFramingMode = 'talking-head' | 'face' | 'center';

/**
 * Calcula los offsets de traslación en píxeles enteros (offsetX, offsetY)
 * necesarios para centrar un rostro o sujeto durante un zoom, clampeando
 * rigurosamente para que el fotograma NUNCA desborde el lienzo ni revele
 * barras negras en los laterales.
 */
export function computeFaceCenteredOffsets(
  options: ComputeFaceOffsetOptions,
): FaceCenteredOffsets {
  const { canvasWidth, canvasHeight, face, scale } = options;
  if (scale <= 1 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { offsetX: 0, offsetY: 0, maxOffsetX: 0, maxOffsetY: 0 };
  }

  const targetX = options.targetX ?? 0.5;
  const targetY = options.targetY ?? 0.4;

  // Margen de paneo disponible sin revelar bordes negros
  const maxOffsetX = Math.max(0, Math.floor(((scale - 1) * canvasWidth) / 2));
  const maxOffsetY = Math.max(0, Math.floor(((scale - 1) * canvasHeight) / 2));

  // Con transform: translate(tx, ty) scale(s) centrado en (0.5, 0.5):
  // screenX = s * (face.centerX - 0.5) * canvasWidth + tx
  // Deseamos screenX = (targetX - 0.5) * canvasWidth:
  // tx = ((targetX - 0.5) - s * (face.centerX - 0.5)) * canvasWidth
  const desiredOffsetX =
    (targetX - 0.5 - scale * (face.centerX - 0.5)) * canvasWidth;
  const desiredOffsetY =
    (targetY - 0.5 - scale * (face.centerY - 0.5)) * canvasHeight;

  // Clampear a enteros exactos para respetar el esquema Zod (z.number().int())
  const offsetX = Math.round(
    Math.max(-maxOffsetX, Math.min(maxOffsetX, desiredOffsetX)),
  );
  const offsetY = Math.round(
    Math.max(-maxOffsetY, Math.min(maxOffsetY, desiredOffsetY)),
  );

  return { offsetX, offsetY, maxOffsetX, maxOffsetY };
}

export type FaceZoomStyle = 'punch-in' | 'snap-settle' | 'slow-push';

export interface ApplyFaceZoomOptions {
  readonly clipId: string;
  /** Factor de escala directo (p.ej. 1.25 para 125 % zoom). */
  readonly scale?: number;
  /** Intensidad 0..100 (se mapea a escala ~1.10 a 1.35). */
  readonly zoomStrength?: number;
  /** Coordenadas de rostro detectadas. Si se omite, usa TALKING_HEAD_DEFAULT_FACE. */
  readonly face?: FaceTarget;
  /**
   * Estilo del zoom:
   * - 'punch-in': zoom sostenido estilo jump-cut de YouTube (típico en frases clave).
   * - 'snap-settle': golpe rápido con desaceleración elástica/suave hacia escala normal.
   * - 'slow-push': acercamiento cinemático progresivo hacia el rostro.
   */
  readonly style?: FaceZoomStyle;
  /** Fotogramas de asentamiento para 'snap-settle' (por defecto ~12 frames / 0.4 s). */
  readonly settleFrames?: number;
}

export interface ApplyFaceZoomResult {
  readonly project: ProjectDocument;
  readonly clipId: string;
  readonly peakScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly style: FaceZoomStyle;
}

/**
 * Aplica un zoom inteligente anclado al rostro o sujeto en un clip de video.
 * En lugar de hacer zoom al centro ciego del lienzo (que suele cortar la coronilla
 * o enfocar el pecho), calcula la traslación exacta que mantiene los ojos y rostro
 * en el tercio superior de la composición.
 */
export function applyFaceCenteredZoom(
  project: ProjectDocument,
  options: ApplyFaceZoomOptions,
): ApplyFaceZoomResult {
  const clip = project.timeline.clips.find((c) => c.id === options.clipId);
  if (!clip) {
    throw new Error(`el clip con id "${options.clipId}" no existe en el proyecto`);
  }
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    throw new Error('el zoom facial sólo aplica a clips de video, imagen o freeze');
  }

  const canvasWidth = project.video.width;
  const canvasHeight = project.video.height;
  const face = options.face ?? TALKING_HEAD_DEFAULT_FACE;
  const style = options.style ?? 'punch-in';

  // Determinar escala pico
  let peakScale = 1.2;
  if (options.scale !== undefined && options.scale > 1) {
    peakScale = Math.min(3, Math.max(1.02, options.scale));
  } else if (options.zoomStrength !== undefined) {
    const strength = Math.max(0, Math.min(100, options.zoomStrength));
    peakScale = 1 + 0.06 + (strength / 100) * 0.22; // 1.06 a 1.28
  }

  const { offsetX, offsetY } = computeFaceCenteredOffsets({
    canvasWidth,
    canvasHeight,
    face,
    scale: peakScale,
  });

  const duration = clip.durationFrames;
  if (duration <= 1) {
    return {
      project,
      clipId: clip.id,
      peakScale: 1,
      offsetX: 0,
      offsetY: 0,
      style,
    };
  }

  let next = cloneProject(project);

  if (style === 'punch-in') {
    // Zoom fijo durante todo el corte encuadrando el rostro
    next = setTransformKeyframe(next, clip.id, 0, {
      scale: peakScale,
      offsetX,
      offsetY,
      opacity: 1,
    });
    next = setTransformKeyframe(next, clip.id, duration - 1, {
      scale: peakScale,
      offsetX,
      offsetY,
      opacity: 1,
    });
  } else if (style === 'snap-settle') {
    // Entrada con golpe en el rostro y desaceleración suave
    const settle = Math.min(
      duration - 1,
      Math.max(4, options.settleFrames ?? Math.round(duration * 0.35)),
    );
    next = setTransformKeyframe(next, clip.id, 0, {
      scale: peakScale,
      offsetX,
      offsetY,
      opacity: 1,
      easing: 'ease-out',
    });
    next = setTransformKeyframe(next, clip.id, settle, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
    });
    if (duration - 1 > settle + 4) {
      next = setTransformKeyframe(next, clip.id, duration - 1, {
        scale: 1.03,
        offsetX: Math.round(offsetX * 0.15),
        offsetY: Math.round(offsetY * 0.15),
        opacity: 1,
      });
    }
  } else if (style === 'slow-push') {
    // Acercamiento cinemático gradual hacia el rostro
    next = setTransformKeyframe(next, clip.id, 0, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      easing: 'ease-in-out',
    });
    next = setTransformKeyframe(next, clip.id, duration - 1, {
      scale: peakScale,
      offsetX,
      offsetY,
      opacity: 1,
    });
  }

  touch(next);
  return {
    project: next,
    clipId: clip.id,
    peakScale,
    offsetX,
    offsetY,
    style,
  };
}
