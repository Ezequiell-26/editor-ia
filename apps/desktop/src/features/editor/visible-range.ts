/**
 * Rango visible de la timeline, en frames.
 *
 * El scroll horizontal de `.timeline-scroll` incluye el ancho del encabezado
 * de pistas (`HEADER`), pero los carriles empiezan después: para convertir
 * píxeles a frames hay que descontarlo. `overscanPx` mantiene montados los
 * clips que entran o salen del borde para que el scroll no parpadee.
 *
 * `end` es exclusivo. Sin ancho de viewport (jsdom, primer render antes de
 * medir) devuelve el rango completo: nunca se oculta material por no haber
 * medido todavía.
 */
export interface VisibleFrameRange {
  readonly start: number;
  readonly end: number;
}

export function visibleFrameRange(input: {
  readonly scrollLeft: number;
  readonly viewportWidth: number;
  readonly pxPerFrame: number;
  readonly headerPx: number;
  readonly overscanPx?: number;
}): VisibleFrameRange {
  const { scrollLeft, viewportWidth, pxPerFrame, headerPx } = input;
  const overscanPx = Math.max(0, input.overscanPx ?? 0);
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= 0) {
    return { start: 0, end: Number.POSITIVE_INFINITY };
  }
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { start: 0, end: Number.POSITIVE_INFINITY };
  }
  const leftPx = Math.max(0, scrollLeft - headerPx - overscanPx);
  const rightPx = Math.max(0, scrollLeft + viewportWidth - headerPx + overscanPx);
  return {
    start: Math.floor(leftPx / pxPerFrame),
    end: Math.max(1, Math.ceil(rightPx / pxPerFrame)),
  };
}

/** ¿Un clip o cue con este inicio y duración toca el rango visible? */
export function frameRangeIsVisible(
  startFrame: number,
  durationFrames: number,
  range: VisibleFrameRange,
): boolean {
  const endFrame = startFrame + Math.max(0, durationFrames);
  return startFrame < range.end && endFrame > range.start;
}
