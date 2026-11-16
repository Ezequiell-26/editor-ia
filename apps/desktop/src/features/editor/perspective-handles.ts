import type { PerspectiveCorner } from '@editor-ia/project-schema';
import { fittedContentBox, type PerspectiveViewport } from './perspective';
import type { BoxTransform, CanvasSize, ProjectSize } from './transform-overlay';

/**
 * Geometría de los tiradores de perspectiva (`transform.perspective`).
 *
 * Las esquinas están normalizadas al content-box `object-fit: contain` del
 * clip (ver `perspectiveMatrix3d`). Los tiradores se dibujan en coordenadas
 * del lienzo aplicando la misma cadena 2D que la capa (translate → scale →
 * rotate sobre el centro del elemento), sin la matriz perspectiva: el quad
 * que se edita es el de origen, no el ya deformado.
 */

export type QuadPoint = readonly [number, number];

const ORIGIN = (canvas: CanvasSize): QuadPoint => [canvas.width / 2, canvas.height / 2];

function contentBox(canvas: CanvasSize, viewport: PerspectiveViewport) {
  return fittedContentBox({
    width: canvas.width,
    height: canvas.height,
    ...(viewport.mediaWidth !== undefined ? { mediaWidth: viewport.mediaWidth } : {}),
    ...(viewport.mediaHeight !== undefined ? { mediaHeight: viewport.mediaHeight } : {}),
  });
}

/** translate en px del lienzo: el % de CSS es relativo al tamaño del elemento (= lienzo). */
function offsetPx(transform: BoxTransform, project: ProjectSize, canvas: CanvasSize): QuadPoint {
  const factor = canvas.width / project.width;
  return [transform.offsetX * factor, transform.offsetY * (canvas.height / project.height || factor)];
}

/**
 * Punto local del elemento (px del lienzo) → coordenadas del lienzo,
 * replicando `translate(offset) scale(sx,sy) rotate(θ)` con origen al centro.
 */
export function localToCanvas(
  point: QuadPoint,
  transform: BoxTransform,
  project: ProjectSize,
  canvas: CanvasSize,
): QuadPoint {
  const [ox, oy] = ORIGIN(canvas);
  const [tx, ty] = offsetPx(transform, project, canvas);
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point[0] - ox;
  const dy = point[1] - oy;
  // Orden CSS: rotate → scale → translate (la lista se aplica de derecha a
  // izquierda sobre el punto, con el origen ya descontado).
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return [ox + rx * transform.scaleX + tx, oy + ry * transform.scaleY + ty];
}

/** Inversa de `localToCanvas`: coordenadas del lienzo → px del elemento. */
export function canvasToLocal(
  point: QuadPoint,
  transform: BoxTransform,
  project: ProjectSize,
  canvas: CanvasSize,
): QuadPoint {
  const [ox, oy] = ORIGIN(canvas);
  const [tx, ty] = offsetPx(transform, project, canvas);
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = (point[0] - ox - tx) / transform.scaleX;
  const dy = (point[1] - oy - ty) / transform.scaleY;
  return [ox + dx * cos + dy * sin, oy - dx * sin + dy * cos];
}

/** Posición en el lienzo de cada esquina del quad de perspectiva. */
export function perspectiveHandlePoints(
  corners: readonly PerspectiveCorner[],
  transform: BoxTransform,
  project: ProjectSize,
  canvas: CanvasSize,
  viewport: PerspectiveViewport,
): QuadPoint[] {
  const box = contentBox(canvas, viewport);
  return corners.map((corner) =>
    localToCanvas(
      [box.x + corner.x * box.width, box.y + corner.y * box.height],
      transform,
      project,
      canvas,
    ),
  );
}

/** Esquina normalizada (0..1 del content-box) bajo un punto del lienzo. */
export function canvasToCorner(
  point: QuadPoint,
  transform: BoxTransform,
  project: ProjectSize,
  canvas: CanvasSize,
  viewport: PerspectiveViewport,
): PerspectiveCorner {
  const local = canvasToLocal(point, transform, project, canvas);
  const box = contentBox(canvas, viewport);
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  return {
    x: Math.round(clamp((local[0] - box.x) / box.width) * 1e4) / 1e4,
    y: Math.round(clamp((local[1] - box.y) / box.height) * 1e4) / 1e4,
  };
}

/** Quad trasladado: mueve las 4 esquinas por el mismo delta normalizado. */
export function translateCorners(
  corners: readonly PerspectiveCorner[],
  deltaX: number,
  deltaY: number,
): PerspectiveCorner[] {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  return corners.map((corner) => ({
    x: Math.round(clamp(corner.x + deltaX) * 1e4) / 1e4,
    y: Math.round(clamp(corner.y + deltaY) * 1e4) / 1e4,
  }));
}

function cross(
  a: QuadPoint,
  b: QuadPoint,
  c: QuadPoint,
): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

/**
 * Mismo criterio que `PerspectiveSchema.superRefine`: quad convexo no
 * degenerado con al menos 1% de área, en coords normalizadas del content-box.
 */
export function isValidPerspectiveQuad(corners: readonly PerspectiveCorner[]): boolean {
  if (corners.length !== 4) return false;
  const points = corners.map((corner): QuadPoint => [corner.x, corner.y]);
  const [tl, tr, br, bl] = points as [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
  const area =
    0.5 *
    Math.abs(
      tl[0] * tr[1] -
        tr[0] * tl[1] +
        tr[0] * br[1] -
        br[0] * tr[1] +
        br[0] * bl[1] -
        bl[0] * br[1] +
        bl[0] * tl[1] -
        tl[0] * bl[1],
    );
  if (area < 0.01) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const value = cross(
      points[index]!,
      points[(index + 1) % 4]!,
      points[(index + 2) % 4]!,
    );
    if (Math.abs(value) < 1e-9) continue;
    const current = Math.sign(value);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}
