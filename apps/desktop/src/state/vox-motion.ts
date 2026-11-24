import type { ProjectDocument } from '@editor-ia/project-schema';
import type { TranscriptionResult } from '../services/contracts';
import { addMotionGraphic, cloneProject, fpsOf, touch } from './project-actions';

/**
 * Efectos explicativos estilo Vox (Pilar 6):
 * - Resaltador de texto animado (subrayado tipo rotulador sobre citas / titulares).
 * - Contador numérico dinámico (métricas y estadísticas animadas).
 * - Callout elástico con emoji (pills / badges con rebote para enfatizar revelaciones).
 * - Detección automática de momentos clave en la transcripción.
 */

// ── Tipos ──────────────────────────────────────────────────────────────

export interface AddVoxHighlighterOptions {
  readonly text: string;
  readonly highlight?: string;
  readonly highlighterColor?: string;
  readonly textColor?: string;
  readonly cardColor?: string;
  readonly animation?: 'wipe' | 'write' | 'fade' | 'pop';
  readonly atFrame: number;
  readonly durationFrames?: number;
  readonly trackId?: string;
  readonly label?: string;
}

export interface AddVoxCounterOptions {
  readonly value: string;
  readonly label: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly accent?: string;
  readonly cardColor?: string;
  readonly animation?: 'pop' | 'slide-up' | 'fade';
  readonly atFrame: number;
  readonly durationFrames?: number;
  readonly trackId?: string;
  readonly titleLabel?: string;
}

export interface AddVoxCalloutOptions {
  readonly emoji?: string;
  readonly headline?: string;
  readonly text: string;
  readonly accent?: string;
  readonly textColor?: string;
  readonly cardColor?: string;
  readonly animation?: 'back' | 'pop' | 'slide-up';
  readonly atFrame: number;
  readonly durationFrames?: number;
  readonly trackId?: string;
  readonly label?: string;
}

export type VoxKind = 'highlighter' | 'counter' | 'callout';

export interface DetectedVoxMoment {
  readonly kind: VoxKind;
  readonly atSeconds: number;
  readonly atFrame: number;
  readonly durationFrames: number;
  readonly text: string;
  readonly contextSnippet: string;
  readonly confidence: number;
  readonly suggestedProps: Record<string, unknown>;
}

export interface AutoPlaceVoxOptions {
  readonly highlighters?: boolean;
  readonly counters?: boolean;
  readonly callouts?: boolean;
  readonly minIntervalFrames?: number;
  readonly defaultDurationFrames?: number;
  readonly trackName?: string;
}

export interface AutoPlaceVoxResult {
  readonly project: ProjectDocument;
  readonly placedCount: number;
  readonly moments: readonly DetectedVoxMoment[];
  readonly trackId: string;
}

// ── Funciones de creación de clips individuales ────────────────────────

export function addVoxHighlighter(
  project: ProjectDocument,
  options: AddVoxHighlighterOptions,
): {
  project: ProjectDocument;
  clipId: string;
  motionId: string;
  trackId: string;
  startFrame: number;
} {
  const fps = fpsOf(project);
  const durationFrames = options.durationFrames ?? Math.round(fps * 3.5);

  const props: Record<string, unknown> = {
    text: options.text,
    highlight: options.highlight ?? '',
    ...(options.highlighterColor ? { highlighterColor: options.highlighterColor } : {}),
    ...(options.textColor ? { textColor: options.textColor } : {}),
    ...(options.cardColor ? { cardColor: options.cardColor } : {}),
    ...(options.animation ? { animation: options.animation } : {}),
  };

  return addMotionGraphic(project, {
    templateId: 'vox-highlighter',
    templateVersion: '1.0.0',
    props,
    atFrame: options.atFrame,
    durationFrames,
    ...(options.trackId ? { trackId: options.trackId } : {}),
    label: options.label ?? `Vox · Resaltador: "${options.highlight || options.text.slice(0, 24)}"`,
  });
}

