import {
  curveDurationFrames,
  meanSpeedCurve,
  type SpeedCurve,
} from '@editor-ia/project-schema';

/**
 * Sugerencia determinista de curva de velocidad a partir de pulsos de audio.
 *
 * No es un modelo de IA: es la misma detección de energía de `beat-sync.ts`
 * (`detectBeats`) convertida en una curva `speedCurve` continua. Cada pulso
 * dentro de la ventana de origen del clip genera una ventana simétrica de
 * cámara lenta (baja a `slowSpeed` en el centro y vuelve a 1× en los bordes,
 * perfil coseno). La curva se define sobre el tiempo de SALIDA normalizado,
 * así que la posición de cada dip en `t` se calcula integrando `1/v` sobre
 * la fracción de fuente — la misma integral que `curveSourceFraction` usa
 * en el render.
 *
 * Límites honestos: los pulsos son eventos de audio, no de imagen; una
 * ventana de cámara lenta sobre un beat no garantiza que el golpe visual
 * caiga ahí. La sugerencia se revisa y se aplica como cualquier curva.
 */

export interface BeatRampOptions {
  /** Velocidad en el centro de cada ventana (0.1–0.95, default 0.5). */
  readonly slowSpeed?: number;
  /** Ancho total de cada ventana en segundos de fuente (default 0.8). */
  readonly dipSeconds?: number;
  /** Pulsos más cercanos que esto se fusionan (default 0.3 s). */
  readonly minGapSeconds?: number;
  /** Muestras de la curva resultante (default 25, tope 48 del schema). */
  readonly samples?: number;
}

export interface BeatRampSuggestion {
  /** Curva lista para `applySpeedCurvePoints` (puntos `{t, speed}`). */
  readonly curve: SpeedCurve;
  /** Pulsos que cayeron dentro de la ventana de origen del clip. */
  readonly beatsInClip: number;
  /** Ventanas de cámara lenta resultantes (tras fusionar pulsos cercanos). */
  readonly dips: number;
  /** Media de la curva: duración = sourceFrames / meanSpeed. */
  readonly meanSpeed: number;
  /** Frames de la ventana de origen sobre la que se calculó. */
  readonly sourceFrames: number;
  /** Duración que producirá la curva, en frames de timeline. */
  readonly durationFrames: number;
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Convierte `beatsSeconds` (tiempo del archivo fuente, como los devuelve
 * `detectBeats`) en una `SpeedCurve` para la ventana
 * `[sourceInFrame, sourceOutFrame)` a `fps` frames por segundo.
 *
 * Devuelve `null` cuando no hay al menos 2 pulsos dentro de la ventana:
 * una sola ventana no es una rampa y sugerirla sería ruido.
 */
export function suggestBeatSpeedCurve(
  beatsSeconds: readonly number[],
  sourceInFrame: number,
  sourceOutFrame: number,
  fps: number,
  options: BeatRampOptions = {},
): BeatRampSuggestion | null {
  const sourceFrames = Math.round(sourceOutFrame - sourceInFrame);
  if (!Number.isFinite(sourceFrames) || sourceFrames <= 0 || !(fps > 0)) return null;

  const slow = clamp(options.slowSpeed ?? 0.5, MIN_SPEED, 0.95);
  const dipSeconds = Math.max(0.2, options.dipSeconds ?? 0.8);
  const minGapSeconds = Math.max(0.1, options.minGapSeconds ?? 0.3);
  const samples = Math.round(clamp(options.samples ?? 25, 8, 48));

  // Pulsos → fracción de la ventana de origen [0,1].
  const centers: number[] = [];
  for (const seconds of beatsSeconds) {
    if (!Number.isFinite(seconds)) continue;
    const fraction = (seconds * fps - sourceInFrame) / sourceFrames;
    if (fraction >= 0 && fraction <= 1) centers.push(fraction);
  }
  centers.sort((a, b) => a - b);

  // Fusiona pulsos más cercanos que `minGapSeconds`: la ventana más
  // profunda es la misma, dos dips solapados sólo suman puntos.
  const gap = (minGapSeconds * fps) / sourceFrames;
  const dips: number[] = [];
  for (const center of centers) {
    const last = dips[dips.length - 1];
    if (last !== undefined && center - last < gap) continue;
    dips.push(center);
  }
  if (dips.length < 2) return null;

  // Perfil de velocidad sobre la fracción de fuente: 1× salvo dentro de
  // cada ventana, donde baja a `slow` con perfil coseno (derivada cero en
  // el centro y en los bordes: la curva queda suave sin picos).
  const halfWidth = (dipSeconds * fps) / (2 * sourceFrames);
  const speedAt = (s: number): number => {
    let speed = 1;
    for (const center of dips) {
      const distance = Math.abs(s - center) / halfWidth;
      if (distance >= 1) continue;
      const bump = 0.5 * (1 + Math.cos(Math.PI * distance));
      speed = Math.min(speed, 1 - (1 - slow) * bump);
    }
    return round4(clamp(speed, MIN_SPEED, MAX_SPEED));
  };

  // Muestreo uniforme en fracción de fuente y paso a tiempo de salida:
  // dt_out = ds / v(s). `t` es la fracción de salida normalizada.
  const source: { s: number; v: number }[] = [];
  for (let index = 0; index < samples; index += 1) {
    const s = index / (samples - 1);
    source.push({ s, v: speedAt(s) });
  }
  const inverse: number[] = [0];
  for (let index = 1; index < samples; index += 1) {
    const left = source[index - 1]!;
    const right = source[index]!;
    inverse.push(
      inverse[index - 1]! +
        0.5 * (1 / left.v + 1 / right.v) * (right.s - left.s),
    );
  }
  const total = inverse[inverse.length - 1]!;
  if (!(total > 0) || !Number.isFinite(total)) return null;

  const curve: SpeedCurve = {
    points: source.map((point, index) => ({
      t: index === 0 ? 0 : index === samples - 1 ? 1 : inverse[index]! / total,
      speed: point.v,
    })),
  };
  const meanSpeed = meanSpeedCurve(curve);
  return {
    curve,
    beatsInClip: centers.length,
    dips: dips.length,
    meanSpeed,
    sourceFrames,
    durationFrames: curveDurationFrames(sourceFrames, curve),
  };
}
