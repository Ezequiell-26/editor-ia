import type {
  Asset,
  Clip,
  ClipTransition,
  ProjectDocument,
} from '@editor-ia/project-schema';
import type {
  TranscriptionResult,
  TranscriptionSegment,
} from '../services/contracts';
import {
  addClipFromAsset,
  addTrack,
  cloneProject,
  fpsOf,
  touch,
  updateClip,
} from './project-actions';

// Palabras vacías en español e inglés para aislar conceptos clave
const STOP_WORDS = new Set([
  // Español
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por',
  'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'mas', 'pero',
  'sus', 'le', 'ya', 'este', 'esta', 'son', 'entre', 'esta', 'cuando', 'muy',
  'sin', 'sobre', 'ser', 'tiene', 'tambien', 'me', 'hasta', 'hay', 'donde',
  'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni',
  'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'esto', 'mi', 'antes',
  'algunos', 'que', 'unos', 'yo', 'otro', 'otras', 'otra', 'el', 'tanto',
  'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos', 'cual', 'sea', 'poco',
  'ella', 'estar', 'haber', 'estas', 'estaba', 'estamos', 'estan', 'aquellos',
  'bueno', 'entonces', 'vamos', 'aqui', 'alla', 'ahi', 'claro', 'digo', 'verdad',
  // Inglés
  'the', 'be', 'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for', 'not',
  'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by',
  'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one',
  'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about',
  'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
  'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now',
  'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
  'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new',
  'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'really',
]);

/**
 * Normaliza un texto removiendo tildes, signos ortográficos y convirtiendo a minúsculas.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae palabras clave semánticamente relevantes (sustantivos, verbos, términos significativos).
 */
export function extractKeywords(text: string): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  return clean
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Extrae el conjunto de tokens conceptuales que describen un material B-roll
 * (etiqueta, tags, bin/carpeta y nombre de archivo sin extensión).
 */
export function assetKeywords(asset: Asset): Set<string> {
  const parts: string[] = [asset.label];
  if (asset.tags && asset.tags.length > 0) {
    parts.push(...asset.tags);
  }
  if (asset.bin) {
    parts.push(asset.bin);
  }
  if (asset.source?.path) {
    const filename = asset.source.path.split(/[\\/]/).pop() ?? '';
    const stem = filename.replace(/\.[^.]+$/, '');
    parts.push(stem.replace(/[_-]/g, ' '));
  }

  const tokens = extractKeywords(parts.join(' '));
  return new Set(tokens);
}

export interface KeywordMatchResult {
  readonly score: number;
  readonly matchedKeywords: readonly string[];
}

/**
 * Calcula la afinidad semántica entre un conjunto de palabras dichas y los descriptores
 * del material B-roll, puntuando coincidencias exactas y de raíz.
 */
export function scoreBrollMatch(
  spokenWords: readonly string[],
  assetTokens: Set<string>,
): KeywordMatchResult {
  if (spokenWords.length === 0 || assetTokens.size === 0) {
    return { score: 0, matchedKeywords: [] };
  }

  const matched: string[] = [];
  let rawScore = 0;

  for (const word of spokenWords) {
    if (assetTokens.has(word)) {
      matched.push(word);
      rawScore += 10;
      continue;
    }
    // Coincidencia de prefijo (e.g. "computad" para computadora / computadoras)
    if (word.length >= 4) {
      const prefix = word.slice(0, 4);
      for (const token of assetTokens) {
        if (token.length >= 4 && token.startsWith(prefix)) {
          matched.push(word);
          rawScore += 7;
          break;
        }
      }
    }
  }

  if (matched.length === 0) {
    return { score: 0, matchedKeywords: [] };
  }

  // Normalización acotada de 0 a 100
  const normalized = Math.min(
    100,
    Math.round(rawScore * (1 + Math.log2(matched.length + 1))),
  );

  return {
    score: normalized,
    matchedKeywords: [...new Set(matched)],
  };
}

