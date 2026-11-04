import type { Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  cloneProject,
  touch,
  trimClip,
} from '../../state/project-actions';

/**
 * Edición ripple real del timeline.
 *
 * Regla única: cuando un borde de edición cambia, los clips posteriores de la
 * misma pista se desplazan el mismo delta para que no quede hueco. Se aplica a
 * trim, move (insertando en el destino y cerrando el hueco de origen) y delete
 * (reusa `rippleDeleteClip` de project-actions).
 *
 * Todas las funciones son puras sobre el documento: devuelven un proyecto
 * clonado o `null` si la edición no es válida. No tocan el store.
 */

function clipsOfTrack(project: ProjectDocument, trackId: string, exceptId?: string): Clip[] {
  return project.timeline.clips
    .filter((clip) => clip.trackId === trackId && clip.id !== exceptId)
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Valida que la pista no tenga solapamientos (asume documento clonado). */
function trackIsValid(project: ProjectDocument, trackId: string): boolean {
  const clips = clipsOfTrack(project, trackId);
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]!;
    if (clip.durationFrames < 1 || clip.startFrame < 0) return false;
    const previous = clips[index - 1];
    if (previous && overlaps(previous.startFrame, previous.startFrame + previous.durationFrames, clip.startFrame, clip.startFrame + clip.durationFrames)) {
      return false;
    }
  }
  return true;
}

/**
 * Ripple trim: recorta el clip y arrastra los clips posteriores de la pista.
 *
 * - `end`: el borde derecho cambia; los clips que empiezan después del final
 *   anterior se mueven el delta del nuevo largo.
 * - `start`: además del recorte, el clip y los posteriores se mueven el delta
 *   del largo para que el corte quede contiguo (no queda aire antes).
 */
export function rippleTrim(
  project: ProjectDocument,
  clipId: string,
  edge: 'start' | 'end',
  targetFrame: number,
): ProjectDocument | null {
  const original = project.timeline.clips.find((clip) => clip.id === clipId);
  if (!original) return null;
  const track = project.timeline.tracks.find((item) => item.id === original.trackId);
  if (track?.locked) return null;
  const trimmed = trimClip(project, clipId, edge, targetFrame);
  if (!trimmed) return null;
  const clip = trimmed.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  const delta = clip.durationFrames - original.durationFrames;
  if (delta === 0) return trimmed;

  const oldEnd = original.startFrame + original.durationFrames;
  const next = cloneProject(trimmed);
  const nextClip = next.timeline.clips.find((item) => item.id === clipId);
  if (!nextClip) return null;
  if (edge === 'start') {
    // El recorte de inicio deja el final fijo: para cerrar el aire anterior se
    // mueve el clip y todo lo que venía después por el delta del largo.
    nextClip.startFrame = Math.max(0, original.startFrame + delta);
  }
  for (const item of next.timeline.clips) {
    if (item.id === clipId || item.trackId !== original.trackId) continue;
    if (item.startFrame < oldEnd) continue;
    const shifted = item.startFrame + delta;
    if (shifted < 0) return null;
    item.startFrame = shifted;
  }
  if (nextClip.startFrame < 0) return null;
  if (!trackIsValid(next, original.trackId)) return null;
  touch(next);
  return next;
}

function compatibleTrackKinds(kind: Clip['kind']): readonly Track['kind'][] {
  switch (kind) {
    case 'video':
    case 'freeze':
      return ['video'];
    case 'image':
      return ['image'];
    case 'audio':
      return ['audio', 'narration'];
    case 'graphic':
      return ['graphic'];
    case 'adjustment':
      return ['adjustment'];
    default:
      return [];
  }
}

/**
 * Ripple move: saca el clip de su lugar cerrando el hueco, e inserta en el
 * destino empujando lo que ya estaba a la derecha. Es el "insert edit" que
 * hace que mover un clip no genere solapamientos ni huecos.
 */
