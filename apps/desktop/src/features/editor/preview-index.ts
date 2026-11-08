import type { Asset, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { isTrackAudible } from '../../state/audio-mix';

/**
 * Índice de clips del monitor de Preview, construido una vez por proyecto.
 *
 * Durante la reproducción el playhead cambia ~30-60 veces por segundo pero el
 * documento es inmutable: las pistas, los assets y la pertenencia de cada clip
 * a la selección visual/de audio no cambian entre frames. Antes cada tick
 * repetía `trackById`/`assetById` (dos `Array.find` por clip, y otros dos por
 * comparación del sort) sobre todos los clips del proyecto. Acá ese trabajo
 * se hace una sola vez por proyecto y cada frame sólo filtra por rango de
 * frames — comparaciones numéricas sobre listas ya clasificadas y ordenadas.
 */

export interface PreviewClipEntry {
  readonly clip: Clip;
  readonly track: Track | undefined;
  readonly asset: Asset | undefined;
}

export interface PreviewClipIndex {
  /** Pasa el filtro visual de Preview, ordenado por `track.order` (estable). */
  readonly visual: readonly PreviewClipEntry[];
  /** Pasa el filtro de audio de Preview, en el orden de `timeline.clips`. */
  readonly audio: readonly PreviewClipEntry[];
  /** Clips `adjustment` elegibles, ordenados por `track.order` (estable). */
  readonly adjustment: readonly PreviewClipEntry[];
}

const VISUAL_TRACK_KINDS: ReadonlySet<Track['kind']> = new Set(['video', 'image', 'graphic']);
const AUDIO_TRACK_KINDS: ReadonlySet<Track['kind']> = new Set(['audio', 'narration']);

/** Misma comparación de rango que usaba el `useMemo` anterior del Preview. */
export function clipActiveAt(clip: Clip, frame: number): boolean {
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames;
}

export function activeAt(
  entries: readonly PreviewClipEntry[],
  frame: number,
): PreviewClipEntry[] {
  return entries.filter((entry) => clipActiveAt(entry.clip, frame));
}

function byTrackOrder(a: PreviewClipEntry, b: PreviewClipEntry): number {
  return (a.track?.order ?? 0) - (b.track?.order ?? 0);
}

export function buildPreviewClipIndex(project: ProjectDocument): PreviewClipIndex {
  const tracksById = new Map(project.timeline.tracks.map((track) => [track.id, track]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const tracks = project.timeline.tracks;

  const visual: PreviewClipEntry[] = [];
  const audio: PreviewClipEntry[] = [];
  const adjustment: PreviewClipEntry[] = [];

  for (const clip of project.timeline.clips) {
    const track = tracksById.get(clip.trackId);
    const asset =
      clip.source.type === 'asset' ? assetsById.get(clip.source.assetId) : undefined;
    const entry: PreviewClipEntry = { clip, track, asset };

    if (
      track &&
      !track.hidden &&
      VISUAL_TRACK_KINDS.has(track.kind) &&
      clip.enabled !== false
    ) {
      visual.push(entry);
    }
    if (
      track &&
      isTrackAudible(track, tracks) &&
      AUDIO_TRACK_KINDS.has(track.kind) &&
      clip.enabled !== false
    ) {
      audio.push(entry);
    }
    if (
      clip.kind === 'adjustment' &&
      clip.enabled !== false &&
      track &&
      !track.hidden
    ) {
      adjustment.push(entry);
    }
  }

  // `Array.prototype.sort` es estable: los empates de `order` conservan el
  // orden de `timeline.clips`, igual que el sort por frame que reemplaza.
  visual.sort(byTrackOrder);
  adjustment.sort(byTrackOrder);

  return { visual, audio, adjustment };
}
