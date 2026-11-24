import type {
  KeyframeEasing,
  ProjectDocument,
  Track,
} from '@editor-ia/project-schema';
import type {
  AnalysisRange,
  TranscriptionResult,
  TranscriptionSegment,
} from '../services/contracts';
import { setTrackGainKeyframe } from './track-automation';
import { cloneProject, touch } from './project-actions';

/**
 * Ritmo dinámico y ducking de música para edición estilo YouTube.
 *
 * - `modulateCutSeconds`: curva de pacing que acelera intro/hook y climax,
 *   relaja el cuerpo y suaviza la salida.
 * - `detectPunchlineMoments`: identifica silencios dramáticos después de
 *   habla de alta energía donde un mute de música tiene impacto.
 * - `applyMusicDucking`: automatiza el volumen de la pista de música:
 *   baja durante voz, sube en silencios/B-roll, y mutea en punchlines.
 */

// ── Tipos ──────────────────────────────────────────────────────────────

export interface PacingZone {
  /** Nombre descriptivo de la zona. */
  readonly name: string;
  /** Inicio de la zona como fracción 0–1 de la duración total. */
  readonly start: number;
  /** Fin de la zona como fracción 0–1. */
  readonly end: number;
  /** Multiplicador sobre `cutSeconds` nominal. < 1 = cortes más rápidos. */
  readonly factor: number;
}

/** Un momento donde la música debería mutearse (punchline / pausa dramática). */
export interface PunchlineMoment {
  /** Segundo donde empieza el silencio/pausa. */
  readonly startSeconds: number;
  /** Segundo donde termina el silencio/pausa (onset de la siguiente frase). */
  readonly endSeconds: number;
  /** Confianza 0–1 de que es un momento dramático real. */
  readonly confidence: number;
  /** Razón de detección. */
  readonly reason: 'dramatic-pause' | 'silence-after-energy' | 'ellipsis';
}

export interface DuckingKeyframe {
  readonly seconds: number;
  readonly gainDb: number;
  readonly easing: KeyframeEasing;
}

export interface ApplyMusicDuckingOptions {
  /** ID de la pista de música. Si no se da, se busca por label que contenga "music" o "música". */
  readonly musicTrackId?: string;
  /** Transcripción para detectar cuándo hay voz. */
  readonly transcript?: TranscriptionResult | null;
  /** Silencios del análisis de media. */
  readonly silences?: readonly AnalysisRange[];
  /** Volumen durante voz activa (default -18 dB). */
  readonly voiceDuckDb?: number;
  /** Volumen durante silencio / B-roll (default -10 dB). */
  readonly swellDb?: number;
  /** Volumen de mute para punchlines (default -60 dB). */
  readonly muteDb?: number;
  /** Volumen base sin voz ni silencios (default -14 dB). */
  readonly baseDb?: number;
  /** Habilitar mutes en punchlines detectados. Default true. */
  readonly punchlineMutes?: boolean;
  /** Duración mínima del silencio para ser punchline, en segundos (default 0.6). */
  readonly minPauseDuration?: number;
}

export interface ApplyMusicDuckingResult {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly keyframeCount: number;
  readonly punchlineCount: number;
  readonly duckingKeyframes: readonly DuckingKeyframe[];
  readonly punchlines: readonly PunchlineMoment[];
}

// ── Zonas de pacing predeterminadas ────────────────────────────────────

/**
 * Zonas de pacing estilo YouTube:
 * - Hook / Intro (0–15%): cortes rápidos para enganchar.
 * - Cuerpo (15–80%): ritmo narrativo nominal.
 * - Clímax (80–95%): acelera hacia la conclusión.
 * - Outro (95–100%): un poco más lento para cerrar con calma.
 */
