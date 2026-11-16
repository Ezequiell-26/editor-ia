import type { Clip, ProjectDocument } from '@editor-ia/project-schema';

function trackOrder(project: ProjectDocument, trackId: string): number {
  return project.timeline.tracks.find((track) => track.id === trackId)?.order ?? 0;
}

/**
 * Orden de composición del monitor: el mismo `(orden de pista, startFrame)`
 * que aplica `visual_clips.sort_by_key` en `render/ffmpeg.rs` (y
 * `adjustment_clips` para las capas de ajuste). A igual orden de pista el
 * clip que empieza después queda encima — durante el solape de una
 * transición el entrante debe tapar al saliente aunque el array del
 * proyecto los liste al revés. El sort es estable, igual que el de Rust:
 * los empates exactos conservan el orden del array.
 */
export function comparePreviewClips(
  a: Clip,
  b: Clip,
  project: ProjectDocument,
): number {
  return (
    trackOrder(project, a.trackId) - trackOrder(project, b.trackId) ||
    a.startFrame - b.startFrame
  );
}
