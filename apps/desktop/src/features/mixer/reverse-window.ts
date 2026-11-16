import type { Clip } from '@editor-ia/project-schema';
import { clipIsReversed, clipSourceFrameAtLocal } from '../../state/clip-source-time';

/**
 * Geometría del audio de un clip `reverse` para la preview del monitor.
 *
 * El export FFmpeg invierte el audio del clip con `areverse` dentro de
 * `audio_filter`; la preview no puede pedirle al `<video>`/`<audio>` que
 * suene hacia atrás, así que la aproximación honesta es reproducir un
 * `AudioBuffer` ya invertido por Web Audio. Este módulo calcula, de forma
 * pura y testeable, la ventana de fuente que hay que invertir y la posición
 * dentro del buffer a cada frame del playhead.
 *
 * Sólo aplica a clips `reverse` **sin** `speedCurve`: con curva la posición
 * de fuente no es lineal y el audio del export va a la media constante —
 * queda fuera (silencio, como antes) en vez de mentir una sincronía.
 */

export interface ReversedAudioPlan {
  /** Segundo de fuente donde empieza la ventana (frame local final). */
  readonly windowStartSec: number;
  /** Segundo de fuente donde termina la ventana (frame local 0). */
  readonly windowEndSec: number;
  /** Velocidad constante del clip (frames de fuente por frame local). */
  readonly speed: number;
}

/** Velocidad constante del clip (1 cuando no declara `speed`). */
export function reversedClipSpeed(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  return speed ? speed.num / Math.max(1, speed.den) : 1;
}

/**
 * Plan de audio invertido para el clip, o `null` cuando no aplica:
 * no es `reverse`, no tiene ventana de fuente (`inFrame`/`outFrame`),
 * tiene `speedCurve` (sólo video) o la ventana resultante es inválida.
 */
export function reversedAudioPlan(clip: Clip, fps: number): ReversedAudioPlan | null {
  if (!clipIsReversed(clip)) return null;
  if (!('inFrame' in clip.source)) return null;
  if (clip.kind === 'video' && clip.speedCurve) return null;
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const lastLocal = clip.durationFrames - 1;
  // En reversa el frame local 0 consume el final de la ventana de fuente y
  // el último frame local consume el inicio: la ventana es
  // [src(último local), src(0)].
  const endFrame = clipSourceFrameAtLocal(clip, 0);
  const startFrame = clipSourceFrameAtLocal(clip, lastLocal);
  if (endFrame === null || startFrame === null) return null;
  const windowStartSec = startFrame / fps;
  const windowEndSec = endFrame / fps;
  if (
    !Number.isFinite(windowStartSec) ||
    !Number.isFinite(windowEndSec) ||
    windowEndSec - windowStartSec <= 0.001
  ) {
    return null;
  }
  return { windowStartSec, windowEndSec, speed: reversedClipSpeed(clip) };
}

/**
 * Offset dentro del buffer invertido (segundos de buffer) para un frame
 * local del clip. El buffer se reproduce hacia adelante consumiendo
 * `rate` segundos de buffer por segundo de salida; con la fuente moviéndose
 * hacia atrás a `speed` frames por frame local, el offset crece lineal:
 * `localFrame · speed / fps`.
 */
export function reversedBufferOffsetSeconds(
  localFrame: number,
  speed: number,
  fps: number,
): number {
  if (!Number.isFinite(localFrame) || localFrame <= 0) return 0;
  return (localFrame * speed) / fps;
}

/**
 * `playbackRate` del `AudioBufferSourceNode`: la fuente retrocede a
 * `speed × playbackRate`. Debe ser > 0 para sonar (un shuttle inverso
 * `J` deja el clip en silencio — el buffer no puede reproducirse hacia
 * atrás dos veces).
 */
export function reversedBufferRate(speed: number, playbackRate: number): number {
  return speed * playbackRate;
}

/** Rango de muestras `[from, to)` del buffer decodificado que cubre la ventana. */
export function reversedWindowSampleRange(
  plan: ReversedAudioPlan,
  sampleRate: number,
): { readonly from: number; readonly to: number } | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const from = Math.max(0, Math.floor(plan.windowStartSec * sampleRate));
  const to = Math.min(
    Math.floor(plan.windowEndSec * sampleRate),
    Number.MAX_SAFE_INTEGER,
  );
  if (to - from < 8) return null;
  return { from, to };
}

/**
 * Copia invertida de `data[from..to)`: el primer elemento del resultado es
 * `data[to-1]` (el final de la ventana de fuente), que es lo que el clip
 * `reverse` debe sonar primero.
 */
export function reverseSamples(
  data: Float32Array,
  from: number,
  to: number,
): Float32Array {
  const start = Math.max(0, Math.min(data.length, Math.floor(from)));
  const end = Math.max(start, Math.min(data.length, Math.ceil(to)));
  const out = new Float32Array(end - start);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = data[end - 1 - index] ?? 0;
  }
  return out;
}
