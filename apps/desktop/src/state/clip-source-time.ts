import {
  curveSourceFraction,
  meanSpeedCurve,
  sampleSpeedCurve,
  type Clip,
} from '@editor-ia/project-schema';

/**
 * Mapeo frame local de timeline → frame de fuente, compartido por la preview
 * del monitor y el scope de audio bajo el playhead.
 *
 * Espeja el renderer (`render/ffmpeg.rs`):
 * - `reverse` recorre la ventana de salida al revés antes de buscar fuente
 *   (`reverse`/`areverse` en el grafo).
 * - `speed` constante multiplica el frame local.
 * - `speedCurve` (solo clips de video) consume la fuente según
 *   `curveSourceFraction`, la misma integral que `buildSpeedKnots` usa para
 *   el `setpts` por tramos.
 *
 * `localFrame` puede ser negativo durante el lead de una transición de
 * entrada (la preview monta el clip antes de su `startFrame`); en ese caso el
 * render alimenta fuente previa al `inFrame` a velocidad constante.
 */

export type SpeedCurveMode =
  /** Curva real por frame (lo que hace el render sin transición de entrada). */
  | 'curve'
  /**
   * Media constante de la curva: el render desactiva el `setpts` por tramos
   * cuando hay lead de transición (`curve_setpts` devuelve `None`) y usa la
   * media para todo el clip.
   */
  | 'mean'
  /** Ignora la curva (equivalente a no tenerla). */
  | 'off';

function windowedSource(clip: Clip) {
  return 'inFrame' in clip.source ? clip.source : null;
}

function isReversed(clip: Clip): boolean {
  return 'reverse' in clip && clip.reverse === true;
}

function constantSpeed(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  return speed ? speed.num / Math.max(1, speed.den) : 1;
}

function speedCurveOf(clip: Clip) {
  return clip.kind === 'video' ? clip.speedCurve : undefined;
}

/** Frame de fuente (en frames del proyecto) para un frame local de salida. */
export function clipSourceFrameAtLocal(
  clip: Clip,
  localFrame: number,
  options?: { readonly speedCurve?: SpeedCurveMode },
): number | null {
  const source = windowedSource(clip);
  if (!source) return null;
  const mirrorSpan = clip.durationFrames - 1;
  const local = isReversed(clip) ? mirrorSpan - localFrame : localFrame;
  const curve = speedCurveOf(clip);
  const mode = options?.speedCurve ?? 'curve';
  if (curve && mode !== 'off') {
    if (mode === 'mean') {
      return source.inFrame + local * meanSpeedCurve(curve);
    }
    const output = Math.min(1, Math.max(0, local / Math.max(1, mirrorSpan)));
    return (
      source.inFrame +
      curveSourceFraction(curve, output) * (source.outFrame - source.inFrame)
    );
  }
  return source.inFrame + local * constantSpeed(clip);
}

/**
 * Multiplicador fuente/salida instantáneo (positivo) para
 * `HTMLMediaElement.playbackRate`: con curva es `sampleSpeedCurve` en la
 * posición actual; con `mean` es la media constante; si no, la velocidad
 * constante del clip. `null` cuando el clip no tiene fuente de ventana.
 */
export function clipPreviewRateAtLocal(
  clip: Clip,
  localFrame: number,
  options?: { readonly speedCurve?: SpeedCurveMode },
): number | null {
  if (!windowedSource(clip)) return null;
  const curve = speedCurveOf(clip);
  const mode = options?.speedCurve ?? 'curve';
  if (curve && mode !== 'off') {
    if (mode === 'mean') return meanSpeedCurve(curve);
    const mirrorSpan = clip.durationFrames - 1;
    const local = isReversed(clip) ? mirrorSpan - localFrame : localFrame;
    const output = Math.min(1, Math.max(0, local / Math.max(1, mirrorSpan)));
    return sampleSpeedCurve(curve, output);
  }
  return constantSpeed(clip);
}

/** `true` cuando el clip declara `reverse` (video o audio). */
export function clipIsReversed(clip: Clip): boolean {
  return isReversed(clip);
}