export interface PlannedBrollPlacement {
  readonly brollAssetId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly matchedKeywords: readonly string[];
  readonly score: number;
  readonly transcriptSnippet: string;
}

export interface PlanSemanticBrollOptions {
  readonly transcript: TranscriptionResult;
  readonly brollAssets: readonly Asset[];
  /** Duración mínima en segundos de cada inserción B-roll (por defecto 2.2 s). */
  readonly minDurationSeconds?: number;
  /** Duración máxima en segundos de cada inserción B-roll (por defecto 4.0 s). */
  readonly maxDurationSeconds?: number;
  /**
   * Intervalo mínimo en segundos entre dos inserciones de B-roll para mantener
   * ritmo humano sin saturar la pantalla (por defecto 5.0 s).
   */
  readonly minIntervalSeconds?: number;
  /** Puntaje mínimo de relevancia semántica para aceptar el corte (0..100, por defecto 20). */
  readonly minScore?: number;
  /** Límite máximo de planos B-roll a planificar (por defecto 15). */
  readonly maxPlacements?: number;
}

/**
 * Planifica las inserciones óptimas de B-roll analizando la transcripción de Whisper:
 * encuentra el momento exacto en que el orador menciona el concepto y selecciona el
 * material audiovisual correspondiente.
 */
export function planSemanticBroll(
  options: PlanSemanticBrollOptions,
): readonly PlannedBrollPlacement[] {
  const { transcript, brollAssets } = options;
  if (!transcript.segments || transcript.segments.length === 0 || brollAssets.length === 0) {
    return [];
  }

  const minDuration = options.minDurationSeconds ?? 2.2;
  const maxDuration = options.maxDurationSeconds ?? 4.0;
  const minInterval = options.minIntervalSeconds ?? 5.0;
  const minScore = options.minScore ?? 20;
  const maxPlacements = options.maxPlacements ?? 15;

  // Pre-computar tokens de cada asset B-roll disponible
  const assetMap = new Map<string, { asset: Asset; tokens: Set<string> }>();
  for (const asset of brollAssets) {
    if (asset.kind === 'video' || asset.kind === 'image') {
      const tokens = assetKeywords(asset);
      if (tokens.size > 0) {
        assetMap.set(asset.id, { asset, tokens });
      }
    }
  }

  if (assetMap.size === 0) return [];

  interface CandidateMatch {
    readonly segment: TranscriptionSegment;
    readonly assetId: string;
    readonly score: number;
    readonly matchedKeywords: readonly string[];
    readonly startSeconds: number;
    readonly durationSeconds: number;
  }

  const candidateMatches: CandidateMatch[] = [];

  for (const segment of transcript.segments) {
    const words = extractKeywords(segment.text);
    if (words.length === 0) continue;

    for (const [assetId, { asset, tokens }] of assetMap.entries()) {
      const { score, matchedKeywords } = scoreBrollMatch(words, tokens);
      if (score >= minScore) {
        // Duración basada en el fragmento hablado, limitada por min/max
        const segDuration = segment.end - segment.start;
        const duration = Math.max(minDuration, Math.min(maxDuration, segDuration));

        // Comprobar que el asset B-roll tenga suficiente metraje
        const assetDurationFrames =
          'media' in asset && asset.media && 'durationFrames' in asset.media
            ? (asset.media.durationFrames as number)
            : 300;
        const assetSeconds = assetDurationFrames / 30;
        const finalDuration = Math.min(duration, Math.max(1, assetSeconds));

        candidateMatches.push({
          segment,
          assetId,
          score,
          matchedKeywords,
          startSeconds: segment.start,
          durationSeconds: finalDuration,
        });
      }
    }
  }

  // Ordenar candidatos por mayor puntuación semántica
  candidateMatches.sort((a, b) => b.score - a.score);

  // Seleccionar inserciones respetando ritmo de espaciado y límite máximo
  const selected: PlannedBrollPlacement[] = [];
  const sortedByTime: PlannedBrollPlacement[] = [];

  for (const match of candidateMatches) {
    if (selected.length >= maxPlacements) break;

    const start = match.startSeconds;
    const end = start + match.durationSeconds;

    // Verificar que no se solape con otro B-roll ya planificado
    const collides = sortedByTime.some(
      (p) =>
        Math.max(p.startSeconds - minInterval, 0) < end &&
        p.endSeconds + minInterval > start,
    );

    if (!collides) {
      const placement: PlannedBrollPlacement = {
        brollAssetId: match.assetId,
        startSeconds: Number(start.toFixed(3)),
        endSeconds: Number(end.toFixed(3)),
        matchedKeywords: match.matchedKeywords,
        score: match.score,
        transcriptSnippet: match.segment.text.slice(0, 80),
      };
      selected.push(placement);
      sortedByTime.push(placement);
      sortedByTime.sort((a, b) => a.startSeconds - b.startSeconds);
    }
  }

  // Devolver ordenados cronológicamente
  return sortedByTime;
}

