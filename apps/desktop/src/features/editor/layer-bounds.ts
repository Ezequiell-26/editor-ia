/**
 * Límites REALES de una capa de la timeline y escritura de su transformación.
 *
 * Hasta aquí `boxRect()` derivaba la caja de `project.video.width/height`, así
 * que cualquier capa seleccionada mostraba el fotograma completo. Este módulo
 * mide el elemento vivo (las palabras de un subtítulo, el layer de un clip) y
 * convierte ese rect a coordenadas del lienzo, sin tocar el esquema: los cues
 * ya tienen `offsetX/offsetY` y `motion.keyframes` para escala/rotación.
 *
 * Puro: no importa React ni el store; se prueba con números.
 */
import type {
  CaptionCue,
  CaptionMotion,
  CaptionMotionKeyframe,
  ProjectDocument,
} from '@editor-ia/project-schema';
import type { CaptionMotionValues } from '../../state/caption-motion';
import type { BoxRect, BoxTransform } from './transform-overlay';

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ElementMeasurement {
  /** AABB ya transformado (incluye scale/rotate/translate). */
  readonly rect: RectLike;
  /** Tamaño de layout, SIN transform. */
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

export const CUE_SCALE_MIN = 0.2;
export const CUE_SCALE_MAX = 4;

/**
 * Convierte una medición del DOM en una caja dibujable.
 *
 * El centro sale del AABB medido (donde realmente están las palabras), pero el
 * tamaño sale de `offsetWidth/Height` multiplicado por la escala: si se usara
 * el AABB de un elemento rotado, la caja (que además aplica `rotate()`) quedaría
 * sobredimensionada dos veces.
 */
export function boundsFromMeasurement(
  canvasRect: { readonly left: number; readonly top: number },
  element: ElementMeasurement,
  scaleX: number,
  scaleY: number,
  rotationDeg: number,
): BoxRect {
  const cx = element.rect.left + element.rect.width / 2 - canvasRect.left;
  const cy = element.rect.top + element.rect.height / 2 - canvasRect.top;
  return {
    cx,
    cy,
    width: Math.max(1, element.offsetWidth * scaleX),
    height: Math.max(1, element.offsetHeight * scaleY),
    rotationDeg,
  };
}

/** Transformación efectiva de un cue, en las mismas unidades que un clip. */
export function cueBoxTransform(
  cue: CaptionCue,
  motion: CaptionMotionValues | null,
): BoxTransform {
  return {
    offsetX: cue.offsetX ?? 0,
    offsetY: cue.offsetY ?? 0,
    // El esquema de motion tiene un único `scale` uniforme: se replica en X/Y.
    scaleX: motion?.scale ?? 1,
    scaleY: motion?.scale ?? 1,
    rotationDeg: motion?.rotationDeg ?? 0,
    opacity: motion?.opacity ?? 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Dos keyframes con el MISMO valor → `captionMotionAt` devuelve un valor constante. */
export function cueMotionKeyframes(
  cue: CaptionCue,
  values: { readonly scale: number; readonly rotationDeg: number; readonly opacity: number },
): CaptionMotion {
  const lastFrame = Math.max(1, Math.round(cue.endFrame - cue.startFrame));
  const common: Omit<CaptionMotionKeyframe, 'frame'> = {
    x: 0,
    y: 0,
    scale: Math.round(clamp(values.scale, CUE_SCALE_MIN, CUE_SCALE_MAX) * 1000) / 1000,
    rotationDeg: Math.round(clamp(values.rotationDeg, -180, 180) * 10) / 10,
    opacity: clamp(values.opacity, 0, 1),
  };
  return {
    keyframes: [
      { frame: 0, ...common },
      { frame: lastFrame, ...common },
    ],
  };
}

/**
 * Escribe un parche de transformación en el cue seleccionado.
 *
 * `offsetX/offsetY` van directo; escala, rotación y opacidad se proyectan a
 * `motion` con dos keyframes válidos. Los valores por defecto se ELIMINAN para
 * no ensuciar el proyecto. Devuelve el mismo objeto si no hay nada que hacer.
 */
export function patchCueTransform(
  project: ProjectDocument,
  cueId: string,
  patch: Partial<BoxTransform>,
): ProjectDocument {
  const cue = project.captions.cues.find((item) => item.id === cueId);
  if (!cue) return project;
  const track = project.timeline.tracks.find((item) => item.id === cue.trackId);
  if (track?.locked) return project;

  const current = cue.motion?.keyframes[0];
  const next: CaptionCue = { ...cue };

  if (patch.offsetX !== undefined) {
    if (patch.offsetX === 0) delete next.offsetX;
    else next.offsetX = Math.round(clamp(patch.offsetX, -10_000, 10_000));
  }
  if (patch.offsetY !== undefined) {
    if (patch.offsetY === 0) delete next.offsetY;
    else next.offsetY = Math.round(clamp(patch.offsetY, -10_000, 10_000));
  }

  // Motion es uniforme: ante un parche de dos ejes se toma X y se documenta.
  const scale = patch.scaleX ?? patch.scaleY ?? current?.scale ?? 1;
  const rotationDeg = patch.rotationDeg ?? current?.rotationDeg ?? 0;
  const opacity = patch.opacity ?? current?.opacity ?? 1;
  const isDefault =
    Math.abs(scale - 1) < 0.001 &&
    Math.abs(rotationDeg) < 0.05 &&
    Math.abs(opacity - 1) < 0.001;
  if (isDefault) delete next.motion;
  else next.motion = cueMotionKeyframes(cue, { scale, rotationDeg, opacity });

  return {
    ...project,
    captions: {
      ...project.captions,
      cues: project.captions.cues.map((item) => (item.id === cueId ? next : item)),
    },
  };
}

/** Busca la capa por atributo sin depender de `CSS.escape` (jsdom no lo tiene). */
export function findLayerElement(
  canvas: HTMLElement,
  attribute: 'data-clip-id' | 'data-cue-content',
  id: string,
): HTMLElement | null {
  const nodes = canvas.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const node of nodes) {
    if (node.getAttribute(attribute) === id) return node;
  }
  return null;
}

export function measureElement(
  canvas: HTMLElement,
  element: HTMLElement,
  transform: Pick<BoxTransform, 'scaleX' | 'scaleY' | 'rotationDeg'>,
): BoxRect | null {
  const canvasRect = canvas.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return boundsFromMeasurement(
    { left: canvasRect.left, top: canvasRect.top },
    {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
    },
    transform.scaleX,
    transform.scaleY,
    transform.rotationDeg,
  );
}
