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

/** Paneo de pista acotado a -1..1; 0 es centro. */
export function trackPan(track: Track): number {
  return Math.max(-1, Math.min(1, track.pan ?? 0));
}

/** Ganancias de balance lineal: el centro deja ambos canales a 1.0. */
export function panGains(pan: number): { readonly left: number; readonly right: number } {
  const value = Math.max(-1, Math.min(1, pan));
  return {
    left: value <= 0 ? 1 : 1 - value,
    right: value >= 0 ? 1 : 1 + value,
  };
}

/** Etiqueta corta del paneo para la mesa: C, L 40 o R 25. */
export function panLabel(pan: number): string {
  const value = Math.max(-1, Math.min(1, pan));
  if (Math.abs(value) < 0.01) return 'C';
  return `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`;
}

export type TrackEqBand = 'eqLowDb' | 'eqMidDb' | 'eqHighDb';

/** EQ de pista acotado a ±12 dB. */
export function trackEqDb(track: Track, band: TrackEqBand): number {
  return Math.max(-12, Math.min(12, track[band] ?? 0));
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
