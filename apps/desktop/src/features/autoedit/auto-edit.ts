import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';

/**
 * Motor del editor automático.
 *
 * Todo lo que decide un corte es medible y local: escenas, silencios, negros,
 * congelados, energía de audio y, cuando existe, la transcripción. No se inventa
 * texto ni se pide nada a un proveedor: la capa de IA (`ai-director.ts`) es una
 * segunda opinión opcional que sólo puede reordenar lo que este motor ya midió.
 */

export type AutoEditStyle = 'pulse' | 'story' | 'impact' | 'custom';

/** Un video del proyecto con todo lo que se midió de él. */
export interface AutoEditSource {
  readonly assetId: string;
  readonly label: string;
  readonly analysis: MediaAnalysis;
  readonly transcript?: TranscriptionResult | null;
  /** Energía normalizada 0–1 por tramo igual del video (`audioPeaks`). */
  readonly energy?: readonly number[] | null;
}

export type AutoEditTransition = 'none' | 'dissolve' | 'fade';

/** La receta que el usuario ajusta con los controles. */
export interface AutoEditRecipe {
  /** Duración media de cada corte, en segundos. */
  readonly cutSeconds: number;
  /** Duración objetivo del montaje. 0 = usar todo el material limpio. */
  readonly targetSeconds: number;
  /** Intensidad del zoom, 0–100. 0 = sin zoom. */
  readonly zoom: number;
  readonly transition: AutoEditTransition;
  /** Abre con el segmento de mayor energía, acortado. */
  readonly hook: boolean;
  /** Corta en límites de frase cuando hay transcripción. */
  readonly speechCuts: boolean;
}

export type AutoEditReason = 'hook' | 'speech' | 'scene' | 'energy' | 'fill';

