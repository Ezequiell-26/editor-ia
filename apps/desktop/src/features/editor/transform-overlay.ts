/**
 * Geometría de la caja de transformación de la vista previa.
 *
 * Todo se calcula en píxeles de pantalla (los del lienzo) y se convierte a
 * píxeles del proyecto sólo al escribir: así el mismo código funciona con
 * cualquier zoom o tamaño de ventana.
 *
 * Módulo puro: no toca React ni el store, para poder probarlo con números.
 */

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface ProjectSize {
  readonly width: number;
  readonly height: number;
}

/** Valores efectivos de transformación de un clip (sin animaciones de entrada). */
export interface BoxTransform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number;
}

/** Caja en coordenadas del lienzo, con centro y rotación. */
export interface BoxRect {
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
/** Imán al centro, en píxeles del proyecto. */
export const SNAP_PX = 8;

export function scaleFactor(canvas: CanvasSize, project: ProjectSize): number {
  if (project.width <= 0 || canvas.width <= 0) return 1;
  return canvas.width / project.width;
}

export function boxRect(
  transform: BoxTransform,
  project: ProjectSize,
  canvas: CanvasSize,
): BoxRect {
  const factor = scaleFactor(canvas, project);
  return {
    cx: canvas.width / 2 + transform.offsetX * factor,
    cy: canvas.height / 2 + transform.offsetY * factor,
    width: project.width * transform.scaleX * factor,
    height: project.height * transform.scaleY * factor,
    rotationDeg: transform.rotationDeg,
  };
}

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

/** Desplazamiento del cuerpo de la caja, en píxeles del proyecto. */
export function movePatch(
  start: BoxTransform,
  deltaScreen: { readonly x: number; readonly y: number },
  project: ProjectSize,
  canvas: CanvasSize,
  snap = true,
): Pick<BoxTransform, 'offsetX' | 'offsetY'> {
  const factor = scaleFactor(canvas, project) || 1;
  let offsetX = start.offsetX + deltaScreen.x / factor;
  let offsetY = start.offsetY + deltaScreen.y / factor;
  if (snap) {
    if (Math.abs(offsetX) <= SNAP_PX) offsetX = 0;
    if (Math.abs(offsetY) <= SNAP_PX) offsetY = 0;
  }
  // El centro puede salir del cuadro, pero no perderse a lo lejos.
  const limitX = project.width;
  const limitY = project.height;
  return {
    offsetX: Math.round(Math.max(-limitX, Math.min(limitX, offsetX))),
    offsetY: Math.round(Math.max(-limitY, Math.min(limitY, offsetY))),
  };
}

/** Escala proporcional tomando como referencia la distancia al centro. */
export function scalePatch(
  start: BoxTransform,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
): Pick<BoxTransform, 'scaleX' | 'scaleY'> {
  const startDistance = Math.hypot(from.x - center.x, from.y - center.y);
  const nextDistance = Math.hypot(to.x - center.x, to.y - center.y);
  if (startDistance < 1) {
    return { scaleX: start.scaleX, scaleY: start.scaleY };
  }
  const ratio = nextDistance / startDistance;
  return {
    scaleX: Math.round(clampScale(start.scaleX * ratio) * 1000) / 1000,
    scaleY: Math.round(clampScale(start.scaleY * ratio) * 1000) / 1000,
  };
}

/** Rotación en grados a partir del ángulo puntero-centro. */
export function rotatePatch(
  start: BoxTransform,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  shiftKey = false,
): Pick<BoxTransform, 'rotationDeg'> {
  const angleOf = (point: { x: number; y: number }): number =>
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
  let rotation = start.rotationDeg + (angleOf(to) - angleOf(from));
  // Normaliza a (-180, 180] para que el número no crezca sin sentido.
  rotation = ((rotation + 180) % 360 + 360) % 360 - 180;
  if (shiftKey) {
    rotation = Math.round(rotation / 15) * 15;
  }
  return { rotationDeg: Math.round(rotation * 10) / 10 };
}

/** Vuelve al encuadre original: centrado, escala 1 y sin rotación. */
export function resetPatch(): BoxTransform {
  return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 };
}
