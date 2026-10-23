import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';

export interface ShortCandidate {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly durationSeconds: number;
  readonly title: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly excerpt: string;
}

export interface ShortOptions {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly maxCandidates: number;
}

export const DEFAULT_SHORT_OPTIONS: ShortOptions = {
  minSeconds: 15,
  maxSeconds: 60,
  maxCandidates: 5,
};

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function segmentsOf(transcript: TranscriptionResult | null, duration: number): Segment[] {
  if (!transcript) return [];
  return transcript.segments
    .map((segment) => ({
      start: clamp(segment.start, 0, duration),
      end: clamp(segment.end, 0, duration),
      text: cleanText(segment.text),
    }))
    .filter((segment) => segment.end > segment.start && segment.text.length > 0)
    .sort((a, b) => a.start - b.start);
}

function hasSilenceAt(analysis: MediaAnalysis, seconds: number): boolean {
  return analysis.silences.some(
    (silence) =>
      seconds >= silence.startSeconds - 0.3 && seconds <= silence.endSeconds + 0.3,
  );
}

function nearScene(analysis: MediaAnalysis, seconds: number): boolean {
  return analysis.scenes.some((scene) => Math.abs(scene - seconds) <= 1.2);
}

function density(segments: readonly Segment[], start: number, end: number): number {
  const window = end - start;
  if (window <= 0) return 0;
  const speech = segments
    .filter((segment) => segment.end > start && segment.start < end)
    .reduce(
      (sum, segment) =>
        sum + Math.max(0, Math.min(end, segment.end) - Math.max(start, segment.start)),
      0,
    );
  return clamp(speech / window, 0, 1);
}

function scoreWindow(
  analysis: MediaAnalysis,
  segments: readonly Segment[],
  start: number,
  end: number,
  firstText: string,
): { score: number; reasons: string[] } {
  const duration = end - start;
  let score = 40;
  const reasons: string[] = [];

  if (duration >= 20 && duration <= 45) {
    score += 15;
    reasons.push('Duración de 20–45 s');
  } else if (duration >= 15 && duration <= 60) {
    score += 8;
    reasons.push('Duración aceptable para un short');
  } else {
    score -= 10;
    reasons.push('Duración fuera del rango cómodo');
  }

  const hook = firstText.slice(0, 90);
  if (/^(¿|cómo|por qué|qué|cuándo|dónde|nunca|nadie|esto|error|secreto|\d)/i.test(hook) || hook.includes('?')) {
    score += 15;
    reasons.push('Arranca con pregunta, número o tensión');
  }
  if (/^(hola|buenas|buen día|bueno|eh|entonces|hoy les)/i.test(hook)) {
    score -= 12;
    reasons.push('Arranque genérico o con relleno');
  }

  const speech = density(segments, start, end);
  if (speech >= 0.65) {
    score += 10;
    reasons.push(`Voz densa (${Math.round(speech * 100)} %)`);
  } else if (speech < 0.35) {
    score -= 8;
    reasons.push(`Poca voz (${Math.round(speech * 100)} %)`);
  }

  if (nearScene(analysis, start) || hasSilenceAt(analysis, start)) {
    score += 5;
    reasons.push('Arranca en un corte o silencio');
  }
  if (hasSilenceAt(analysis, end)) {
    score += 10;
    reasons.push('Cierra en un silencio');
  }

  const changes = analysis.scenes.filter((scene) => scene > start && scene < end).length;
  if (changes >= 2) {
    score += 5;
    reasons.push(`${changes} cambios de escena`);
  }

  return { score: clamp(Math.round(score), 0, 100), reasons: reasons.slice(0, 4) };
}

function overlaps(a: ShortCandidate, b: ShortCandidate): boolean {
  const overlap = Math.max(
    0,
    Math.min(a.endSeconds, b.endSeconds) - Math.max(a.startSeconds, b.startSeconds),
  );
  const shortest = Math.min(a.durationSeconds, b.durationSeconds);
  return shortest > 0 && overlap / shortest > 0.5;
}

/**
 * Propone ventanas de short a partir de lo que ya midió el Director. No es un
 * detector de viralidad: usa voz, escenas, silencios y un gancho textual como
 * heurística explicable. Nunca inventa tomas fuera de la duración del material.
 */
