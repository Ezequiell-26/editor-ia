/**
 * Cálculos puros de virtualización del timeline.
 *
 * En proyectos largos (12k frames, decenas de medios) renderizar todos los
 * clips y pistas cuesta caro: la lista visible se calcula desde el scroll del
 * contenedor y el zoom. La regla es conservadora:
 *
 * - si el contenedor no tiene tamaño medible (SSR/jsdom/tests con
 *   `clientWidth = 0`), NO se virtualiza: se devuelve `null` y se renderiza todo
 *   para no romper contratos ni tests;
 * - si lo tiene, la ventana incluye un overscan de un viewport a cada lado,
 *   para que el scroll no muestre huecos y el drag siga teniendo margen.
 */

export interface FrameWindow {
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface TrackWindow {
  /** Índice de la primera pista a renderizar. */
  readonly first: number;
  /** Índice (exclusivo) de la última pista a renderizar. */
  readonly last: number;
  /** Alto de las pistas ocultas arriba (para el spacer). */
  readonly topPad: number;
  /** Alto de las pistas ocultas abajo (para el spacer). */
  readonly bottomPad: number;
}

/** Ventana de frames visibles, o `null` si no hay layout medible. */
export function visibleFrameWindow(
  scrollLeft: number,
  clientWidth: number,
  pxPerFrame: number,
  headerWidth: number,
  overscanViewports = 1,
): FrameWindow | null {
  if (!Number.isFinite(clientWidth) || clientWidth <= 0) return null;
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= 0) return null;
  const contentLeft = Math.max(0, scrollLeft - headerWidth);
  const overscan = clientWidth * Math.max(0, overscanViewports);
  const startFrame = Math.max(0, (contentLeft - overscan) / pxPerFrame);
  const endFrame = Math.max(0, (contentLeft + clientWidth + overscan) / pxPerFrame);
  return { startFrame, endFrame };
}

/** ¿El clip (o cue) intersecta la ventana de frames? */
export function spanIntersectsWindow(
  startFrame: number,
  durationFrames: number,
  window: FrameWindow | null,
): boolean {
  if (!window) return true;
  const end = startFrame + Math.max(1, durationFrames);
  return startFrame < window.endFrame && end > window.startFrame;
}

/** Ventana de filas visibles + padding para conservar el alto del scroll. */
export function visibleTrackWindow(
  scrollTop: number,
  clientHeight: number,
  heights: readonly number[],
  overscanPx = 180,
): TrackWindow | null {
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return null;
  if (heights.length === 0) return null;
  let first = 0;
  let topPad = 0;
  while (first < heights.length - 1 && topPad + heights[first]! <= scrollTop - overscanPx) {
    topPad += heights[first]!;
    first += 1;
  }
  let last = first;
  let visible = 0;
  const target = clientHeight + overscanPx * 2;
  while (last < heights.length && visible < target) {
    visible += heights[last]!;
    last += 1;
  }
  let bottomPad = 0;
  for (let index = last; index < heights.length; index += 1) {
    bottomPad += heights[index]!;
  }
  return { first, last, topPad, bottomPad };
}