export const DEFAULT_PACING_ZONES: readonly PacingZone[] = [
  { name: 'hook',   start: 0,    end: 0.15, factor: 0.6 },
  { name: 'body',   start: 0.15, end: 0.80, factor: 1.0 },
  { name: 'climax', start: 0.80, end: 0.95, factor: 0.7 },
  { name: 'outro',  start: 0.95, end: 1.0,  factor: 1.2 },
];

// ── Pacing dinámico ────────────────────────────────────────────────────

function clampPacing(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Modula la duración de un corte según su posición relativa en la timeline.
 *
 * @param nominalSeconds - Duración base del corte (p.ej. 3 s).
 * @param positionSeconds - Posición del corte dentro de la timeline.
 * @param totalDuration - Duración total del montaje en segundos.
 * @param zones - Zonas de pacing; si no se dan se usan las predeterminadas.
 * @returns Duración modulada en segundos, clamped a [0.8, 12].
 */
export function modulateCutSeconds(
  nominalSeconds: number,
  positionSeconds: number,
  totalDuration: number,
  zones: readonly PacingZone[] = DEFAULT_PACING_ZONES,
): number {
  if (totalDuration <= 0 || !Number.isFinite(totalDuration)) return nominalSeconds;
  const position = clampPacing(positionSeconds / totalDuration, 0, 1);

  // Encontrar la zona; interpolar suavemente en los bordes.
  let factor = 1;
  for (const zone of zones) {
    if (position >= zone.start && position < zone.end) {
      // Suavizar la transición en el primer y último 15% de la zona.
      const zoneLength = zone.end - zone.start;
      const inZone = (position - zone.start) / zoneLength;
      const edgeSmooth = 0.15;
      let blend = 1;
      if (inZone < edgeSmooth && zone.start > 0) {
        blend = inZone / edgeSmooth; // fade-in desde la zona anterior
      } else if (inZone > 1 - edgeSmooth && zone.end < 1) {
        blend = (1 - inZone) / edgeSmooth; // fade-out hacia la zona siguiente
      }
      factor = 1 + (zone.factor - 1) * blend;
      break;
    }
  }

  // Clamp al rango que el motor acepta (mismos límites que autoedit-engine).
  return clampPacing(
    Math.round(nominalSeconds * factor * 10) / 10,
    0.8,
    12,
  );
}

/**
 * Calcula el nombre de la zona de pacing para una posición dada.
 */
export function pacingZoneAt(
  positionSeconds: number,
  totalDuration: number,
  zones: readonly PacingZone[] = DEFAULT_PACING_ZONES,
): string {
  if (totalDuration <= 0) return 'body';
  const position = clampPacing(positionSeconds / totalDuration, 0, 1);
  for (const zone of zones) {
    if (position >= zone.start && position < zone.end) return zone.name;
  }
  return zones[zones.length - 1]?.name ?? 'body';
}

// ── Detección de punchlines ────────────────────────────────────────────

/**
 * Detecta momentos de punchline / pausa dramática en la transcripción.
 *
 * Heurísticas:
 * 1. Silencios ≥ minPause tras un segmento de habla cuya energía textual es
 *    alta (frase larga, palabras enfáticas, signos de exclamación/pregunta).
 * 2. Segmentos que terminan en "..." (elipsis).
 * 3. Cruza con `silences` del análisis de media para confirmar pausas reales.
 */
export function detectPunchlineMoments(
  transcript: TranscriptionResult | null | undefined,
  silences: readonly AnalysisRange[] | null | undefined,
  minPauseDuration = 0.6,
): PunchlineMoment[] {
  const results: PunchlineMoment[] = [];
  if (!transcript || transcript.segments.length === 0) return results;

  const segments = transcript.segments;
  const silenceRanges = silences ?? [];

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i]!;
    const next = segments[i + 1]!;
    const gap = next.start - current.end;

    if (gap < minPauseDuration) continue;

    // Evaluar energía textual del segmento previo a la pausa.
    const energy = textEnergy(current);
    const isInSilence = silenceRanges.some(
      (s) => s.startSeconds <= current.end + 0.1 && s.endSeconds >= next.start - 0.1,
    );

    // Punchline por elipsis explícita.
    const trimmed = current.text.trim();
    if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
      results.push({
        startSeconds: round3(current.end),
        endSeconds: round3(next.start),
        confidence: clampPacing(0.6 + energy * 0.3, 0, 1),
        reason: 'ellipsis',
      });
      continue;
    }

    // Punchline por silencio después de frase energética.
    if (energy >= 0.4 && (isInSilence || gap >= minPauseDuration * 1.5)) {
      results.push({
        startSeconds: round3(current.end),
        endSeconds: round3(next.start),
        confidence: clampPacing(0.5 + energy * 0.4 + (isInSilence ? 0.1 : 0), 0, 1),
        reason: 'silence-after-energy',
      });
      continue;
    }

    // Pausa dramática larga (≥ 2× el mínimo), independientemente de la energía.
    if (gap >= minPauseDuration * 2) {
      results.push({
        startSeconds: round3(current.end),
        endSeconds: round3(next.start),
        confidence: clampPacing(0.4 + (gap / 3) * 0.3, 0, 0.9),
        reason: 'dramatic-pause',
      });
    }
  }

  return results;
}

