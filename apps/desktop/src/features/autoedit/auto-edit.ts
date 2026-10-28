import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';

/**
 * Editor automático determinista: no usa LLM ni servicios externos. Corta con
 * los tiempos de escena, silencios, negros y congelados que ya mide FFmpeg, y
 * produce tres variantes con ritmos distintos. Los subtítulos sólo aparecen si
 * hay una transcripción disponible; nunca se inventa texto.
 */

export type AutoEditStyle = 'pulse' | 'story' | 'impact';

export interface AutoEditCut {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly zoom: boolean;
}

export interface AutoEditCaption {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface AutoEditVariant {
  readonly id: string;
  readonly style: AutoEditStyle;
  readonly name: string;
  readonly description: string;
  readonly cuts: readonly AutoEditCut[];
  readonly durationSeconds: number;
  readonly zoomCount: number;
  readonly captions: readonly AutoEditCaption[];
}

interface Range {
  readonly start: number;
  readonly end: number;
}

interface StyleConfig {
  readonly targetSeconds: number;
  readonly minSeconds: number;
  readonly maxOutputSeconds: number;
  readonly maxCuts: number;
  readonly zoomEvery: number;
  readonly name: string;
  readonly description: string;
}

const STYLES: Record<AutoEditStyle, StyleConfig> = {
  pulse: {
    targetSeconds: 2.6,
    minSeconds: 0.9,
    maxOutputSeconds: 75,
    maxCuts: 34,
    zoomEvery: 2,
    name: 'Pulso rápido',
    description: 'Cortes de 1–3 s, ritmo alto y puntuaciones de zoom.',
  },
  story: {
    targetSeconds: 5.2,
    minSeconds: 1.6,
    maxOutputSeconds: 110,
    maxCuts: 24,
    zoomEvery: 4,
    name: 'Historia',
    description: 'Cortes de 3–6 s, menos zoom y transiciones suaves.',
  },
  impact: {
    targetSeconds: 3.2,
    minSeconds: 1.1,
    maxOutputSeconds: 30,
    maxCuts: 10,
    zoomEvery: 1,
    name: 'Impacto',
    description: 'Un highlight de 15–30 s con zoom en cada corte.',
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanRanges(analysis: MediaAnalysis): Range[] {
  const duration = Math.max(0, analysis.durationSeconds);
  let ranges: Range[] = [{ start: 0, end: duration }];
  const holes = [
    ...analysis.silences,
    ...analysis.blacks,
    ...analysis.freezes,
  ]
    .map((range) => ({
      start: clamp(range.startSeconds, 0, duration),
      end: clamp(range.endSeconds, 0, duration),
    }))
    .filter((range) => range.end - range.start >= 0.4)
    .sort((a, b) => a.start - b.start);
  for (const hole of holes) {
    const next: Range[] = [];
    for (const range of ranges) {
      if (hole.end <= range.start || hole.start >= range.end) {
        next.push(range);
        continue;
      }
      if (hole.start > range.start) next.push({ start: range.start, end: hole.start });
      if (hole.end < range.end) next.push({ start: hole.end, end: range.end });
    }
    ranges = next;
  }
  return ranges.filter((range) => range.end - range.start >= 0.45);
}

function splitAtScenes(
  range: Range,
  scenes: readonly number[],
  target: number,
  min: number,
): Range[] {
  const cuts: Range[] = [];
  let cursor = range.start;
  let guard = 0;
  while (range.end - cursor > target * 1.35 && guard < 200) {
    guard += 1;
    const wanted = cursor + target;
    const lower = cursor + min;
    const upper = Math.min(range.end - min, cursor + target * 1.6);
    const candidates = scenes
      .filter((scene) => scene >= lower && scene <= upper)
      .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
    const cut = candidates[0] ?? clamp(wanted, lower, upper);
    if (cut <= cursor + min * 0.5) break;
    cuts.push({ start: cursor, end: cut });
    cursor = cut;
  }
  if (range.end > cursor + 0.2) cuts.push({ start: cursor, end: range.end });
  return cuts;
}

function spread(chunks: readonly Range[], maxCuts: number, maxOutput: number): Range[] {
  if (chunks.length === 0) return [];
  const limited = chunks.slice(0, Math.min(maxCuts, chunks.length));
  const total = limited.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0);
  if (total <= maxOutput) return [...limited];
  const stride = Math.max(1, Math.ceil(total / maxOutput));
  const selected: Range[] = [];
  let duration = 0;
  for (let index = 0; index < limited.length; index += stride) {
    const chunk = limited[index]!;
    const length = chunk.end - chunk.start;
    if (duration + length > maxOutput) break;
    selected.push(chunk);
    duration += length;
  }
  return selected.length > 0 ? selected : [limited[0]!];
}

function makeCuts(
  chunks: readonly Range[],
  style: AutoEditStyle,
): AutoEditCut[] {
  const config = STYLES[style];
  return chunks.map((chunk, index) => ({
    startSeconds: Number(chunk.start.toFixed(3)),
    endSeconds: Number(chunk.end.toFixed(3)),
    zoom: style === 'impact' || index % Math.max(1, config.zoomEvery) === 0,
  }));
}

function remapCaptions(
  cuts: readonly AutoEditCut[],
  transcript: TranscriptionResult | null,
): AutoEditCaption[] {
  if (!transcript) return [];
  const captions: AutoEditCaption[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    const cutLength = cut.endSeconds - cut.startSeconds;
    for (const segment of transcript.segments) {
      const start = Math.max(segment.start, cut.startSeconds);
      const end = Math.min(segment.end, cut.endSeconds);
      if (end - start < 0.12) continue;
      const text = segment.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      captions.push({
        startSeconds: Number((cursor + (start - cut.startSeconds)).toFixed(3)),
        endSeconds: Number((cursor + (end - cut.startSeconds)).toFixed(3)),
        text,
      });
    }
    cursor += cutLength;
  }
  return captions;
}

function buildVariant(
  style: AutoEditStyle,
  chunks: readonly Range[],
  transcript: TranscriptionResult | null,
): AutoEditVariant {
  const config = STYLES[style];
  const selected =
    style === 'impact'
      ? spread(chunks, config.maxCuts, config.maxOutputSeconds)
      : spread(chunks, config.maxCuts, config.maxOutputSeconds);
  const cuts = makeCuts(selected, style);
  const duration = cuts.reduce(
    (sum, cut) => sum + (cut.endSeconds - cut.startSeconds),
    0,
  );
  const captions = remapCaptions(cuts, transcript);
  return {
    id: `auto-${style}`,
    style,
    name: config.name,
    description: config.description,
    cuts,
    durationSeconds: Number(duration.toFixed(2)),
    zoomCount: cuts.filter((cut) => cut.zoom).length,
    captions,
  };
}

/**
 * Genera las tres variantes. `impact` elige la ventana de 15–30 s con más
 * cortes disponibles; `pulse` y `story` reparten el video completo.
 */
export function buildAutoEditVariants(
  analysis: MediaAnalysis,
  transcript: TranscriptionResult | null = null,
): AutoEditVariant[] {
  if (analysis.kind !== 'video' || analysis.durationSeconds <= 0.5) return [];
  const ranges = cleanRanges(analysis);
  if (ranges.length === 0) return [];
  const pulseChunks = ranges.flatMap((range) =>
    splitAtScenes(range, analysis.scenes, STYLES.pulse.targetSeconds, STYLES.pulse.minSeconds),
  );
  const storyChunks = ranges.flatMap((range) =>
    splitAtScenes(range, analysis.scenes, STYLES.story.targetSeconds, STYLES.story.minSeconds),
  );
  const impactCandidates = ranges.flatMap((range) =>
    splitAtScenes(range, analysis.scenes, STYLES.impact.targetSeconds, STYLES.impact.minSeconds),
  );
  let impactChunks = impactCandidates.slice(0, STYLES.impact.maxCuts);
  let bestCount = 0;
  for (let start = 0; start < impactCandidates.length; start += 1) {
    let total = 0;
    let count = 0;
    for (let index = start; index < impactCandidates.length; index += 1) {
      const chunk = impactCandidates[index]!;
      const length = chunk.end - chunk.start;
      if (total + length > STYLES.impact.maxOutputSeconds) break;
      total += length;
      count += 1;
      if (total >= 15 && count > bestCount) {
        bestCount = count;
        impactChunks = impactCandidates.slice(start, index + 1);
      }
    }
  }
  if (bestCount === 0) {
    // Video corto: todo el material es el highlight.
    impactChunks = impactCandidates.slice(0, STYLES.impact.maxCuts);
  }
  return [
    buildVariant('pulse', pulseChunks, transcript),
    buildVariant('story', storyChunks, transcript),
    buildVariant('impact', impactChunks, transcript),
  ].filter((variant) => variant.cuts.length > 0);
}
