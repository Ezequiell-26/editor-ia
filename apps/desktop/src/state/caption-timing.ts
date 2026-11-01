/**
 * Reparto de tiempo de subtítulos sobre la narración.
 *
 * El montaje repartía los frames de una escena proporcionalmente a la cantidad
 * de caracteres de cada bloque. Eso ignora dos cosas que sí pesan en el habla
 * real: las pausas de puntuación y los límites de lectura. Este módulo reparte
 * por peso de habla, impone una duración mínima y máxima por bloque y avisa
 * cuando un bloque quedaría ilegible por velocidad (caracteres por segundo).
 *
 * Es puro y determinista: mismos bloques, mismos frames, mismo resultado.
 */

export interface CaptionTimingOptions {
  readonly fps: number;
  /** Velocidad de lectura máxima aceptable; 17 c/s es el estándar de subtitulado. */
  readonly maxCps?: number;
  /** Duración mínima de un bloque legible. */
  readonly minSeconds?: number;
  /** Duración máxima de un bloque en pantalla. */
  readonly maxSeconds?: number;
}

export interface CaptionTimingCue {
  readonly text: string;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface CaptionTimingPlan {
  readonly cues: CaptionTimingCue[];
  readonly warnings: string[];
}

const DEFAULT_MAX_CPS = 17;
const DEFAULT_MIN_SECONDS = 0.8;
const DEFAULT_MAX_SECONDS = 7;

/** Caracteres visibles: no se cuentan espacios ni saltos. */
function visibleChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * Peso de habla de un bloque: caracteres visibles más una pausa estimada por
 * la puntuación final. Una oración cerrada deja silencio; una coma, menos.
 */
export function speechWeight(text: string): number {
  const chars = visibleChars(text);
  if (chars === 0) return 0;
  const tail = text.trimEnd();
  if (/[.!?…]$/.test(tail)) return chars + 8;
  if (/(?:\.\.\.)$/.test(tail)) return chars + 8;
  if (/[,;:]$/.test(tail)) return chars + 4;
  return chars;
}

/**
 * Reparte `total` frames entre pesos respetando mínimos y máximos.
 *
 * Reparto por agua: se calcula la cuota proporcional de los bloques libres, se
 * fijan los que caen fuera de rango y se repite con el sobrante. Si aun así
 * queda tiempo sin asignar (todos los bloques tocaron su máximo) el sobrante se
 * reparte proporcionalmente: un subtítulo puede quedarse más tiempo del ideal,
 * pero la escena nunca queda sin texto en pantalla.
 */
function allocate(
  weights: readonly number[],
  total: number,
  min: number,
  max: number,
): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const effectiveMin = Math.min(min, Math.floor(total / count));
  const effectiveMax = Math.max(max, Math.ceil(total / count));
  const values = new Array<number>(count).fill(0);
  let free = weights.map((_, index) => index);
  let remaining = total;
  for (let pass = 0; pass < count + 2 && free.length > 0; pass += 1) {
    if (remaining <= 0) break;
    const weightSum = free.reduce((sum, index) => sum + (weights[index] ?? 0), 0) || free.length;
    const stillFree: number[] = [];
    let clampedAny = false;
    for (const index of free) {
      let value = (remaining * (weights[index] ?? 0)) / weightSum;
      if (value <= effectiveMin + 1e-9) {
        value = effectiveMin;
        clampedAny = true;
        values[index] = value;
        remaining -= value;
      } else if (value >= effectiveMax - 1e-9) {
        value = effectiveMax;
        clampedAny = true;
        values[index] = value;
        remaining -= value;
      } else {
        stillFree.push(index);
      }
    }
    free = stillFree;
    if (!clampedAny) {
      const freeWeight = free.reduce((sum, index) => sum + (weights[index] ?? 0), 0) || free.length;
      for (const index of free) {
        values[index] = (remaining * (weights[index] ?? 0)) / freeWeight;
      }
      remaining = 0;
      break;
    }
  }
  if (remaining > 1e-6) {
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || count;
    for (let index = 0; index < count; index += 1) {
      values[index] = (values[index] ?? 0) + (remaining * (weights[index] ?? 0)) / weightSum;
    }
  }
  return values;
}

