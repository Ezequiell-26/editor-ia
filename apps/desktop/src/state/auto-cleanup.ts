import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import {
  closeGaps,
  fpsOf,
  updateAudioMix,
  updateClip,
} from './project-actions';
import { runSilenceCuts, type SilenceCutOptions } from './silence-cuts';
import {
  applySpeechCuts,
  cuesForClip,
  planSpeechCutsFromCues,
  type SpeechCutOptions,
} from './speech-cuts';

/**
 * Limpieza automática del proyecto.
 *
 * Reúne en un solo paso lo que antes vivía en cinco pantallas distintas:
 * cerrar huecos entre clips, cortar silencios, cortar pausas entre frases,
 * reducir ruido en tres niveles, nivelar el volumen y dar zoom en los cortes.
 * No reimplementa nada: llama a los motores que ya existen y devuelve un
 * reporte medido para que la UI diga qué hizo.
 *
 * Reglas:
 * - Todo corre sobre el proyecto que se le pasa; el llamador decide si lo
 *   aplica con historial (la UI lo hace en un único `update`).
 * - Las pistas bloqueadas se respetan: ningún paso toca un clip bloqueado.
 * - El zoom no pisa un movimiento que el usuario ya haya puesto.
 * - El cierre de huecos viene apagado por defecto: en proyectos con audio
 *   separado puede desincronizar, así que es una decisión explícita.
 */

export type DenoiseLevel = 'off' | 'light' | 'medium' | 'strong';

export const DENOISE_LEVELS: Readonly<Record<DenoiseLevel, number>> = {
  off: 0,
  light: 0.15,
  medium: 0.35,
  strong: 0.6,
};

export interface AutoCleanupOptions {
  readonly closeGaps?: boolean | undefined;
  readonly cutSilences?: boolean | undefined;
  readonly silence?: SilenceCutOptions | undefined;
  readonly cutPauses?: boolean | undefined;
  readonly pause?: SpeechCutOptions | undefined;
  readonly denoise?: DenoiseLevel | undefined;
  readonly levelAudio?: boolean | undefined;
  /** LUFS objetivo; -14 es el estándar de YouTube/Shorts. */
  readonly targetLufs?: number | undefined;
  readonly zoomCuts?: boolean | undefined;
  /** Intensidad del zoom, 0,02–0,3. */
  readonly zoomIntensity?: number | undefined;
}

export interface AutoCleanupReport {
  readonly project: ProjectDocument;
  readonly gapsClosed: number;
  readonly silenceCuts: number;
  readonly pauseCuts: number;
  readonly denoised: number;
  readonly zoomed: number;
  readonly leveled: boolean;
  readonly removedSeconds: number;
}

const DEFAULTS = {
  closeGaps: false,
  cutSilences: true,
  cutPauses: true,
  denoise: 'medium' as DenoiseLevel,
  levelAudio: true,
  targetLufs: -14,
  zoomCuts: true,
  zoomIntensity: 0.08,
} as const;

function isUnlocked(project: ProjectDocument, clip: Clip): boolean {
  return project.timeline.tracks.find((track) => track.id === clip.trackId)?.locked !== true;
}

function hasAudio(clip: Clip): boolean {
  return clip.kind === 'video' || clip.kind === 'audio';
}

