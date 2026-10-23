import type { Marker, MarkerColor, ProjectDocument } from '@editor-ia/project-schema';
import { MAX_MARKERS } from '@editor-ia/project-schema';
import { ProjectActionError, cloneProject, newId } from './project-actions';

function touch(project: ProjectDocument): void {
  project.revision += 1;
  project.updatedAt = new Date().toISOString();
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function assertLabel(label: string): void {
  if (!label) {
    throw new ProjectActionError('el marcador necesita un nombre');
  }
  if (label.length > 120) {
    throw new ProjectActionError('el nombre del marcador admite hasta 120 caracteres');
  }
}

export function addMarker(
  project: ProjectDocument,
  atFrame: number,
  options: { label?: string; color?: MarkerColor; endFrame?: number } = {},
): { project: ProjectDocument; markerId: string; frame: number } {
  const frame = Math.max(0, Math.round(atFrame));
  const endFrame =
    options.endFrame !== undefined ? Math.max(0, Math.round(options.endFrame)) : undefined;
  if (endFrame !== undefined && endFrame <= frame) {
    throw new ProjectActionError('el fin del rango debe quedar después del inicio');
  }
  if (project.markers.some((marker) => marker.frame === frame)) {
    throw new ProjectActionError('ya hay un marcador en ese frame');
  }
  if (project.markers.length >= MAX_MARKERS) {
    throw new ProjectActionError(`un proyecto admite hasta ${MAX_MARKERS} marcadores`);
  }
  const label = cleanLabel(options.label ?? `Marcador ${project.markers.length + 1}`);
  assertLabel(label);
  const next = cloneProject(project);
  const markerId = newId();
  next.markers.push({
    id: markerId,
    frame,
    ...(endFrame !== undefined ? { endFrame } : {}),
    label,
    ...(options.color ? { color: options.color } : {}),
  });
  touch(next);
  return { project: next, markerId, frame };
}

export function updateMarker(
  project: ProjectDocument,
  markerId: string,
  patch: {
    frame?: number;
    endFrame?: number | undefined;
    label?: string;
    color?: MarkerColor | undefined;
  },
): ProjectDocument {
  const next = cloneProject(project);
  const marker = next.markers.find((item) => item.id === markerId);
  if (!marker) {
    throw new ProjectActionError('el marcador no está en el proyecto');
  }
  if (patch.frame !== undefined) {
    const frame = Math.max(0, Math.round(patch.frame));
    if (next.markers.some((item) => item.id !== markerId && item.frame === frame)) {
      throw new ProjectActionError('ya hay un marcador en ese frame');
    }
    if (marker.endFrame !== undefined && marker.endFrame <= frame) {
      throw new ProjectActionError('el fin del rango debe quedar después del inicio');
    }
    marker.frame = frame;
  }
  if ('endFrame' in patch) {
    if (patch.endFrame === undefined) {
      delete marker.endFrame;
    } else {
      const end = Math.max(0, Math.round(patch.endFrame));
      if (end <= marker.frame) {
        throw new ProjectActionError('el fin del rango debe quedar después del inicio');
      }
      marker.endFrame = end;
    }
  }
  if (patch.label !== undefined) {
    const label = cleanLabel(patch.label);
    assertLabel(label);
    marker.label = label;
  }
  if ('color' in patch) {
    if (patch.color) marker.color = patch.color;
    else delete marker.color;
  }
  touch(next);
  return next;
}

export function deleteMarker(project: ProjectDocument, markerId: string): ProjectDocument {
  if (!project.markers.some((marker) => marker.id === markerId)) {
    return project;
  }
  const next = cloneProject(project);
  next.markers = next.markers.filter((marker) => marker.id !== markerId);
  touch(next);
  return next;
}

export function clearMarkers(project: ProjectDocument): ProjectDocument {
  if (project.markers.length === 0) return project;
  const next = cloneProject(project);
  next.markers = [];
  touch(next);
  return next;
}

/**
 * Turns production scenes into chapter markers at their earliest clip. Scenes
 * without clips and frames that already have a marker are skipped.
 */
export function markersFromScenes(
  project: ProjectDocument,
): { project: ProjectDocument; added: number; skipped: number } {
  let next = project;
  let added = 0;
  let skipped = 0;
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order);
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    const starts = scene.clipIds
      .map((clipId) =>
        project.timeline.clips.find((clip) => clip.id === clipId)?.startFrame,
      )
      .filter((frame): frame is number => frame !== undefined);
    if (starts.length === 0) {
      skipped += 1;
      continue;
    }
    const frame = Math.min(...starts);
    if (next.markers.some((marker) => marker.frame === frame)) {
      skipped += 1;
      continue;
    }
    const label = (scene.title.trim() || `Escena ${index + 1}`).slice(0, 120);
    next = addMarker(next, frame, { label }).project;
    added += 1;
  }
  return { project: added > 0 ? next : project, added, skipped };
}

export function markerAtFrame(
  project: ProjectDocument,
  frame: number,
): Marker | undefined {
  return project.markers.find((marker) => marker.frame === frame);
}

export interface MarkerChapter {
  readonly startSeconds: number;
  readonly title: string;
}

/**
 * Chapters derived from markers. Timestamps are rounded to whole seconds and
 * deduplicated, because a chapter list with repeated timestamps is invalid on
 * YouTube. If the first marker is later than 0:00 a neutral `Inicio` chapter is
 * prepended so the exported list is publishable as-is.
 */
export function chaptersFromMarkers(
  markers: readonly Marker[],
  fps: number,
): MarkerChapter[] {
  const safeFps = Math.max(1, fps);
  const sorted = [...markers].sort((a, b) => a.frame - b.frame);
  const seen = new Set<number>();
  const chapters: MarkerChapter[] = [];
  for (const marker of sorted) {
    const startSeconds = Math.max(0, Math.round(marker.frame / safeFps));
    if (seen.has(startSeconds)) continue;
    seen.add(startSeconds);
    chapters.push({
      startSeconds,
      title: cleanLabel(marker.label) || 'Capítulo',
    });
  }
  if (chapters.length > 0 && (chapters[0]?.startSeconds ?? 0) > 0) {
    chapters.unshift({ startSeconds: 0, title: 'Inicio' });
  }
  return chapters;
}

export interface ChapterValidation {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

/**
 * Checks the chapter format YouTube documents: at least three chapters, the
 * first one at 0:00 and each chapter at least 10 seconds long. It validates
 * the text list, not the platform's moderation or monetization rules.
 */
export function validateChapters(
  chapters: readonly MarkerChapter[],
): ChapterValidation {
  const issues: string[] = [];
  if (chapters.length < 3) {
    issues.push('YouTube necesita al menos tres capítulos.');
  }
  if (chapters.length > 0 && (chapters[0]?.startSeconds ?? 0) !== 0) {
    issues.push('El primer capítulo debe empezar en 0:00.');
  }
  for (let index = 0; index < chapters.length - 1; index += 1) {
    const current = chapters[index];
    const next = chapters[index + 1];
    if (!current || !next) continue;
    const gap = next.startSeconds - current.startSeconds;
    if (gap < 10) {
      issues.push(
        `“${current.title}” debe durar al menos 10 s antes del siguiente capítulo.`,
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatMarkerChapters(
  markers: readonly Marker[],
  fps: number,
): string {
  return chaptersFromMarkers(markers, fps)
    .map((chapter) => `${formatChapterTime(chapter.startSeconds)} ${chapter.title}`)
    .join('\n');
}
