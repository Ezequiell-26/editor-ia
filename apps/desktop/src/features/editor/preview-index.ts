import type { Asset, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { isTrackAudible } from '../../state/audio-mix';
import { fpsOf } from '../../state/project-actions';
import { comparePreviewClips } from './preview-clip-order';
import { previewTransitionLeadFrames } from './preview-transition';

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
  /** Primer frame del playhead en que la capa es visible/activa. Las capas
   *  visuales la corren `lead` frames antes de `startFrame` cuando el clip
   *  tiene `transitionIn` (el solape del render). */
  readonly start: number;
  /** Primer frame del playhead en que la capa deja de estar activa. */
  readonly end: number;
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

/** Misma comparación de rango que usaba el `useMemo` anterior del Preview,
 *  más la ventana de lead de `transitionIn` para las capas visuales. */
export function clipActiveAt(clip: Clip, frame: number): boolean {
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames;
}

export function activeAt(
  entries: readonly PreviewClipEntry[],
  frame: number,
): PreviewClipEntry[] {
  return entries.filter((entry) => frame >= entry.start && frame < entry.end);
}

export function buildPreviewClipIndex(project: ProjectDocument): PreviewClipIndex {
  const fps = fpsOf(project);
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
    const end = clip.startFrame + clip.durationFrames;
    const base = { clip, track, asset };

    if (
      track &&
      !track.hidden &&
      VISUAL_TRACK_KINDS.has(track.kind) &&
      clip.enabled !== false
    ) {
      // Con `transitionIn` el render monta el clip `lead` frames antes de su
      // inicio (solape): la ventana de actividad empieza antes, igual que
      // `previewTransitionLeadFrames` del monitor.
      const lead = previewTransitionLeadFrames(clip, fps);
      visual.push({ ...base, start: clip.startFrame - lead, end });
    }
    if (
      track &&
      isTrackAudible(track, tracks) &&
      AUDIO_TRACK_KINDS.has(track.kind) &&
      clip.enabled !== false
    ) {
      audio.push({ ...base, start: clip.startFrame, end });
    }
    if (
      clip.kind === 'adjustment' &&
      clip.enabled !== false &&
      track &&
      !track.hidden
    ) {
      adjustment.push({ ...base, start: clip.startFrame, end });
    }
  }

  // Orden de composición del render (`visual_clips`/`adjustment_clips` de
  // ffmpeg.rs): `(orden de pista, startFrame)` — durante el solape de una
  // transición el entrante tapa al saliente. El sort es estable.
  const byComposition = (a: PreviewClipEntry, b: PreviewClipEntry): number =>
    comparePreviewClips(a.clip, b.clip, project);
  visual.sort(byComposition);
  adjustment.sort(byComposition);

  return { visual, audio, adjustment };
}