/**
 * Energía textual de un segmento 0–1, basada en largo, puntuación y
 * diversidad de palabras.
 */
function textEnergy(segment: TranscriptionSegment): number {
  const text = segment.text.trim();
  if (!text) return 0;

  const words = text.split(/\s+/).length;
  // Frase larga = más energía (saturada a 15 palabras).
  const lengthScore = clampPacing(words / 15, 0, 1);
  // Exclamaciones / preguntas = énfasis.
  const hasExclamation = /[!¡]/.test(text) ? 0.2 : 0;
  const hasQuestion = /[?¿]/.test(text) ? 0.1 : 0;
  // Mayúsculas enfáticas (> 60% de las letras en mayúscula, excluyendo inicio de frase).
  const letters = text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  const capsRatio = letters.length > 3 ? upper / letters.length : 0;
  const capsScore = capsRatio > 0.6 ? 0.15 : 0;

  return clampPacing(lengthScore * 0.55 + hasExclamation + hasQuestion + capsScore, 0, 1);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Ducking y mutes de música ──────────────────────────────────────────

/**
 * Busca la pista de música en el proyecto.
 * Criterio: label contiene "music", "música", "musica", "bgm", o el track es
 * de kind audio sin clips de voz (heurística).
 */
function findMusicTrack(project: ProjectDocument, preferredId?: string): Track | null {
  if (preferredId) {
    const found = project.timeline.tracks.find((t) => t.id === preferredId);
    if (found) return found;
  }
  const musicPatterns = /\b(music|m[uú]sica|bgm|background\s*music|soundtrack)\b/i;
  return (
    project.timeline.tracks.find(
      (t) => t.kind === 'audio' && musicPatterns.test(t.label),
    ) ?? null
  );
}

/**
 * Genera los keyframes de ducking para una pista de música.
 *
 * Lógica:
 * 1. Recorre la transcripción segmento a segmento.
 * 2. Durante voz activa: duck a `voiceDuckDb`.
 * 3. Entre segmentos (silencio / B-roll): swell a `swellDb`.
 * 4. En punchlines detectados: mute a `muteDb` con ramp rápida.
 *
 * Los keyframes se generan en segundos; el caller los convierte a frames.
 */
export function buildDuckingKeyframes(
  transcript: TranscriptionResult | null | undefined,
  silences: readonly AnalysisRange[] | null | undefined,
  totalDuration: number,
  options: {
    readonly voiceDuckDb?: number;
    readonly swellDb?: number;
    readonly muteDb?: number;
    readonly baseDb?: number;
    readonly punchlineMutes?: boolean;
    readonly minPauseDuration?: number;
  } = {},
): { keyframes: DuckingKeyframe[]; punchlines: PunchlineMoment[] } {
  const voiceDuckDb = options.voiceDuckDb ?? -18;
  const swellDb = options.swellDb ?? -10;
  const muteDb = options.muteDb ?? -60;
  const baseDb = options.baseDb ?? -14;
  const doPunchlines = options.punchlineMutes !== false;
  const minPause = options.minPauseDuration ?? 0.6;

  const keyframes: DuckingKeyframe[] = [];
  const punchlines = doPunchlines
    ? detectPunchlineMoments(transcript, silences, minPause)
    : [];

  if (!transcript || transcript.segments.length === 0) {
    // Sin transcripción: volumen base constante.
    keyframes.push({ seconds: 0, gainDb: baseDb, easing: 'linear' });
    return { keyframes, punchlines };
  }

  // Partimos del volumen base al inicio.
  keyframes.push({ seconds: 0, gainDb: baseDb, easing: 'linear' });

  const punchlineSet = new Set(punchlines.map((p) => round3(p.startSeconds)));
  const segments = transcript.segments;

  // Ramp corta antes del primer segmento de voz para ducking.
  const RAMP = 0.15; // ramp de transición en segundos.

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const prevEnd = i > 0 ? segments[i - 1]!.end : 0;
    const gap = seg.start - prevEnd;

    // ¿Hay un punchline en este gap?
    const isPunchline = punchlineSet.has(round3(prevEnd));

    if (isPunchline && i > 0) {
      // Mute rápido justo antes del gap.
      const muteStart = Math.max(0, prevEnd - RAMP);
      keyframes.push({ seconds: round3(muteStart), gainDb: voiceDuckDb, easing: 'ease-out' });
      keyframes.push({ seconds: round3(prevEnd), gainDb: muteDb, easing: 'hold' });
      // Mantener mute durante el gap y ramp-up al inicio de la siguiente frase.
      keyframes.push({ seconds: round3(seg.start - RAMP), gainDb: muteDb, easing: 'ease-in' });
      keyframes.push({ seconds: round3(seg.start), gainDb: voiceDuckDb, easing: 'linear' });
    } else if (gap > 0.4) {
      // Silencio entre frases: swell de música.
      if (i > 0) {
        keyframes.push({ seconds: round3(prevEnd), gainDb: voiceDuckDb, easing: 'ease-out' });
        keyframes.push({ seconds: round3(prevEnd + RAMP), gainDb: swellDb, easing: 'linear' });
      }
      // Duck de nuevo antes de la siguiente frase.
      keyframes.push({ seconds: round3(Math.max(0, seg.start - RAMP)), gainDb: swellDb, easing: 'ease-in' });
      keyframes.push({ seconds: round3(seg.start), gainDb: voiceDuckDb, easing: 'linear' });
    } else if (i === 0) {
      // Primer segmento: duck desde el inicio.
      if (seg.start > RAMP) {
        keyframes.push({ seconds: round3(seg.start - RAMP), gainDb: baseDb, easing: 'ease-in' });
      }
      keyframes.push({ seconds: round3(seg.start), gainDb: voiceDuckDb, easing: 'linear' });
    }
  }

  // Después del último segmento: volver al volumen base / swell.
  const lastEnd = segments[segments.length - 1]!.end;
  if (lastEnd < totalDuration) {
    keyframes.push({ seconds: round3(lastEnd), gainDb: voiceDuckDb, easing: 'ease-out' });
    keyframes.push({ seconds: round3(lastEnd + RAMP), gainDb: swellDb, easing: 'linear' });
  }

  // Deduplicar keyframes que caigan en el mismo segundo (quedarse con el último).
  return { keyframes: deduplicateKeyframes(keyframes), punchlines };
}