export function rippleMoveClip(
  project: ProjectDocument,
  clipId: string,
  targetStart: number,
  targetTrackId?: string,
): ProjectDocument | null {
  const original = project.timeline.clips.find((clip) => clip.id === clipId);
  if (!original) return null;
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  const sourceTrack = next.timeline.tracks.find((item) => item.id === clip.trackId);
  const targetTrack = next.timeline.tracks.find(
    (item) => item.id === (targetTrackId ?? clip.trackId),
  );
  if (!sourceTrack || !targetTrack) return null;
  if (sourceTrack.locked || targetTrack.locked) return null;
  if (!compatibleTrackKinds(clip.kind).includes(targetTrack.kind)) return null;

  const duration = clip.durationFrames;
  const oldStart = clip.startFrame;
  const oldEnd = oldStart + duration;
  const start = Math.max(0, Math.round(targetStart));

  // 1) sacar el clip del array y cerrar el hueco que dejó en su pista.
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clipId);
  for (const item of next.timeline.clips) {
    if (item.trackId !== clip.trackId) continue;
    if (item.startFrame < oldEnd) continue;
    item.startFrame = Math.max(0, item.startFrame - duration);
  }

  // 2) insertar en el destino: lo que empieza en/después del punto se corre.
  const targetTrackIdFinal = targetTrack.id;
  for (const item of next.timeline.clips) {
    if (item.trackId !== targetTrackIdFinal) continue;
    if (item.startFrame < start) continue;
    item.startFrame += duration;
  }
  clip.trackId = targetTrackIdFinal;
  clip.startFrame = start;
  next.timeline.clips.push(clip);

  if (!trackIsValid(next, targetTrackIdFinal)) return null;
  if (targetTrackIdFinal !== original.trackId && !trackIsValid(next, original.trackId)) {
    return null;
  }
  touch(next);
  return next;
}

/**
 * Multi-selección: mueve varios clips el mismo delta en sus pistas.
 *
 * Se aplica de derecha a izquierda (si el delta es positivo) para que los
 * clips no se pisen entre sí. No cambia de pista: el arrastre de grupo es un
 * desplazamiento temporal, cambiar de pista es una edición por clip.
 */
export function moveClipsBy(
  project: ProjectDocument,
  clipIds: readonly string[],
  deltaFrames: number,
): ProjectDocument | null {
  if (clipIds.length === 0 || deltaFrames === 0) return project;
  const next = cloneProject(project);
  const moving = next.timeline.clips
    .filter((clip) => clipIds.includes(clip.id))
    .sort((a, b) => a.startFrame - b.startFrame);
  if (moving.length === 0) return next;
  for (const clip of moving) {
    const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
    if (track?.locked) return null;
  }
  const ordered = deltaFrames > 0 ? [...moving].reverse() : moving;
  for (const clip of ordered) {
    const start = clip.startFrame + deltaFrames;
    if (start < 0) return null;
    clip.startFrame = start;
  }
  const tracks = new Set(moving.map((clip) => clip.trackId));
  for (const trackId of tracks) {
    if (!trackIsValid(next, trackId)) return null;
  }
  touch(next);
  return next;
}

/** Borra varios clips; con `ripple` cierra los huecos de cada pista. */
export function deleteClips(
  project: ProjectDocument,
  clipIds: readonly string[],
  ripple: boolean,
): ProjectDocument | null {
  if (clipIds.length === 0) return project;
  let next = project;
  for (const clipId of clipIds) {
    const clip = next.timeline.clips.find((item) => item.id === clipId);
    if (!clip) continue;
    const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
    if (track?.locked) {
      throw new ProjectActionError(`la pista de ${clip.label ?? 'el clip'} está bloqueada`);
    }
    if (ripple) {
      // rippleDeleteClip viene de project-actions y ya cierra el hueco.
      // Import perezoso para no duplicar la lógica.
      next = rippleDeleteClipLocal(next, clipId);
    } else {
      next = deleteClipLocal(next, clipId);
    }
  }
  return next;
}

// Se importan al final para que el módulo sea legible y los helpers puros.
import {
  deleteClip as deleteClipLocal,
  rippleDeleteClip as rippleDeleteClipLocal,
} from '../../state/project-actions';
