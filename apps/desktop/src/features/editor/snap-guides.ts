/**
 * Guías de alineación de la vista previa.
 *
 * El clip se imanta al centro del cuadro, a los tercios y a los bordes. Las
 * guías se devuelven en píxeles del lienzo para dibujarlas, y el ajuste se
 * aplica al desplazamiento en píxeles del proyecto: el usuario ve una línea y
 * el clip queda exactamente ahí.
 *
 * Módulo puro: sin React ni store, para probarlo con números.
 */

import { SNAP_PX, scaleFactor, type CanvasSize, type ProjectSize } from './transform-overlay';

export interface GuideLine {
  readonly axis: 'x' | 'y';
  /** Posición en píxeles del lienzo. */
  readonly at: number;
  readonly kind: 'center' | 'third' | 'edge';
}

export interface SnapResult {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly guides: readonly GuideLine[];
}

interface Candidate {
  readonly offset: number;
  readonly at: number;
  readonly kind: GuideLine['kind'];
}

/** Candidatos de imán en píxeles del proyecto (relativos al centro). */
export function guideCandidates(project: ProjectSize): {
  readonly x: readonly Candidate[];
  readonly y: readonly Candidate[];
} {
  const halfW = project.width / 2;
  const halfH = project.height / 2;
  return {
    x: [
      { offset: 0, at: project.width / 2, kind: 'center' },
      { offset: -project.width / 6, at: project.width / 3, kind: 'third' },
      { offset: project.width / 6, at: (project.width * 2) / 3, kind: 'third' },
      { offset: -halfW, at: 0, kind: 'edge' },
      { offset: halfW, at: project.width, kind: 'edge' },
    ],
    y: [
      { offset: 0, at: project.height / 2, kind: 'center' },
      { offset: -project.height / 6, at: project.height / 3, kind: 'third' },
      { offset: project.height / 6, at: (project.height * 2) / 3, kind: 'third' },
      { offset: -halfH, at: 0, kind: 'edge' },
      { offset: halfH, at: project.height, kind: 'edge' },
    ],
  };
}

function nearest(
  value: number,
  candidates: readonly Candidate[],
  tolerance: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate.offset);
    if (distance <= tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Ajusta el desplazamiento a la guía más cercana dentro de la tolerancia.
 * La tolerancia se mide en pantalla (SNAP_PX) y se convierte a píxeles del
 * proyecto para que el imán se sienta igual con cualquier zoom.
 */
export function snapMove(
  offsetX: number,
  offsetY: number,
  project: ProjectSize,
  canvas: CanvasSize,
  enabled = true,
): SnapResult {
  if (!enabled) {
    return { offsetX, offsetY, guides: [] };
  }
  const factor = scaleFactor(canvas, project) || 1;
  const tolerance = SNAP_PX / factor;
  const { x, y } = guideCandidates(project);
  const snapX = nearest(offsetX, x, tolerance);
  const snapY = nearest(offsetY, y, tolerance);
  const guides: GuideLine[] = [];
  if (snapX) {
    guides.push({ axis: 'x', at: snapX.at * factor, kind: snapX.kind });
  }
  if (snapY) {
    guides.push({ axis: 'y', at: snapY.at * factor, kind: snapY.kind });
  }
  return {
    offsetX: snapX ? snapX.offset : offsetX,
    offsetY: snapY ? snapY.offset : offsetY,
    guides,
  };
}