export function buildShortCandidates(
  analysis: MediaAnalysis,
  transcript: TranscriptionResult | null,
  options: ShortOptions = DEFAULT_SHORT_OPTIONS,
): ShortCandidate[] {
  const duration = analysis.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const minSeconds = Math.max(3, Math.min(options.minSeconds, options.maxSeconds));
  const maxSeconds = Math.max(minSeconds, options.maxSeconds);
  const segments = segmentsOf(transcript, duration);

  const windows: Array<{ start: number; end: number; text: string }> = [];

  if (segments.length >= 2) {
    const starts = new Set<number>();
    starts.add(clamp(segments[0]!.start, 0, Math.max(0, duration - minSeconds)));
    for (const [index, segment] of segments.entries()) {
      if (index === 0) continue;
      const gap = segment.start - segments[index - 1]!.end;
      if (gap >= 0.35 || nearScene(analysis, segment.start)) {
        starts.add(clamp(segment.start, 0, Math.max(0, duration - minSeconds)));
      }
    }

    for (const start of [...starts].sort((a, b) => a - b)) {
      let end = Math.min(duration, start + maxSeconds);
      let foundEnd = false;
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        if (segment.end <= start + minSeconds) continue;
        if (segment.end > start + maxSeconds) break;
        const next = segments[index + 1];
        const closes = !next || next.start - segment.end >= 0.25;
        if (closes && segment.end - start >= minSeconds) {
          end = segment.end;
          foundEnd = true;
          break;
        }
        if (!next || next.end > start + maxSeconds) {
          end = Math.min(duration, start + maxSeconds);
          foundEnd = true;
          break;
        }
      }
      if (!foundEnd) end = Math.min(duration, start + maxSeconds);
      if (end - start < minSeconds) continue;
      const first = segments.find((segment) => segment.end > start && segment.start < end);
      windows.push({
        start: round(start),
        end: round(end),
        text: first?.text ?? '',
      });
    }
  }

  if (windows.length === 0) {
    const starts = new Set<number>([0]);
    for (const scene of analysis.scenes) {
      if (scene >= 0 && scene < duration) starts.add(scene);
    }
    for (const start of [...starts].sort((a, b) => a - b)) {
      const next = analysis.scenes.find((scene) => scene > start + minSeconds);
      const end = Math.min(duration, next ?? start + maxSeconds);
      if (end - start >= minSeconds) {
        windows.push({ start: round(start), end: round(end), text: '' });
      }
    }
  }

  const candidates = windows.map((window, index) => {
    const inside = segments.filter(
      (segment) => segment.end > window.start && segment.start < window.end,
    );
    const firstText = window.text || inside[0]?.text || 'Corte sin transcripción';
    const excerpt = cleanText(inside.map((segment) => segment.text).join(' ')).slice(0, 180);
    const scored = scoreWindow(
      analysis,
      segments,
      window.start,
      window.end,
      firstText,
    );
    const title =
      firstText === 'Corte sin transcripción'
        ? `Corte en ${formatClock(window.start)}`
        : firstText.slice(0, 80);
    return {
      id: `short-${round(window.start)}-${round(window.end)}-${index}`,
      startSeconds: window.start,
      endSeconds: window.end,
      durationSeconds: round(window.end - window.start),
      title,
      score: scored.score,
      reasons: scored.reasons,
      excerpt,
    } satisfies ShortCandidate;
  });

  const selected: ShortCandidate[] = [];
  for (const candidate of candidates.sort(
    (a, b) => b.score - a.score || a.startSeconds - b.startSeconds,
  )) {
    if (selected.some((item) => overlaps(item, candidate))) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, options.maxCandidates)) break;
  }
  return selected;
}

export function shortPlanText(candidates: readonly ShortCandidate[]): string {
  if (candidates.length === 0) return 'Sin candidatos de short.';
  return candidates
    .map((candidate, index) => {
      const reasons = candidate.reasons.length > 0 ? ` · ${candidate.reasons.join('; ')}` : '';
      return `${index + 1}. ${formatClock(candidate.startSeconds)}–${formatClock(
        candidate.endSeconds,
      )} (${candidate.durationSeconds.toFixed(1)} s, score ${candidate.score}) ${candidate.title}${reasons}`;
    })
    .join('\n');
}
