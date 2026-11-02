import type { ProjectDocument } from '@editor-ia/project-schema';

/**
 * Planificador de subtítulos.
 *
 * El transcriptor devuelve segmentos de Whisper: frases de 4 a 8 segundos con
 * 15 o 20 palabras. Un segmento así no es un subtítulo: no entra en dos líneas
 * y no se lee en el tiempo que dura. Este módulo parte cada segmento en cues
 * legibles usando los tiempos de palabra cuando existen y, cuando no, reparte
 * el tiempo en proporción al texto.
 *
 * Reglas (explícitas para poder discutirlas):
 * - Un cue no supera `maxCharsPerLine × maxLines` caracteres.
 * - Un cue no dura más de `maxDurationSeconds`; si el segmento es más largo, se
 *   parte en dos por la mitad de las palabras.
 * - Un cue dura al menos `minDurationSeconds` cuando hay lugar, sin pisar al
 *   siguiente.
 * - La velocidad de lectura (caracteres por segundo) **se mide, no se corrige**:
 *   estirar el tiempo cambiaría la sincronización con la voz. Si un cue supera
 *   `maxCps` se cuenta en `overCps` para que la UI lo advierta.
 * - En vertical (9:16) el subtítulo sube un 8 % de la altura: la franja inferior
 *   queda tapada por la UI de TikTok/Reels/Shorts.
 */

