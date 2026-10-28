/**
 * Exportación de los cues actuales a .srt, .vtt y .ass.
 *
 * Reutiliza el pipeline de `subtitles.ts`: el SRT sale del serializador que ya
 * existía y se agregan los que faltaban (VTT y ASS) con las mismas reglas de
 * orden y de descarte. Framework-free para que la acción de export, el paquete
 * de entrega y los tests compartan las mismas reglas.
 *
 * Al igual que en la importación, el estilo se omite a propósito: Olyvia es
 * dueña del estilo de los subtítulos por proyecto, así que el ASS se escribe
 * con un estilo `Default` neutro y solo lleva texto y tiempos.
 */

import { serializeSrt, type SubtitleCueFrames } from './subtitles';

export const SUBTITLE_EXPORT_FORMATS = ['srt', 'vtt', 'ass'] as const;
export type SubtitleExportFormat = (typeof SUBTITLE_EXPORT_FORMATS)[number];

export interface SubtitleExportFile {
  /** Formato solicitado; coincide con la extensión del archivo. */
  readonly format: SubtitleExportFormat;
  readonly extension: SubtitleExportFormat;
  readonly mimeType: string;
  readonly content: string;
}

export interface SubtitleExportOptions {
  /** Resolución declarada en el header ASS (`PlayResX`/`PlayResY`). */
  readonly playResX?: number;
  readonly playResY?: number;
}

/** Mismo criterio que `orderedCues` de subtitles.ts, pero en frames. */
function orderedFrames(
  cues: readonly SubtitleCueFrames[],
): SubtitleCueFrames[] {
  return [...cues]
    .filter(
      (cue) =>
        cue.text.trim().length > 0 &&
        Number.isFinite(cue.startFrame) &&
        Number.isFinite(cue.endFrame) &&
        cue.endFrame > cue.startFrame,
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}

function framesPerSecond(fps: number): number {
  return fps > 0 && Number.isFinite(fps) ? fps : 30;
}

/** VTT desde frames, con la cabecera obligatoria y separador decimal en punto. */
export function serializeVtt(
  cues: readonly SubtitleCueFrames[],
  fps: number,
): string {
  const rate = framesPerSecond(fps);
  const ordered = orderedFrames(cues);
  const body = ordered
    .map((cue, index) => {
      const start = vttClock(cue.startFrame / rate);
      const end = vttClock(cue.endFrame / rate);
      return `${index + 1}\n${start} --> ${end}\n${cue.text.trim()}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

function vttClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secs,
  ).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * ASS (v4.00+) desde frames. Las horas van sin rellenar y la precisión es de
 * centisegundos: es el formato que esperan libass, Premiere y Resolve.
 */
export function serializeAss(
  cues: readonly SubtitleCueFrames[],
  fps: number,
  options?: SubtitleExportOptions,
): string {
  const rate = framesPerSecond(fps);
  const ordered = orderedFrames(cues);
  const playResX = Math.max(1, Math.round(options?.playResX ?? 1920));
  const playResY = Math.max(1, Math.round(options?.playResY ?? 1080));
  const header = [
    '[Script Info]',
    '; Generado por Olyvia',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,30,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const dialogues = ordered.map(
    (cue) =>
      `Dialogue: 0,${assClock(cue.startFrame / rate)},${assClock(
        cue.endFrame / rate,
      )},Default,,0,0,0,,${assText(cue.text)}`,
  );
  return [...header, ...dialogues].join('\n').concat('\n');
}

/** Las horas van sin rellenar (`0:00:01.50`) y la precisión es centisegundos. */
function assClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 100);
  const cents = clamped % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(
    2,
    '0',
  )}.${String(cents).padStart(2, '0')}`;
}

/** Quita etiquetas de override `{...}` y usa `\N` para los saltos de línea. */
function assText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

/**
 * Acción de export: toma los cues actuales del proyecto (ya filtrados por la
 * pista de subtítulos, sin títulos) y produce el archivo para el formato.
 */
export function exportSubtitleCues(
  cues: readonly SubtitleCueFrames[],
  fps: number,
  format: SubtitleExportFormat,
  options?: SubtitleExportOptions,
): SubtitleExportFile {
  switch (format) {
    case 'srt':
      return {
        format,
        extension: 'srt',
        mimeType: 'application/x-subrip;charset=utf-8',
        content: serializeSrt(cues, fps),
      };
    case 'vtt':
      return {
        format,
        extension: 'vtt',
        mimeType: 'text/vtt;charset=utf-8',
        content: serializeVtt(cues, fps),
      };
    case 'ass':
      return {
        format,
        extension: 'ass',
        mimeType: 'text/x-ssa;charset=utf-8',
        content: serializeAss(cues, fps, options),
      };
  }
}
