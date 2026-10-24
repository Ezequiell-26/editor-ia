/**
 * SRT/VTT/ASS parsing and SRT serialization. Kept framework-free so the import
 * action, the export button and the tests share the same rules.
 */

import type { CaptionCue, CaptionWord } from '@editor-ia/project-schema';
// Se importa el parser SSA/ASS directo: el entry de `subsrt` carga todos los
// formatos con `require('./format/' + nombre + '.js')`, una require dinámica
// que Rollup no resuelve y que dejaba la ventana de producción en negro.
import ssaFormat from 'subsrt/lib/format/ssa.js';

export interface SubtitleCueSeconds {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa';

export interface ParsedSubtitles {
  readonly format: SubtitleFormat;
  readonly cues: SubtitleCueSeconds[];
  readonly warnings: string[];
}

const TIMING =
  /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

/**
 * Words that should be on screen at a frame. In reveal mode the cue grows one
 * word at a time; otherwise every timed word is returned for highlighting.
 */
export function cueWordsAt(cue: CaptionCue, playheadFrame: number): CaptionWord[] {
  const words = cue.words ?? [];
  if (!cue.wordReveal) return [...words];
  return words.filter((word) => playheadFrame >= word.startFrame);
}

function seconds(
  hours: string | undefined,
  minutes: string,
  secs: string,
  millis: string,
): number {
  const fraction = millis.padEnd(3, '0').slice(0, 3);
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(secs) +
    Number(fraction) / 1000
  );
}

function cleanText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CapCut, Premiere and Resolve export styled subtitles as ASS/SSA. Importing
 * them keeps the text and the timing; the styling is intentionally dropped
 * because Olyvia owns caption styling per project.
 */
function detectAlphaFormat(content: string): 'ass' | 'ssa' | null {
  const looksAlpha =
    /^\s*\[Script Info\]/im.test(content) || /^\s*Dialogue:/im.test(content);
  if (!looksAlpha) {
    return null;
  }
  if (
    /^\s*ScriptType:\s*v4\.00\+/im.test(content) ||
    /^\s*\[V4\+ Styles\]/im.test(content)
  ) {
    return 'ass';
  }
  if (
    /^\s*ScriptType:\s*v4\.00\s*$/im.test(content) ||
    /^\s*\[V4 Styles\]/im.test(content)
  ) {
    return 'ssa';
  }
  return 'ass';
}

function parseAlphaSubtitles(content: string, format: 'ass' | 'ssa'): ParsedSubtitles {
  const warnings: string[] = [];
  const cues: SubtitleCueSeconds[] = [];
  let captions: ReturnType<typeof ssaFormat.parse>;
  try {
    // El parser convierte `\N` en salto de línea y quita las etiquetas `{...}`.
    captions = ssaFormat.parse(content, { eol: '\n' });
  } catch {
    return {
      format,
      cues: [],
      warnings: [`El archivo ${format.toUpperCase()} no se pudo leer.`],
    };
  }

  for (const [index, caption] of captions.entries()) {
    if (caption.type !== 'caption') continue;
    const text = cleanText(caption.text);
    const startSeconds = caption.start / 1000;
    const endSeconds = caption.end / 1000;
    if (!text) {
      warnings.push(`Diálogo ${index + 1}: no tiene texto.`);
      continue;
    }
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      endSeconds <= startSeconds
    ) {
      warnings.push(`Diálogo ${index + 1}: tiempos inválidos.`);
      continue;
    }
    cues.push({ startSeconds, endSeconds, text });
  }

  if (cues.length === 0 && warnings.length === 0) {
    warnings.push(`El archivo ${format.toUpperCase()} no tiene diálogos visibles.`);
  }
  cues.sort((a, b) => a.startSeconds - b.startSeconds);
  return { format, cues, warnings };
}

export function parseSubtitles(content: string): ParsedSubtitles {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const alpha = detectAlphaFormat(normalized);
  if (alpha) {
    return parseAlphaSubtitles(normalized, alpha);
  }
  const format = /^\s*WEBVTT\b/i.test(normalized) ? 'vtt' : 'srt';
  const body =
    format === 'vtt'
      ? normalized.replace(/^\s*WEBVTT[^\n]*\n/i, '')
      : normalized;
  const blocks = body.split(/\n{2,}/);
  const cues: SubtitleCueSeconds[] = [];
  const warnings: string[] = [];
  for (const [index, rawBlock] of blocks.entries()) {
    const lines = rawBlock
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      warnings.push(`Bloque ${index + 1}: no tiene una línea de tiempos.`);
      continue;
    }
    const match = TIMING.exec(lines[timingIndex]!);
    if (!match) {
      warnings.push(`Bloque ${index + 1}: tiempos inválidos.`);
      continue;
    }
    const startSeconds = seconds(match[1], match[2]!, match[3]!, match[4]!);
    const endSeconds = seconds(match[5], match[6]!, match[7]!, match[8]!);
    const text = cleanText(lines.slice(timingIndex + 1).join(' '));
    if (!text) {
      warnings.push(`Bloque ${index + 1}: no tiene texto.`);
      continue;
    }
    if (endSeconds <= startSeconds) {
      warnings.push(`Bloque ${index + 1}: termina antes de empezar.`);
      continue;
    }
    cues.push({ startSeconds, endSeconds, text });
  }
  cues.sort((a, b) => a.startSeconds - b.startSeconds);
  return { format, cues, warnings };
}

function timestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secs,
  ).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export interface SubtitleCueFrames {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly text: string;
}

function clock(totalSeconds: number, separator: ',' | '.'): string {
  const clamped = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secs,
  ).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function orderedCues(cues: readonly SubtitleCueSeconds[]): SubtitleCueSeconds[] {
  return [...cues]
    .filter((cue) => cue.text.trim() && Number.isFinite(cue.startSeconds) && cue.endSeconds > cue.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

/** SRT desde tiempos en segundos; lo usa la localización multiidioma. */
export function serializeSrtSeconds(cues: readonly SubtitleCueSeconds[]): string {
  const ordered = orderedCues(cues);
  return ordered
    .map(
      (cue, index) =>
        `${index + 1}\n${clock(cue.startSeconds, ',')} --> ${clock(
          cue.endSeconds,
          ',',
        )}\n${cue.text.trim()}`,
    )
    .join('\n\n')
    .concat(ordered.length > 0 ? '\n' : '');
}

/** VTT desde tiempos en segundos, con la cabecera obligatoria. */
export function serializeVttSeconds(cues: readonly SubtitleCueSeconds[]): string {
  const ordered = orderedCues(cues);
  const body = ordered
    .map(
      (cue, index) =>
        `${index + 1}\n${clock(cue.startSeconds, '.')} --> ${clock(
          cue.endSeconds,
          '.',
        )}\n${cue.text.trim()}`,
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

export function serializeSrt(
  cues: readonly SubtitleCueFrames[],
  fps: number,
): string {
  const rate = fps > 0 ? fps : 30;
  const ordered = [...cues]
    .filter((cue) => cue.text.trim() && cue.endFrame > cue.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);
  return ordered
    .map((cue, index) => {
      const start = timestamp(cue.startFrame / rate);
      const end = timestamp(cue.endFrame / rate);
      return `${index + 1}\n${start} --> ${end}\n${cue.text.trim()}`;
    })
    .join('\n\n')
    .concat(ordered.length > 0 ? '\n' : '');
}