export interface AutoEditCut {
  readonly assetId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly zoom: boolean;
  /** Interés medido del segmento, 0–100. */
  readonly score: number;
  readonly reason: AutoEditReason;
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
  readonly recipe: AutoEditRecipe;
  readonly cuts: readonly AutoEditCut[];
  readonly durationSeconds: number;
  readonly zoomCount: number;
  readonly captions: readonly AutoEditCaption[];
  /** Interés medio de los cortes elegidos, 0–100. */
  readonly score: number;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

interface Candidate {
  readonly assetId: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly reason: AutoEditReason;
  readonly hasSpeech: boolean;
}

export const MIN_CUT_SECONDS = 0.8;
export const MAX_CUT_SECONDS = 12;

export const DEFAULT_RECIPE: AutoEditRecipe = {
  cutSeconds: 3,
  targetSeconds: 45,
  zoom: 40,
  transition: 'dissolve',
  hook: true,
  speechCuts: true,
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Normaliza la receta a los rangos que el motor y la timeline aceptan. */
export function clampRecipe(recipe: AutoEditRecipe): AutoEditRecipe {
  return {
    cutSeconds: Math.round(clamp(recipe.cutSeconds, MIN_CUT_SECONDS, MAX_CUT_SECONDS) * 10) / 10,
    targetSeconds: Math.round(clamp(recipe.targetSeconds, 0, 1800)),
    zoom: Math.round(clamp(recipe.zoom, 0, 100)),
    transition:
      recipe.transition === 'none' || recipe.transition === 'fade' ? recipe.transition : 'dissolve',
    hook: Boolean(recipe.hook),
    speechCuts: Boolean(recipe.speechCuts),
  };
}

export function recipeSummary(recipe: AutoEditRecipe): string {
  const clean = clampRecipe(recipe);
  const parts = [`cortes de ${clean.cutSeconds.toFixed(1)} s`];
  parts.push(clean.targetSeconds > 0 ? `objetivo ${clean.targetSeconds} s` : 'sin límite');
  if (clean.zoom > 0) parts.push(`zoom ${clean.zoom}%`);
  if (clean.transition !== 'none') parts.push(clean.transition === 'fade' ? 'fundido' : 'disolvencia');
  if (clean.hook) parts.push('hook');
  if (clean.speechCuts) parts.push('corte por voz');
  return parts.join(' · ');
}

/**
 * Resta los huecos inservibles (silencios, negros, congelados) al material.
 * Un hueco menor a 0,4 s no se toca: cortar ahí produce un salto perceptible.
 */
function cleanRanges(analysis: MediaAnalysis): Range[] {
  const duration = Math.max(0, analysis.durationSeconds);
  if (duration <= 0) return [];
  let ranges: Range[] = [{ start: 0, end: duration }];
  const holes = [...analysis.silences, ...analysis.blacks, ...analysis.freezes]
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

/** Parte un tramo limpio en cortes apoyados en los cambios de escena. */
function splitAtScenes(
  range: Range,
  scenes: readonly number[],
  target: number,
  min: number,
): Range[] {
  const cuts: Range[] = [];
  let cursor = range.start;
  let guard = 0;
  while (range.end - cursor > target * 1.35 && guard < 400) {
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

/**
 * Parte un tramo en frases completas. Se agrupan segmentos consecutivos hasta
 * llegar al ritmo pedido y se corta en las pausas: así el corte cae donde la
 * persona respira y no en mitad de una palabra.
 */
function splitAtSpeech(
  range: Range,
  segments: readonly { readonly start: number; readonly end: number }[],
  target: number,
  min: number,
): Range[] {
  const inside = segments
    .map((segment) => ({
      start: clamp(segment.start, range.start, range.end),
      end: clamp(segment.end, range.start, range.end),
    }))
    .filter((segment) => segment.end - segment.start > 0.08)
    .sort((a, b) => a.start - b.start);
  if (inside.length === 0) return [];
  const chunks: Range[] = [];
  let chunkStart = Math.max(range.start, inside[0]!.start);
  let chunkEnd = inside[0]!.end;
  for (const segment of inside.slice(1)) {
    const gap = segment.start - chunkEnd;
    const grown = segment.end - chunkStart;
    if (grown > target * 1.15 || gap > Math.max(0.5, target * 0.35)) {
      if (chunkEnd - chunkStart >= min * 0.6) {
        chunks.push({ start: chunkStart, end: chunkEnd });
      }
      chunkStart = segment.start;
      chunkEnd = segment.end;
      continue;
    }
    chunkEnd = Math.max(chunkEnd, segment.end);
  }
  if (chunkEnd - chunkStart >= min * 0.6) chunks.push({ start: chunkStart, end: chunkEnd });
  // Una cola corta se pega al corte anterior en vez de quedar como flash.
  const merged: Range[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && chunk.end - chunk.start < min * 0.6 && chunk.end - previous.start <= target * 1.8) {
      merged[merged.length - 1] = { start: previous.start, end: chunk.end };
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

function energyAt(energy: readonly number[] | null | undefined, seconds: number, duration: number): number {
  if (!energy || energy.length === 0 || duration <= 0) return 0.5;
  const index = Math.floor((seconds / duration) * energy.length);
  return clamp(energy[clamp(index, 0, energy.length - 1)] ?? 0.5, 0, 1);
}

function sceneDensity(scenes: readonly number[], start: number, end: number): number {
  if (end <= start) return 0;
  const inside = scenes.filter((scene) => scene >= start && scene <= end).length;
  const perSecond = inside / (end - start);
  // Más de un cambio de escena cada 1,5 s ya es "movido".
  return clamp(perSecond / 0.66, 0, 1);
}

/**
 * Interés de un segmento, 0–100. Es la suma ponderada de cuatro señales
 * medibles; ninguna depende del azar, así que dos análisis del mismo video
 * producen el mismo orden.
 */
export function scoreSegment(input: {
  readonly start: number;
  readonly end: number;
  readonly target: number;
  readonly duration: number;
  readonly scenes: readonly number[];
  readonly energy: readonly number[] | null | undefined;
  readonly hasSpeech: boolean;
}): number {
  const length = input.end - input.start;
  if (length <= 0) return 0;
  // 1. Ritmo: qué tan cerca está del corte pedido.
  const ratio = length / Math.max(0.2, input.target);
  const rhythm = clamp(1 - Math.abs(Math.log(clamp(ratio, 0.2, 5))) / 1.1, 0, 1);
  // 2. Movimiento: densidad de cambios de escena dentro del corte.
  const motion = sceneDensity(input.scenes, input.start, input.end);
  // 3. Energía de audio en el punto medio.
  const middle = input.start + length / 2;
  const energy = energyAt(input.energy, middle, input.duration);
  // 4. Voz: un segmento con habla sostiene la atención mejor que un plano mudo.
  const speech = input.hasSpeech ? 1 : 0.35;
  const score = rhythm * 26 + motion * 30 + energy * 28 + speech * 16;
  return Math.round(clamp(score, 0, 100));
}

function buildCandidates(source: AutoEditSource, recipe: AutoEditRecipe): Candidate[] {
  const analysis = source.analysis;
  if (analysis.kind !== 'video' || analysis.durationSeconds <= 0.5) return [];
  const ranges = cleanRanges(analysis);
  const target = clampRecipe(recipe).cutSeconds;
  const min = Math.max(MIN_CUT_SECONDS * 0.8, target * 0.45);
  const segments = source.transcript?.segments ?? [];
  const cleanLength = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
  const speechChunks = recipe.speechCuts && segments.length > 0
    ? ranges.flatMap((range) => splitAtSpeech(range, segments, target, min))
    : [];
  const speechLength = speechChunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);
  // Si la voz cubre poco del material (un plano sin diálogo, un paisaje), cortar
  // por frase tiraría la mayor parte del video: en ese caso manda la escena.
  const useSpeech = speechChunks.length > 0 && speechLength >= cleanLength * 0.35;
  const chunks = useSpeech
    ? speechChunks
    : ranges.flatMap((range) => splitAtScenes(range, analysis.scenes, target, min));
  const candidates: Candidate[] = [];
  for (const chunk of chunks) {
    const hasSpeech = segments.some(
      (segment) => segment.end > chunk.start + 0.05 && segment.start < chunk.end - 0.05,
    );
    const score = scoreSegment({
      start: chunk.start,
      end: chunk.end,
      target,
      duration: analysis.durationSeconds,
      scenes: analysis.scenes,
      energy: source.energy,
      hasSpeech,
    });
    candidates.push({
      assetId: source.assetId,
      start: chunk.start,
      end: chunk.end,
      score,
      reason: hasSpeech ? 'speech' : 'scene',
      hasSpeech,
    });
  }
  return candidates;
}

/**
 * Ordena los candidatos: primero el hook, después alternando fuentes para que
 * el montaje no se quede pegado a un solo archivo.
 */
function selectCuts(
  candidates: readonly Candidate[],
  recipe: AutoEditRecipe,
): AutoEditCut[] {
  const clean = clampRecipe(recipe);
  if (candidates.length === 0) return [];
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: AutoEditCut[] = [];
  const used = new Set<Candidate>();
  let total = 0;
  const limit = clean.targetSeconds > 0 ? clean.targetSeconds : Number.POSITIVE_INFINITY;

  if (clean.hook) {
    const best = ranked[0]!;
    // El hook se acorta: los primeros segundos tienen que enganchar ya.
    const hookEnd = Math.min(best.end, best.start + Math.min(2.4, clean.cutSeconds));
    if (hookEnd - best.start >= MIN_CUT_SECONDS * 0.6) {
      chosen.push({
        assetId: best.assetId,
        startSeconds: Number(best.start.toFixed(3)),
        endSeconds: Number(hookEnd.toFixed(3)),
        zoom: clean.zoom > 0,
        score: best.score,
        reason: 'hook',
      });
      used.add(best);
      total += hookEnd - best.start;
    }
  }

  const pool = ranked.filter((candidate) => !used.has(candidate));
  let lastAsset = chosen[chosen.length - 1]?.assetId ?? '';
  while (pool.length > 0 && total < limit) {
    // Preferir otra fuente si la hay: evita dos cortes seguidos del mismo video.
    const index = pool.findIndex((candidate) => candidate.assetId !== lastAsset);
    const picked = pool.splice(index >= 0 ? index : 0, 1)[0]!;
    const length = picked.end - picked.start;
    if (total + length > limit * 1.02 && chosen.length > 0) break;
    chosen.push({
      assetId: picked.assetId,
      startSeconds: Number(picked.start.toFixed(3)),
      endSeconds: Number(picked.end.toFixed(3)),
      zoom: clean.zoom > 0 && shouldZoom(chosen.length, clean.zoom),
      score: picked.score,
      reason: picked.reason,
    });
    lastAsset = picked.assetId;
    total += length;
  }

  // Si el objetivo no se alcanzó y quedó material, se rellenan los huecos con
  // los mejores candidatos restantes ya descartados por el corte de duración.
  if (clean.targetSeconds > 0 && total < clean.targetSeconds * 0.85) {
    for (const candidate of ranked) {
      if (total >= clean.targetSeconds * 0.95) break;
      if (chosen.some(
        (cut) =>
          cut.assetId === candidate.assetId &&
          cut.startSeconds === Number(candidate.start.toFixed(3)),
      )) {
        continue;
      }
      const length = candidate.end - candidate.start;
      if (total + length > clean.targetSeconds * 1.1) continue;
      chosen.push({
        assetId: candidate.assetId,
        startSeconds: Number(candidate.start.toFixed(3)),
        endSeconds: Number(candidate.end.toFixed(3)),
        zoom: clean.zoom > 0 && shouldZoom(chosen.length, clean.zoom),
        score: candidate.score,
        reason: 'fill',
      });
      total += length;
    }
  }

  // El hook queda siempre primero: es lo único que no se puede reordenar sin
  // perder el sentido del montaje.
  return chosen;
}

function shouldZoom(index: number, zoom: number): boolean {
  if (zoom <= 0) return false;
  if (zoom >= 85) return true;
  if (zoom >= 55) return index % 3 !== 2;
  return index % 3 === 0;
}

function remapCaptions(
  cuts: readonly AutoEditCut[],
  byAsset: ReadonlyMap<string, AutoEditSource>,
): AutoEditCaption[] {
  const captions: AutoEditCaption[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    const transcript = byAsset.get(cut.assetId)?.transcript;
    const length = cut.endSeconds - cut.startSeconds;
    if (transcript) {
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
    }
    cursor += length;
  }
  return captions;
}

function buildVariant(
  style: AutoEditStyle,
  name: string,
  description: string,
  recipe: AutoEditRecipe,
  candidates: readonly Candidate[],
  sources: readonly AutoEditSource[],
): AutoEditVariant | null {
  const cuts = selectCuts(candidates, recipe);
  if (cuts.length === 0) return null;
  const byAsset = new Map(sources.map((source) => [source.assetId, source] as const));
  const duration = cuts.reduce((sum, cut) => sum + (cut.endSeconds - cut.startSeconds), 0);
  const score =
    cuts.reduce((sum, cut) => sum + cut.score, 0) / Math.max(1, cuts.length);
  return {
    id: `auto-${style}`,
    style,
    name,
    description,
    recipe: clampRecipe(recipe),
    cuts,
    durationSeconds: Number(duration.toFixed(2)),
    zoomCount: cuts.filter((cut) => cut.zoom).length,
    captions: remapCaptions(cuts, byAsset),
    score: Math.round(score),
  };
}

/** Ritmos derivados de la receta base. */
export function variantRecipes(recipe: AutoEditRecipe): readonly {
  readonly style: AutoEditStyle;
  readonly name: string;
  readonly description: string;
  readonly recipe: AutoEditRecipe;
}[] {
  const base = clampRecipe(recipe);
  return [
    {
      style: 'custom',
      name: 'Tu receta',
      description: 'Exactamente el ritmo, el zoom y la transición que elegiste.',
      recipe: base,
    },
    {
      style: 'pulse',
      name: 'Pulso rápido',
      description: 'Cortes más cortos y más zoom: para redes.',
      recipe: {
        ...base,
        cutSeconds: Math.max(MIN_CUT_SECONDS, Math.round(base.cutSeconds * 0.6 * 10) / 10),
        zoom: Math.min(100, base.zoom + 25),
        hook: true,
      },
    },
    {
      style: 'story',
      name: 'Historia',
      description: 'Cortes largos y cámara quieta: deja respirar la escena.',
      recipe: {
        ...base,
        cutSeconds: Math.min(MAX_CUT_SECONDS, Math.round(base.cutSeconds * 1.6 * 10) / 10),
        zoom: Math.max(0, base.zoom - 30),
        transition: 'fade',
      },
    },
    {
      style: 'impact',
      name: 'Impacto',
      description: 'Un highlight corto con zoom en todos los cortes.',
      recipe: {
        ...base,
        cutSeconds: Math.max(MIN_CUT_SECONDS, Math.round(base.cutSeconds * 0.8 * 10) / 10),
        targetSeconds: Math.min(base.targetSeconds > 0 ? base.targetSeconds : 30, 30),
        zoom: 100,
        hook: true,
      },
    },
  ];
}

/**
 * Genera las variantes a partir de una o varias fuentes.
 *
 * Con varias fuentes el montaje alterna archivos; con una sola se comporta como
 * el editor automático de siempre.
 */
export function buildAutoEditVariants(
  sources: readonly AutoEditSource[] | AutoEditSource,
  recipe: AutoEditRecipe = DEFAULT_RECIPE,
): AutoEditVariant[] {
  const list = Array.isArray(sources) ? sources : [sources as AutoEditSource];
  if (list.length === 0) return [];
  // Cada ritmo se segmenta con su propia duración de corte: si se comparte el
  // pool, «Pulso» e «Historia» terminan con los mismos cortes.
  return variantRecipes(recipe)
    .map((variant) => {
      const candidates = list.flatMap((source) => buildCandidates(source, variant.recipe));
      if (candidates.length === 0) return null;
      return buildVariant(
        variant.style,
        variant.name,
        variant.description,
        variant.recipe,
        candidates,
        list,
      );
    })
    .filter((variant): variant is AutoEditVariant => variant !== null);
}

/**
 * Reordena los cortes de una variante según el orden que propuso la IA.
 * Los índices inválidos se ignoran: nunca se pierde material por una respuesta
 * mal formada.
 */
export function reorderVariant(
  variant: AutoEditVariant,
  order: readonly number[],
): AutoEditVariant {
  if (order.length === 0) return variant;
  const seen = new Set<number>();
  const cuts: AutoEditCut[] = [];
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= variant.cuts.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    cuts.push(variant.cuts[index]!);
  }
  for (let index = 0; index < variant.cuts.length; index += 1) {
    if (!seen.has(index)) cuts.push(variant.cuts[index]!);
  }
  if (cuts.length === 0) return variant;
  return withCuts(variant, cuts);
}

/**
 * Deja sólo los cortes elegidos. Los subtítulos se recortan y se reubican: un
 * corte descartado no puede dejar texto flotando sobre otro plano.
 */
export function subsetVariant(
  variant: AutoEditVariant,
  indices: readonly number[],
): AutoEditVariant {
  if (indices.length === 0) return variant;
  const wanted = new Set(
    indices.filter((index) => Number.isInteger(index) && index >= 0 && index < variant.cuts.length),
  );
  if (wanted.size === 0 || wanted.size === variant.cuts.length) return variant;
  const cuts = variant.cuts.filter((_, index) => wanted.has(index));
  return withCuts(variant, cuts);
}

/** Recalcula duración, zooms y subtítulos para un conjunto de cortes. */
function withCuts(
  variant: AutoEditVariant,
  cuts: readonly AutoEditCut[],
): AutoEditVariant {
  return {
    ...variant,
    cuts,
    captions: remapSelectedCaptions(variant, cuts),
    durationSeconds: Number(
      cuts.reduce((sum, cut) => sum + (cut.endSeconds - cut.startSeconds), 0).toFixed(2),
    ),
    zoomCount: cuts.filter((cut) => cut.zoom).length,
  };
}

/**
 * Reubica los subtítulos cuando cambia el orden o la selección de cortes.
 * Cada corte conoce su desplazamiento original dentro de la variante, así que
 * el texto sigue a su plano en vez de moverse a ciegas.
 */
function remapSelectedCaptions(
  variant: AutoEditVariant,
  cuts: readonly AutoEditCut[],
): AutoEditCaption[] {
  if (variant.captions.length === 0) return [];
  const offsets = new Map<AutoEditCut, number>();
  let cursor = 0;
  for (const cut of variant.cuts) {
    offsets.set(cut, cursor);
    cursor += cut.endSeconds - cut.startSeconds;
  }
  const captions: AutoEditCaption[] = [];
  let out = 0;
  for (const cut of cuts) {
    const offset = offsets.get(cut) ?? 0;
    const length = cut.endSeconds - cut.startSeconds;
    for (const caption of variant.captions) {
      const localStart = caption.startSeconds - offset;
      if (localStart < -0.001 || localStart >= length) continue;
      const localEnd = Math.min(caption.endSeconds - offset, length);
      if (localEnd - localStart < 0.12) continue;
      captions.push({
        startSeconds: Number((out + Math.max(0, localStart)).toFixed(3)),
        endSeconds: Number((out + localEnd).toFixed(3)),
        text: caption.text,
      });
    }
    out += length;
  }
  return captions;
}