export function addVoxCounter(
  project: ProjectDocument,
  options: AddVoxCounterOptions,
): {
  project: ProjectDocument;
  clipId: string;
  motionId: string;
  trackId: string;
  startFrame: number;
} {
  const fps = fpsOf(project);
  const durationFrames = options.durationFrames ?? Math.round(fps * 3.0);

  const props: Record<string, unknown> = {
    value: options.value,
    label: options.label,
    ...(options.prefix ? { prefix: options.prefix } : {}),
    ...(options.suffix ? { suffix: options.suffix } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
    ...(options.cardColor ? { cardColor: options.cardColor } : {}),
    ...(options.animation ? { animation: options.animation } : {}),
  };

  return addMotionGraphic(project, {
    templateId: 'vox-counter',
    templateVersion: '1.0.0',
    props,
    atFrame: options.atFrame,
    durationFrames,
    ...(options.trackId ? { trackId: options.trackId } : {}),
    label: options.titleLabel ?? `Vox · Contador: ${options.prefix ?? ''}${options.value}${options.suffix ?? ''}`,
  });
}

export function addVoxCallout(
  project: ProjectDocument,
  options: AddVoxCalloutOptions,
): {
  project: ProjectDocument;
  clipId: string;
  motionId: string;
  trackId: string;
  startFrame: number;
} {
  const fps = fpsOf(project);
  const durationFrames = options.durationFrames ?? Math.round(fps * 3.0);

  const props: Record<string, unknown> = {
    text: options.text,
    ...(options.emoji ? { emoji: options.emoji } : {}),
    ...(options.headline ? { headline: options.headline } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
    ...(options.textColor ? { textColor: options.textColor } : {}),
    ...(options.cardColor ? { cardColor: options.cardColor } : {}),
    ...(options.animation ? { animation: options.animation } : {}),
  };

  return addMotionGraphic(project, {
    templateId: 'vox-callout',
    templateVersion: '1.0.0',
    props,
    atFrame: options.atFrame,
    durationFrames,
    ...(options.trackId ? { trackId: options.trackId } : {}),
    label: options.label ?? `Vox · Callout: ${options.emoji ?? '💡'} ${options.headline ?? 'DATO'}`,
  });
}

// ── Detección automática en transcripción / cues ───────────────────────

/**
 * Patrones para detectar datos métricos numéricos (contador estilo Vox).
 */
const STAT_NUMBER_REGEX =
  /(?:^|\s)([$€£+])?(\d{1,3}(?:[.,]\d{1,3})*|\d+)\s*(%|k|m|b|millones?|mil(?:es)?|dólares?|pesos?|x)?(?:\s|$|[.,;:])/i;

/**
 * Palabras clave que justifican un callout de alerta, revelación o advertencia.
 */
const CALLOUT_ALERT_REGEX =
  /\b(ojo|cuidado|peligro|atenci[oó]n|secreto|error|fallo|truco|clave|incre[ií]ble|revelaci[oó]n|alerta|importante)\b/i;

const EMOJI_BY_KEYWORD: readonly [RegExp, string, string][] = [
  [/\b(ojo|atenci[oó]n|alerta|cuidado|peligro)\b/i, '⚠️', 'ATENCIÓN'],
  [/\b(secreto|truco|clave)\b/i, '💡', 'DATO CLAVE'],
  [/\b(error|fallo|problema|p[eé]rdida)\b/i, '❌', 'ERROR CRÍTICO'],
  [/\b(éxito|victoria|ganancia|subi[oó]|creci[oó])\b/i, '📈', 'CRECIMIENTO'],
  [/\b(incre[ií]ble|revelaci[oó]n|futuro|revoluci[oó]n)\b/i, '🚀', 'REVELACIÓN'],
  [/\b(dinero|d[oó]lares?|precio|costo|inversi[oó]n)\b/i, '💰', 'IMPACTO'],
];

/**
 * Escanea la transcripción para detectar oportunidades de gráficos explicativos tipo Vox.
 */
export function detectVoxMoments(
  project: ProjectDocument,
  transcript?: TranscriptionResult | null,
): DetectedVoxMoment[] {
  const fps = fpsOf(project);
  const moments: DetectedVoxMoment[] = [];

  // Combinar los segmentos de transcript con los caption cues del proyecto.
  interface TextSegment {
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly text: string;
  }
  const items: TextSegment[] = [];

  if (transcript && transcript.segments.length > 0) {
    for (const seg of transcript.segments) {
      items.push({
        startSeconds: seg.start,
        endSeconds: seg.end,
        text: seg.text.trim(),
      });
    }
  } else {
    for (const cue of project.captions.cues) {
      items.push({
        startSeconds: cue.startFrame / fps,
        endSeconds: cue.endFrame / fps,
        text: cue.text.trim(),
      });
    }
  }

  for (const item of items) {
    const raw = item.text;
    if (!raw || raw.length < 3) continue;

    const atFrame = Math.round(item.startSeconds * fps);
    const durationFrames = Math.max(
      Math.round(fps * 2.5),
      Math.round((item.endSeconds - item.startSeconds) * fps),
    );

    // 1. Detección de Contador Numérico
    const statMatch = raw.match(STAT_NUMBER_REGEX);
    if (statMatch && statMatch[2]) {
      const prefix = statMatch[1] ?? '';
      const numStr = statMatch[2];
      const suffix = statMatch[3] ? statMatch[3].toUpperCase() : '';
      const fullMetric = `${prefix}${numStr}${suffix}`;

      // Extraer un label de contexto razonable (palabras circundantes).
      const label = raw
        .replace(STAT_NUMBER_REGEX, ' ')
        .replace(/[¿?¡!.,;]/g, '')
        .trim()
        .slice(0, 40) || 'métrica destacada';

      moments.push({
        kind: 'counter',
        atSeconds: item.startSeconds,
        atFrame,
        durationFrames,
        text: fullMetric,
        contextSnippet: raw,
        confidence: 0.88,
        suggestedProps: {
          value: numStr,
          prefix,
          suffix,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          accent: '#38bdf8',
        },
      });
      continue;
    }

    // 2. Detección de Callout con Emoji por palabras de impacto
    const alertMatch = raw.match(CALLOUT_ALERT_REGEX);
    if (alertMatch) {
      let matchedEmoji = '💡';
      let matchedHeadline = 'DATO CLAVE';
      for (const [re, emoji, headline] of EMOJI_BY_KEYWORD) {
        if (re.test(raw)) {
          matchedEmoji = emoji;
          matchedHeadline = headline;
          break;
        }
      }

      moments.push({
        kind: 'callout',
        atSeconds: item.startSeconds,
        atFrame,
        durationFrames,
        text: raw,
        contextSnippet: raw,
        confidence: 0.85,
        suggestedProps: {
          emoji: matchedEmoji,
          headline: matchedHeadline,
          text: raw.slice(0, 80),
          accent: matchedEmoji === '⚠️' ? '#ef4444' : '#f59e0b',
        },
      });
      continue;
    }

    // 3. Detección de Resaltador de Cita / Pregunta / Frase clave
    const isQuestion = /[¿?]/i.test(raw);
    const isKeyQuote = /(".*"|'.*'|\b(la clave|el problema|la solución|el secreto|lo importante)\b)/i.test(raw);

    if (isQuestion || isKeyQuote) {
      // Extraer la parte a resaltar
      const quoteMatch = raw.match(/["']([^"']+)["']/);
      const highlight = quoteMatch ? quoteMatch[1] : (raw.length > 25 ? raw.slice(0, 35) : raw);

      moments.push({
        kind: 'highlighter',
        atSeconds: item.startSeconds,
        atFrame,
        durationFrames,
        text: raw,
        contextSnippet: raw,
        confidence: isQuestion ? 0.82 : 0.78,
        suggestedProps: {
          text: raw,
          highlight,
          highlighterColor: '#fde047',
          animation: 'wipe',
        },
      });
    }
  }

  return moments;
}

// ── Colocación automática de gráficos Vox ──────────────────────────────

export function autoPlaceVoxGraphics(
  project: ProjectDocument,
  options: AutoPlaceVoxOptions = {},
): AutoPlaceVoxResult {
  const fps = fpsOf(project);
  const minInterval = options.minIntervalFrames ?? Math.round(fps * 4.0); // 4s entre gráficos
  const doHighlighters = options.highlighters !== false;
  const doCounters = options.counters !== false;
  const doCallouts = options.callouts !== false;

  const rawMoments = detectVoxMoments(project);
  const filteredMoments = rawMoments.filter((m) => {
    if (m.kind === 'highlighter' && !doHighlighters) return false;
    if (m.kind === 'counter' && !doCounters) return false;
    if (m.kind === 'callout' && !doCallouts) return false;
    return true;
  });

  // Ordenar cronológicamente y aplicar espaciado anti-saturación
  filteredMoments.sort((a, b) => a.atFrame - b.atFrame);

  const acceptedMoments: DetectedVoxMoment[] = [];
  let lastPlacedFrame = -minInterval;

  for (const moment of filteredMoments) {
    if (moment.atFrame - lastPlacedFrame >= minInterval) {
      acceptedMoments.push(moment);
      lastPlacedFrame = moment.atFrame;
    }
  }

  let next = cloneProject(project);
  let placedCount = 0;
  let targetTrackId = '';

  for (const m of acceptedMoments) {
    if (m.kind === 'counter') {
      const res = addVoxCounter(next, {
        value: String(m.suggestedProps.value ?? '100'),
        label: String(m.suggestedProps.label ?? ''),
        prefix: String(m.suggestedProps.prefix ?? ''),
        suffix: String(m.suggestedProps.suffix ?? ''),
        accent: String(m.suggestedProps.accent ?? '#38bdf8'),
        atFrame: m.atFrame,
        durationFrames: m.durationFrames,
      });
      next = res.project;
      targetTrackId = res.trackId;
      placedCount += 1;
    } else if (m.kind === 'callout') {
      const res = addVoxCallout(next, {
        emoji: String(m.suggestedProps.emoji ?? '💡'),
        headline: String(m.suggestedProps.headline ?? 'DATO'),
        text: String(m.suggestedProps.text ?? m.text),
        accent: String(m.suggestedProps.accent ?? '#f59e0b'),
        atFrame: m.atFrame,
        durationFrames: m.durationFrames,
      });
      next = res.project;
      targetTrackId = res.trackId;
      placedCount += 1;
    } else if (m.kind === 'highlighter') {
      const res = addVoxHighlighter(next, {
        text: String(m.suggestedProps.text ?? m.text),
        highlight: String(m.suggestedProps.highlight ?? ''),
        highlighterColor: String(m.suggestedProps.highlighterColor ?? '#fde047'),
        animation: 'wipe',
        atFrame: m.atFrame,
        durationFrames: m.durationFrames,
      });
      next = res.project;
      targetTrackId = res.trackId;
      placedCount += 1;
    }
  }

  touch(next);
  return {
    project: next,
    placedCount,
    moments: acceptedMoments,
    trackId: targetTrackId,
  };
}