/** Convierte los valores reales en enteros que suman exactamente `total`. */
function toWholeFrames(values: readonly number[], total: number): number[] {
  if (values.length === 0) return [];
  const floors = values.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const result = [...floors];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    const target = order[cursor % order.length]!;
    result[target.index] = (result[target.index] ?? 0) + 1;
    remainder -= 1;
    cursor += 1;
  }
  while (remainder < 0 && order.length > 0) {
    const target = order[cursor % order.length]!;
    if ((result[target.index] ?? 0) > 1) {
      result[target.index] = (result[target.index] ?? 0) - 1;
      remainder += 1;
    }
    cursor += 1;
    if (cursor > total + order.length * 2) break;
  }
  return result;
}

/**
 * Plan de subtítulos para una escena. Los bloques salen contiguos, sin solapes
 * y cubriendo exactamente `[startFrame, startFrame + durationFrames)`.
 */
export function planCaptionTiming(
  chunks: readonly string[],
  startFrame: number,
  durationFrames: number,
  options: CaptionTimingOptions,
): CaptionTimingPlan {
  const warnings: string[] = [];
  const texts = chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  if (texts.length === 0) return { cues: [], warnings };
  const fps = options.fps > 0 && Number.isFinite(options.fps) ? options.fps : 30;
  const total = Math.max(0, Math.floor(durationFrames));
  if (total <= 0) {
    return { cues: [], warnings: ['La escena no tiene frames para ubicar subtítulos.'] };
  }

  const maxCps = options.maxCps !== undefined && options.maxCps > 0 ? options.maxCps : DEFAULT_MAX_CPS;
  const minSeconds =
    options.minSeconds !== undefined && options.minSeconds > 0
      ? options.minSeconds
      : DEFAULT_MIN_SECONDS;
  const maxSeconds =
    options.maxSeconds !== undefined && options.maxSeconds > 0
      ? options.maxSeconds
      : DEFAULT_MAX_SECONDS;
  const minFrames = Math.max(1, Math.round(minSeconds * fps));
  const maxFrames = Math.max(minFrames, Math.round(maxSeconds * fps));

  if (total < texts.length) {
    warnings.push(
      `La escena dura ${total} frame(s) y hay ${texts.length} subtítulo(s): no entran todos.`,
    );
  } else if (total < texts.length * minFrames) {
    warnings.push(
      `La escena es corta para ${texts.length} subtítulos: se redujo la duración mínima por bloque.`,
    );
  }

  const weights = texts.map((text) => speechWeight(text) || 1);
  const frames = toWholeFrames(allocate(weights, total, minFrames, maxFrames), total);

  const cues: CaptionTimingCue[] = [];
  let cursor = startFrame;
  texts.forEach((text, index) => {
    const length = Math.max(1, frames[index] ?? 1);
    const endFrame = Math.min(startFrame + total, cursor + length);
    if (endFrame > cursor) {
      cues.push({ text, startFrame: cursor, endFrame });
      cursor = endFrame;
    }
  });
  if (cues.length > 0) {
    const last = cues[cues.length - 1]!;
    if (last.endFrame !== startFrame + total) {
      cues[cues.length - 1] = { ...last, endFrame: startFrame + total };
    }
  }

  const fast = cues.filter((cue) => {
    const seconds = (cue.endFrame - cue.startFrame) / fps;
    return seconds > 0 && visibleChars(cue.text) / seconds > maxCps;
  });
  if (fast.length > 0) {
    warnings.push(
      `${fast.length} subtítulo(s) superan ${maxCps} caracteres por segundo; acortá el texto o alargá la escena.`,
    );
  }

  const longOnScreen = cues.filter((cue) => cue.endFrame - cue.startFrame > maxFrames);
  if (longOnScreen.length > 0) {
    warnings.push(
      `${longOnScreen.length} subtítulo(s) quedan más de ${maxSeconds} s en pantalla: no hay más texto para repartir.`,
    );
  }

  return { cues, warnings };
}
