import type { Track } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';

const AUDIO_KINDS: ReadonlySet<Track['kind']> = new Set(['video', 'audio', 'narration']);

/** Un solo activo sólo cuenta si la pista puede llevar audio y no está muteada. */
export function hasSoloedAudioTrack(tracks: readonly Track[]): boolean {
  return tracks.some(
    (track) => AUDIO_KINDS.has(track.kind) && track.solo === true && !track.muted,
  );
}

/**
 * El mute siempre gana. Si hay alguna pista en solo, las demás pistas con
 * audio quedan fuera de la mezcla hasta apagar ese solo.
 */
export function isTrackAudible(track: Track, tracks: readonly Track[]): boolean {
  if (track.muted) return false;
  if (!AUDIO_KINDS.has(track.kind)) return false;
  if (!hasSoloedAudioTrack(tracks)) return true;
  return track.solo === true;
}

/** Ganancia de pista acotada al mismo rango que valida el esquema. */
export function trackGainDb(track: Track): number {
  return Math.max(-60, Math.min(12, track.gainDb ?? 0));
}

/** Pico absoluto de una onda medida por FFmpeg, en dBFS. `null` si es silencio. */
export function peakDbFromPeaks(peaks: AudioPeaks): number | null {
  let max = 0;
  for (const pair of peaks.peaks) {
    max = Math.max(max, Math.abs(pair.min), Math.abs(pair.max));
  }
  return max > 0 ? 20 * Math.log10(max) : null;
}

/** Pico resultante después de aplicar la ganancia de la pista. */
export function effectivePeakDb(sourcePeakDb: number, gainDb: number): number {
  return sourcePeakDb + gainDb;
}

/** Ganancia necesaria para que el pico quede en el objetivo, dentro de -60..12. */
export function gainForTargetPeak(sourcePeakDb: number, targetDb: number): number {
  return Math.max(-60, Math.min(12, targetDb - sourcePeakDb));
}

/** Posición 0..100 del medidor para un nivel en dBFS (piso -60, techo 0). */
export function levelPercentFromDb(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
