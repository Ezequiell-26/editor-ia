import type {
  PreviewFrameRequest,
  PreviewFrameResult,
} from '../../services/contracts/media';

/**
 * Pre-calentamiento del caché de «Frame real» (primera rebanada del
 * `agendador.js` de AlaukCut): cada `render_preview_frame` ya cachea por
 * firma en el backend, así que pedir los frames vecinos después de un
 * render deja el paso de ±1/±2 instantáneo. Es best-effort: los fallos se
 * ignoran y `isStale` cancela la cadena cuando llega un render nuevo.
 */

export const PREWARM_RADIUS = 2;

export interface FramePrewarmBounds {
  readonly minFrame: number;
  readonly maxFrame: number;
}

/** Offsets en orden de cercanía: +1, −1, +2, −2… */
export function prewarmOffsets(radius: number = PREWARM_RADIUS): readonly number[] {
  const offsets: number[] = [];
  for (let distance = 1; distance <= radius; distance += 1) {
    offsets.push(distance, -distance);
  }
  return offsets;
}

/**
 * Renderiza los frames vecinos de `request.frame` dentro de `bounds`, en
 * secuencia (cada render es una pasada de FFmpeg; en paralelo saturaría la
 * CPU y robaría tiempo al render que el usuario pidió). `isStale` se
 * consulta antes de cada render: si devuelve true la cadena se corta.
 */
export async function prewarmFramesAround(
  render: (request: PreviewFrameRequest) => Promise<PreviewFrameResult>,
  request: PreviewFrameRequest,
  bounds: FramePrewarmBounds,
  isStale: () => boolean = () => false,
  radius: number = PREWARM_RADIUS,
): Promise<void> {
  for (const offset of prewarmOffsets(radius)) {
    if (isStale()) return;
    const frame = request.frame + offset;
    if (
      !Number.isInteger(frame) ||
      frame < bounds.minFrame ||
      frame > bounds.maxFrame
    ) {
      continue;
    }
    try {
      await render({ ...request, frame });
    } catch {
      // Best-effort: un vecino que falla no invalida los demás.
    }
  }
}