function hasPicture(clip: Clip): boolean {
  return clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function runAutoCleanup(
  project: ProjectDocument,
  fetchPeaks: (assetId: string) => Promise<AudioPeaks>,
  options: AutoCleanupOptions = {},
): Promise<AutoCleanupReport> {
  const cutSilences = options.cutSilences ?? DEFAULTS.cutSilences;
  const cutPauses = options.cutPauses ?? DEFAULTS.cutPauses;
  const closeGap = options.closeGaps ?? DEFAULTS.closeGaps;
  const denoiseLevel = options.denoise ?? DEFAULTS.denoise;
  const levelAudio = options.levelAudio ?? DEFAULTS.levelAudio;
  const zoomCuts = options.zoomCuts ?? DEFAULTS.zoomCuts;
  const targetLufs = clamp(options.targetLufs ?? DEFAULTS.targetLufs, -33, -9);
  const zoomIntensity = clamp(options.zoomIntensity ?? DEFAULTS.zoomIntensity, 0.02, 0.3);

  let next = project;
  let gapsClosed = 0;
  let silenceCuts = 0;
  let pauseCuts = 0;
  let denoised = 0;
  let zoomed = 0;
  let leveled = false;
  let removedSeconds = 0;

  // 1. Huecos entre clips: sólo pistas de video desbloqueadas y sólo si se pide.
  if (closeGap) {
    for (const track of next.timeline.tracks) {
      if (track.locked || track.kind !== 'video') continue;
      try {
        const result = closeGaps(next, track.id);
        gapsClosed += result.moved;
        next = result.project;
      } catch {
        // Una pista sin clips o bloqueada no debe abortar la limpieza.
      }
    }
  }

  // 2. Silencios por amplitud.
  if (cutSilences) {
    const result = await runSilenceCuts(next, fetchPeaks, options.silence);
    silenceCuts = result.cuts;
    removedSeconds += result.removedSeconds;
    next = result.project;
  }

  // 3. Pausas entre frases, con los subtítulos que ya existan (no transcribe).
  if (cutPauses) {
    const candidates = next.timeline.clips
      .filter((clip) => hasAudio(clip) && clip.source.type === 'asset' && isUnlocked(next, clip))
      .sort((a, b) => a.startFrame - b.startFrame);
    for (const clip of candidates) {
      const live = next.timeline.clips.find((item) => item.id === clip.id);
      if (!live) continue;
      const plan = planSpeechCutsFromCues(
        cuesForClip(next, live.id),
        live,
        fpsOf(next),
        options.pause,
      );
      if (!plan || plan.excessive) continue;
      const after = applySpeechCuts(next, live.id, plan);
      if (after === next) continue;
      pauseCuts += plan.pauses;
      removedSeconds += plan.removedSeconds;
      next = after;
    }
  }

  // 4. Reducción de ruido por nivel.
  const denoise = DENOISE_LEVELS[denoiseLevel] ?? 0;
  if (denoise > 0) {
    for (const clip of [...next.timeline.clips]) {
      if (!hasAudio(clip) || !isUnlocked(next, clip)) continue;
      const audio = 'audio' in clip ? clip.audio : undefined;
      next = updateClip(next, clip.id, {
        audio: { ...(audio ?? {}), denoise },
      });
      denoised += 1;
    }
  }

  // 5. Nivelado: objetivo de loudness + limitador de entrega.
  if (levelAudio) {
    next = updateAudioMix(next, {
      loudnessTarget: {
        platform: next.video.height > next.video.width ? 'shorts' : 'youtube',
        integratedLufs: targetLufs,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
    leveled = true;
  }

  // 6. Zoom en los cortes: alterna entrada y salida, sin pisar motion previo.
  if (zoomCuts) {
    const picture = next.timeline.clips
      .filter(
        (clip) =>
          hasPicture(clip) &&
          clip.durationFrames >= 24 &&
          !('motion' in clip && clip.motion) &&
          isUnlocked(next, clip),
      )
      .sort((a, b) => a.startFrame - b.startFrame);
    picture.forEach((clip, index) => {
      next = updateClip(next, clip.id, {
        motion: {
          type: index % 2 === 0 ? 'zoom-in' : 'zoom-out',
          intensity: zoomIntensity,
        },
      });
      zoomed += 1;
    });
  }

  return {
    project: next,
    gapsClosed,
    silenceCuts,
    pauseCuts,
    denoised,
    zoomed,
    leveled,
    removedSeconds,
  };
}

/** Resumen corto para el aviso de la UI y la respuesta del asistente. */
export function autoCleanupSummary(report: AutoCleanupReport): string {
  const parts: string[] = [];
  if (report.gapsClosed > 0) parts.push(`${report.gapsClosed} hueco(s) cerrados`);
  if (report.silenceCuts > 0) parts.push(`${report.silenceCuts} silencio(s)`);
  if (report.pauseCuts > 0) parts.push(`${report.pauseCuts} pausa(s)`);
  if (report.denoised > 0) parts.push(`${report.denoised} clip(s) sin ruido`);
  if (report.zoomed > 0) parts.push(`${report.zoomed} zoom(s)`);
  if (report.leveled) parts.push('volumen nivelado');
  if (parts.length === 0) return 'No había nada que limpiar.';
  const seconds = report.removedSeconds > 0 ? ` · ${report.removedSeconds.toFixed(2)} s menos` : '';
  return `${parts.join(' · ')}${seconds}.`;
}