export interface CaptionWordInput {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface CaptionSegmentInput {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words?: readonly {
    readonly start: number;
    readonly end: number;
    readonly word: string;
  }[];
}

export interface CaptionPlannerOptions {
  /** Caracteres por línea. 42 es el estándar para 16:9; 32 para 9:16. */
  readonly maxCharsPerLine?: number | undefined;
  readonly maxLines?: number | undefined;
  readonly maxDurationSeconds?: number | undefined;
  readonly minDurationSeconds?: number | undefined;
  /** Velocidad de lectura cómoda; por encima se reporta, no se estira. */
  readonly maxCps?: number | undefined;
}

export interface PlannedCaptionCue {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly words?: readonly CaptionWordInput[];
}

export interface CaptionPlan {
  readonly cues: readonly PlannedCaptionCue[];
  /** Cues por encima de la velocidad de lectura cómoda. */
  readonly overCps: number;
  /** Peor velocidad del plan, en caracteres por segundo. */
  readonly maxCps: number;
  /** Segmentos que se partieron en más de un cue. */
  readonly splitSegments: number;
}

const DEFAULTS = {
  maxCharsPerLine: 42,
  maxLines: 2,
  maxDurationSeconds: 6,
  minDurationSeconds: 0.8,
  maxCps: 20,
} as const;

function length(text: string): number {
  return [...text].length;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function greedyLines(text: string, maxCharsPerLine: number): string[] {
  const words = clean(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (length(current) + 1 + length(word) <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Reparte las palabras en como máximo `maxLines` líneas equilibradas.
 * Si el texto no entra, igual devuelve todas las palabras: nunca se recorta
 * contenido, se avisa por otra vía.
 */
export function wrapCaptionText(
  text: string,
  maxCharsPerLine: number = DEFAULTS.maxCharsPerLine,
  maxLines: number = DEFAULTS.maxLines,
): string {
  const words = clean(text).split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const greedy = greedyLines(text, maxCharsPerLine);
  if (greedy.length <= maxLines) return greedy.join('\n');

  const total = words.reduce((sum, word) => sum + length(word) + 1, 0) - 1;
  const target = Math.ceil(total / maxLines);
  const balanced: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && length(line) + 1 + length(word) > target && balanced.length < maxLines - 1) {
      balanced.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) balanced.push(line);
  return balanced.join('\n');
}

function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras con tiempos. Sin timings reales, reparte el segmento por largo. */
function wordsOf(segment: CaptionSegmentInput): {
  words: CaptionWordInput[];
  timed: boolean;
} {
  const timed = (segment.words ?? [])
    .filter((word) => word.word.trim().length > 0 && word.end > word.start)
    .map((word) => ({
      text: word.word.trim(),
      start: Math.max(segment.start, word.start),
      end: Math.min(segment.end, word.end),
    }))
    .filter((word) => word.end > word.start);
  // Si las palabras no cubren el texto (Whisper a veces devuelve sólo una
  // parte), usar sus tiempos borraría contenido. Se cae al reparto por texto.
  if (
    timed.length > 0 &&
    comparable(timed.map((word) => word.text).join(' ')) === comparable(segment.text)
  ) {
    return { words: timed, timed: true };
  }

  const parts = clean(segment.text).split(' ').filter(Boolean);
  if (parts.length === 0) return { words: [], timed: false };
  const span = Math.max(0.001, segment.end - segment.start);
  const weights = parts.map((part) => length(part) + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = segment.start;
  const proportional = parts.map((text, index) => {
    const duration = span * ((weights[index] ?? 1) / total);
    const word = { text, start: cursor, end: cursor + duration };
    cursor += duration;
    return word;
  });
  return { words: proportional, timed: false };
}

function fits(
  words: readonly CaptionWordInput[],
  maxCharsPerLine: number,
  maxLines: number,
): boolean {
  const text = words.map((word) => word.text).join(' ');
  return greedyLines(text, maxCharsPerLine).length <= maxLines;
}

/** Corta la lista de palabras en grupos que entran en el cue. */
function chunkWords(
  words: readonly CaptionWordInput[],
  maxCharsPerLine: number,
  maxLines: number,
): CaptionWordInput[][] {
  const chunks: CaptionWordInput[][] = [];
  let current: CaptionWordInput[] = [];
  for (const word of words) {
    const candidate = [...current, word];
    if (current.length > 0 && !fits(candidate, maxCharsPerLine, maxLines)) {
      chunks.push(current);
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Parte un grupo demasiado largo en dos, por la mitad de las palabras. */
function splitLongChunk(
  words: readonly CaptionWordInput[],
  maxDurationSeconds: number,
): CaptionWordInput[][] {
  if (words.length < 2) return [[...words]];
  const duration = words[words.length - 1]!.end - words[0]!.start;
  if (duration <= maxDurationSeconds) return [[...words]];
  const middle = Math.ceil(words.length / 2);
  return [
    ...splitLongChunk(words.slice(0, middle), maxDurationSeconds),
    ...splitLongChunk(words.slice(middle), maxDurationSeconds),
  ];
}

export function planCaptionCues(
  segments: readonly CaptionSegmentInput[],
  options: CaptionPlannerOptions = {},
): CaptionPlan {
  const maxCharsPerLine = Math.max(12, options.maxCharsPerLine ?? DEFAULTS.maxCharsPerLine);
  const maxLines = Math.max(1, Math.min(4, options.maxLines ?? DEFAULTS.maxLines));
  const maxDuration = Math.max(0.5, options.maxDurationSeconds ?? DEFAULTS.maxDurationSeconds);
  const minDuration = Math.max(0, options.minDurationSeconds ?? DEFAULTS.minDurationSeconds);
  const maxCps = Math.max(1, options.maxCps ?? DEFAULTS.maxCps);

  const cues: PlannedCaptionCue[] = [];
  let splitSegments = 0;
  let previousEnd = 0;

  for (const segment of segments) {
    if (!clean(segment.text) || segment.end <= segment.start) continue;
    const source = wordsOf(segment);
    const words = source.words;
    if (words.length === 0) continue;
    const groups = chunkWords(words, maxCharsPerLine, maxLines).flatMap((chunk) =>
      splitLongChunk(chunk, maxDuration),
    );
    if (groups.length > 1) splitSegments += 1;

    groups.forEach((group, index) => {
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const start = Math.max(segment.start, Math.max(first.start, previousEnd));
      let end = Math.min(segment.end, last.end);
      const nextStart = groups[index + 1]?.[0]?.start ?? segment.end;
      if (end - start < minDuration) {
        end = Math.min(Math.max(end, start + minDuration), Math.max(start, nextStart));
      }
      if (end <= start) return;
      const text = wrapCaptionText(
        group.map((word) => word.text).join(' '),
        maxCharsPerLine,
        maxLines,
      );
      if (!text) return;
      const hasTimings = source.timed;
      cues.push({
        text,
        startSeconds: start,
        endSeconds: end,
        ...(hasTimings ? { words: group } : {}),
      });
      previousEnd = end;
    });
  }

  let overCps = 0;
  let worst = 0;
  for (const cue of cues) {
    const duration = Math.max(0.001, cue.endSeconds - cue.startSeconds);
    const cps = length(cue.text.replace(/\n/g, ' ')) / duration;
    worst = Math.max(worst, cps);
    if (cps > maxCps) overCps += 1;
  }

  return { cues, overCps, maxCps: Number(worst.toFixed(2)), splitSegments };
}

/**
 * Desplazamiento vertical sugerido para los subtítulos, en píxeles.
 *
 * En 9:16 la franja inferior pertenece a la interfaz de la app de destino: se
 * sube el texto un 8 % de la altura para que no quede debajo de los botones.
 * En horizontal se deja el estilo como está.
 */
export function captionOffsetYForProject(project: ProjectDocument): number {
  const { width, height } = project.video;
  if (height <= width) return 0;
  return -Math.round(height * 0.08);
}

/** Ancho de línea sugerido según la relación de aspecto del proyecto. */
export function captionCharsPerLineForProject(project: ProjectDocument): number {
  const { width, height } = project.video;
  return height > width ? 32 : 42;
}