function deduplicateKeyframes(kfs: DuckingKeyframe[]): DuckingKeyframe[] {
  const sorted = [...kfs].sort((a, b) => a.seconds - b.seconds);
  const result: DuckingKeyframe[] = [];
  for (const kf of sorted) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.seconds - kf.seconds) < 0.005) {
      // Mismo momento: reemplazar con el que tiene el valor más extremo
      // (priorizar mutes sobre ducks).
      result[result.length - 1] = kf;
    } else {
      result.push(kf);
    }
  }
  return result;
}

// ── Aplicación a la timeline ───────────────────────────────────────────

/**
 * Aplica ducking automático y mutes de punchline a la pista de música del
 * proyecto. Usa gain keyframes de pista (TrackGainKeyframe) para no
 * conflictuar con los gain keyframes de clip.
 */
export function applyMusicDucking(
  project: ProjectDocument,
  options: ApplyMusicDuckingOptions = {},
): ApplyMusicDuckingResult {
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const musicTrack = findMusicTrack(project, options.musicTrackId);

  if (!musicTrack) {
    // Sin pista de música: retornar sin cambios.
    return {
      project,
      trackId: '',
      keyframeCount: 0,
      punchlineCount: 0,
      duckingKeyframes: [],
      punchlines: [],
    };
  }

  // Duración total del contenido de la pista de música (último frame de sus clips).
  const musicClips = project.timeline.clips.filter(
    (c) => c.trackId === musicTrack.id,
  );
  const totalFramesMusic = musicClips.reduce(
    (max, c) => Math.max(max, c.startFrame + c.durationFrames),
    0,
  );
  const totalDuration = totalFramesMusic / fps;

  const { keyframes, punchlines } = buildDuckingKeyframes(
    options.transcript,
    options.silences,
    totalDuration,
    {
      ...(options.voiceDuckDb !== undefined ? { voiceDuckDb: options.voiceDuckDb } : {}),
      ...(options.swellDb !== undefined ? { swellDb: options.swellDb } : {}),
      ...(options.muteDb !== undefined ? { muteDb: options.muteDb } : {}),
      ...(options.baseDb !== undefined ? { baseDb: options.baseDb } : {}),
      ...(options.punchlineMutes !== undefined ? { punchlineMutes: options.punchlineMutes } : {}),
      ...(options.minPauseDuration !== undefined ? { minPauseDuration: options.minPauseDuration } : {}),
    },
  );

  // Aplicar keyframes de ganancia a la pista.
  let next = cloneProject(project);

  // Limpiar SÓLO los keyframes generados por ducking previo ('auto-duck');
  // los manuales del usuario se preservan (antes se borraban todos).
  const track = next.timeline.tracks.find((t) => t.id === musicTrack.id);
  if (track) {
    const remaining = (track.gainKeyframes ?? []).filter(
      (keyframe) => keyframe.origin !== 'auto-duck',
    );
    if (remaining.length === 0) {
      delete track.gainKeyframes;
    } else {
      track.gainKeyframes = remaining;
    }
  }
  touch(next);

  // Escribir los nuevos keyframes con la API de track-automation,
  // marcándolos como generados para que la próxima corrida los reemplace.
  // Un keyframe manual en el mismo frame gana: el ducking lo salta.
  const manualFrames = new Set(
    (track?.gainKeyframes ?? []).map((keyframe) => keyframe.frame),
  );
  const written: DuckingKeyframe[] = [];
  for (const kf of keyframes) {
    const frame = Math.max(0, Math.round(kf.seconds * fps));
    if (manualFrames.has(frame)) continue;
    // setTrackGainKeyframe valida rango [-60, 12] y hace upsert + sort.
    next = setTrackGainKeyframe(
      next,
      musicTrack.id,
      frame,
      kf.gainDb,
      kf.easing,
      'auto-duck',
    );
    written.push(kf);
  }

  return {
    project: next,
    trackId: musicTrack.id,
    keyframeCount: written.length,
    punchlineCount: punchlines.length,
    duckingKeyframes: keyframes,
    punchlines,
  };
}