export interface ApplySemanticBrollOptions {
  readonly placements: readonly PlannedBrollPlacement[];
  /** Nombre de la pista de video superior donde se monta el B-roll (por defecto "B-Roll"). */
  readonly overlayTrackName?: string;
  /** Transición de entrada en cada corte B-roll (por defecto disolución suave). */
  readonly transition?: 'dissolve' | 'fade' | 'none';
  /** Silencia el audio original del material B-roll para no pisar la voz (por defecto: true). */
  readonly muteAudio?: boolean;
}

export interface ApplySemanticBrollResult {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly placedCount: number;
}

/**
 * Monta los planos B-roll seleccionados semánticamente en una pista de video
 * superpuesta (overlay track), conservando intacto el audio del plano de voz
 * inferior y aplicando disoluciones suaves al entrar y salir.
 */
export function applySemanticBroll(
  project: ProjectDocument,
  options: ApplySemanticBrollOptions,
): ApplySemanticBrollResult {
  const { placements } = options;
  if (placements.length === 0) {
    return { project, trackId: '', placedCount: 0 };
  }

  const fps = fpsOf(project);
  let next = cloneProject(project);

  // Buscar o crear la pista de overlay de video para B-roll
  const trackName = options.overlayTrackName ?? 'B-Roll';
  let track = next.timeline.tracks.find(
    (t) => t.kind === 'video' && t.label === trackName,
  );
  if (!track) {
    const created = addTrack(next, 'video', trackName);
    next = created.project;
    track = next.timeline.tracks.find((t) => t.id === created.trackId)!;
  }
  const trackId = track.id;

  const transitionType = options.transition ?? 'dissolve';
  const transition: ClipTransition | undefined =
    transitionType === 'dissolve'
      ? { type: 'dissolve', frames: 6 }
      : transitionType === 'fade'
        ? { type: 'fade-black', frames: 6 }
        : undefined;

  const muteAudio = options.muteAudio !== false;
  let placedCount = 0;

  for (const placement of placements) {
    const asset = next.assets.find((a) => a.id === placement.brollAssetId);
    if (!asset) continue;

    const atFrame = Math.max(0, Math.round(placement.startSeconds * fps));
    const durationFrames = Math.max(
      6,
      Math.round((placement.endSeconds - placement.startSeconds) * fps),
    );

    const added = addClipFromAsset(next, asset, {
      trackId,
      atFrame,
      durationFrames,
    });
    next = added.project;

    // Configurar clip: label descriptiva con los keywords, silencio de audio y transición
    next = updateClip(next, added.clipId, {
      label: `B-Roll · ${placement.matchedKeywords.slice(0, 2).join(', ')}`,
      ...(muteAudio ? { audio: { muted: true } } : {}),
      ...(transition ? { transitionIn: transition } : {}),
    });

    placedCount += 1;
  }

  touch(next);
  return {
    project: next,
    trackId,
    placedCount,
  };
}
