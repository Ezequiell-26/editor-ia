import type { ProjectDocument } from '@editor-ia/project-schema';

/**
 * Puntos de edición (paridad "go to next/previous edit" de Premiere/Resolve):
 * todos los bordes de clip de la timeline — inicio y fin— deduplicados y
 * ordenados. No incluye marcadores ni keyframes: son los cortes del montaje.
 */
export function editPointFrames(project: ProjectDocument): number[] {
  const frames = new Set<number>();
  for (const clip of project.timeline.clips) {
    frames.add(clip.startFrame);
    frames.add(clip.startFrame + clip.durationFrames);
  }
  return [...frames].sort((a, b) => a - b);
}

/** Primer punto de edición estrictamente posterior al frame, o null. */
export function nextEditPoint(project: ProjectDocument, frame: number): number | null {
  for (const point of editPointFrames(project)) {
    if (point > frame) return point;
  }
  return null;
}

/** Último punto de edición estrictamente anterior al frame, o null. */
export function previousEditPoint(project: ProjectDocument, frame: number): number | null {
  const points = editPointFrames(project);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point < frame) return point;
  }
  return null;
}
