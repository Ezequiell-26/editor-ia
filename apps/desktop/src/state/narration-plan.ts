import type { TranscriptionSegment } from '../services/project-service';

/**
 * Convierte la transcripción por palabras en frases con tiempos para montar.
 *
 * Las frases son la unidad de edición: cada una recibe una imagen y un
 * subtítulo. Se cortan por puntuación y por pausas; las frases diminutas se
 * fusionan para que no queden planos de un segundo.
 */

export interface NarrationWord {
  readonly start: number;
  readonly end: number;
  readonly word: string;
}

export interface NarrationSentence {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words: readonly NarrationWord[];
}

export interface NarrationPlan {
  readonly start: number;
  readonly end: number;
  readonly sentences: readonly NarrationSentence[];
}

export interface NarrationPlanOptions {
  /** Pausa (segundos) que cierra una frase. */
  readonly pauseSeconds?: number;
  /** Duración máxima de una frase antes de partirla en una pausa. */
  readonly maxSentenceSeconds?: number;
  /** Frases más cortas que esto se fusionan con la vecina. */
  readonly minSentenceSeconds?: number;
  /** Silencio que se conserva antes de la primera palabra. */
  readonly leadSeconds?: number;
  /** Silencio que se conserva después de la última palabra. */
  readonly tailSeconds?: number;
}

const DEFAULTS = {
  pauseSeconds: 0.65,
  maxSentenceSeconds: 8,
  minSentenceSeconds: 0.7,
  leadSeconds: 0.15,
  tailSeconds: 0.5,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .trim();
}

function wordsFromSegment(segment: TranscriptionSegment): NarrationWord[] {
  const provided = (segment.words ?? [])
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({
      start: Math.max(0, word.start),
      end: Math.max(word.start + 0.02, word.end),
      word: word.word.trim(),
    }))
    .filter((word) => word.word.length > 0);
  if (provided.length > 0) return provided;

  const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const span = Math.max(0.1, segment.end - segment.start);
  const weights = tokens.map((token) => Math.max(1, token.length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = segment.start;
  return tokens.map((token, index) => {
    const duration = (span * (weights[index] ?? 1)) / total;
    const word = { start: cursor, end: cursor + duration, word: token };
    cursor += duration;
    return word;
  });
}

function endsSentence(word: string): boolean {
  return /[.!?…]+["'»)\]]?$/.test(word.trim());
}

function mergeTiny(
  sentences: NarrationSentence[],
  minSeconds: number,
): NarrationSentence[] {
  const merged = [...sentences];
  let index = 0;
  while (index < merged.length && merged.length > 1) {
    const sentence = merged[index]!;
    const words = sentence.words.length;
    const short = sentence.end - sentence.start < minSeconds || words < 2;
    if (!short) {
      index += 1;
      continue;
    }
    const previous = merged[index - 1];
    const next = merged[index + 1];
    const gapPrevious = previous ? sentence.start - previous.end : Infinity;
    const gapNext = next ? next.start - sentence.end : Infinity;
    if (previous && gapPrevious <= gapNext) {
      merged[index - 1] = {
        start: previous.start,
        end: sentence.end,
        text: normalizeText(`${previous.text} ${sentence.text}`),
        words: [...previous.words, ...sentence.words],
      };
      merged.splice(index, 1);
      index = Math.max(0, index - 1);
    } else if (next) {
      merged[index] = {
        start: sentence.start,
        end: next.end,
        text: normalizeText(`${sentence.text} ${next.text}`),
        words: [...sentence.words, ...next.words],
      };
      merged.splice(index + 1, 1);
    } else {
      index += 1;
    }
  }
  return merged;
}

export function buildNarrationPlan(
  segments: readonly TranscriptionSegment[],
  options: NarrationPlanOptions = {},
): NarrationPlan {
  const pause = options.pauseSeconds ?? DEFAULTS.pauseSeconds;
  const maxSeconds = options.maxSentenceSeconds ?? DEFAULTS.maxSentenceSeconds;
  const minSeconds = options.minSentenceSeconds ?? DEFAULTS.minSentenceSeconds;
  const lead = options.leadSeconds ?? DEFAULTS.leadSeconds;
  const tail = options.tailSeconds ?? DEFAULTS.tailSeconds;

  const words = segments
    .flatMap(wordsFromSegment)
    .filter((word) => Number.isFinite(word.start) && word.end > word.start)
    .sort((left, right) => left.start - right.start);
  if (words.length === 0) return { start: 0, end: 0, sentences: [] };

  const sentences: NarrationSentence[] = [];
  let current: NarrationWord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const text = normalizeText(current.map((word) => word.word).join(' '));
    if (!text) {
      current = [];
      return;
    }
    sentences.push({
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
      text,
      words: current,
    });
    current = [];
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    current.push(word);
    const next = words[index + 1];
    const duration = word.end - current[0]!.start;
    const gap = next ? next.start - word.end : Infinity;
    const last = !next;
    const ends = endsSentence(word.word);
    const tooLong = duration >= maxSeconds && gap >= 0.15;
    const forcedLong = duration >= maxSeconds * 1.6 && gap >= 0.1;
    if (
      last ||
      forcedLong ||
      tooLong ||
      (ends && duration >= minSeconds) ||
      (gap >= pause && duration >= minSeconds)
    ) {
      flush();
    }
  }
  flush();

  const merged = mergeTiny(sentences, minSeconds);
  const first = merged[0]!;
  const last = merged[merged.length - 1]!;
  const start = Math.max(0, first.start - lead);
  const end = Math.max(start + 0.1, last.end + tail);
  return { start, end, sentences: merged };
}

/** Índice de la imagen por frase; usa el orden si la IA no devolvió nada válido. */
export function fallbackAssignments(
  sentences: number,
  images: number,
): number[] {
  if (images <= 0) return [];
  return Array.from({ length: sentences }, (_, index) => index % images);
}
