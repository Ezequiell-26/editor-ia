import type { ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import type { DenoiseLevel } from './auto-cleanup';

/**
 * Perfil adaptativo.
 *
 * La automatización de nivel 4 pedía parámetros: umbral de silencio, nivel de
 * reducción de ruido, intensidad de zoom. Pedirlos es seguir dependiendo de una
 * persona. Este módulo los **mide** en el material y devuelve un perfil listo
 * para la limpieza, con la razón de cada valor para que se pueda auditar.
 *
 * Nada de esto inventa señal: sale de los picos que FFmpeg ya mide (10 % y 90 %
 * percentil), de la duración de los planos y del formato del proyecto.
 */

export interface AdaptiveProfile {
  /** Piso de ruido medido, en dBFS. */
  readonly noiseFloorDb: number;
  /** Nivel de voz/música medido (percentil 90), en dBFS. */
  readonly speechDb: number;
  /** Relación señal-ruido, en dB. */
  readonly snrDb: number;
  /** Umbral de silencio sugerido, en dBFS. */
  readonly silenceThresholdDb: number;
  readonly denoise: DenoiseLevel;
  /** Intensidad de zoom sugerida, 0,02–0,3. */
  readonly zoomIntensity: number;
  /** LUFS objetivo según el formato. */
  readonly targetLufs: number;
  /** Explicación corta para la UI y el reporte. */
  readonly reason: string;
}

const FLOOR_DEFAULT_DB = -60;
const SPEECH_DEFAULT_DB = -18;

function bucketDb(amplitude: number): number {
  if (!(amplitude > 0)) return -120;
  return 20 * Math.log10(amplitude);
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))));
  return sorted[index]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Duración mediana de los planos con imagen, en segundos. */
function medianShotSeconds(project: ProjectDocument): number {
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const durations = project.timeline.clips
    .filter((clip) => clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze')
    .map((clip) => clip.durationFrames / Math.max(1, fps))
    .filter((seconds) => seconds > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 3;
  return durations[Math.floor(durations.length / 2)]!;
}

/**
 * Perfil por defecto cuando no hay picos medibles (clip sin audio o material
 * que FFmpeg no pudo analizar). Es explícito para no fingir una medición.
 */
export function defaultAdaptiveProfile(): AdaptiveProfile {
  return {
    noiseFloorDb: FLOOR_DEFAULT_DB,
    speechDb: SPEECH_DEFAULT_DB,
    snrDb: SPEECH_DEFAULT_DB - FLOOR_DEFAULT_DB,
    silenceThresholdDb: -45,
    denoise: 'medium',
    zoomIntensity: 0.08,
    targetLufs: -14,
    reason: 'sin picos medibles: se usan valores conservadores',
  };
}

export function measureAdaptiveProfile(
  project: ProjectDocument,
  peaks?: AudioPeaks | null,
): AdaptiveProfile {
  const vertical = project.video.height > project.video.width;
  const targetLufs = vertical ? -14 : -14;
  if (!peaks || peaks.peaks.length === 0) {
    return { ...defaultAdaptiveProfile(), targetLufs };
  }

  const levels = peaks.peaks
    .map((bucket) => bucketDb(Math.max(Math.abs(bucket.min), Math.abs(bucket.max))))
    .filter((db) => Number.isFinite(db));
  if (levels.length === 0) return { ...defaultAdaptiveProfile(), targetLufs };

  const noiseFloorDb = round1(clamp(percentile(levels, 0.1), -90, -20));
  const speechDb = round1(clamp(percentile(levels, 0.9), -60, 0));
  const snrDb = round1(Math.max(0, speechDb - noiseFloorDb));

  // El umbral se apoya en el piso medido, no en un número fijo: 6 dB por encima
  // del ruido de fondo separa respiración de silencio sin comerse palabras.
  const silenceThresholdDb = round1(clamp(noiseFloorDb + 6, -60, -22));

  // Cuanto peor la relación señal-ruido, más agresiva la reducción.
  const denoise: DenoiseLevel = snrDb >= 30 ? 'light' : snrDb >= 18 ? 'medium' : 'strong';

  // Planos cortos toleran menos zoom: un punch-in fuerte en 1 s marea.
  const shot = medianShotSeconds(project);
  const zoomIntensity =
    Math.round(clamp(shot < 2 ? 0.05 : shot <= 5 ? 0.08 : 0.12, 0.02, 0.3) * 100) / 100;

  return {
    noiseFloorDb,
    speechDb,
    snrDb,
    silenceThresholdDb,
    denoise,
    zoomIntensity,
    targetLufs,
    reason: `piso ${noiseFloorDb} dB · voz ${speechDb} dB · SNR ${snrDb} dB · plano mediano ${shot.toFixed(1)} s`,
  };
}

/** Texto corto para el aviso de la UI. */
export function adaptiveSummary(profile: AdaptiveProfile): string {
  return `umbral ${profile.silenceThresholdDb} dB · denoise ${profile.denoise} · zoom ${(profile.zoomIntensity * 100).toFixed(0)} % · ${profile.targetLufs} LUFS`;
}
