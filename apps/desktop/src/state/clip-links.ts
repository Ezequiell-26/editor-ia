import type { ProjectDocument } from '@editor-ia/project-schema';
import { ProjectActionError, cloneProject, newId, touch } from './project-actions';

/**
 * Vinculación de clips (paridad link selection de Premiere/Resolve/Kdenlive):
 * los clips que comparten `linkGroup` se consideran una sola unidad al
 * seleccionar, mover y borrar — el caso típico es video+audio del mismo
 * clip fuente. El vínculo es metadata del documento (persiste en el
 * proyecto) y no afecta al render.
 */

function clipOrFail(project: ProjectDocument, clipId: string) {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  return clip;
}

/** Ids de todos los clips del mismo grupo de vínculo (incluye el propio). */
export function linkedClipIds(project: ProjectDocument, clipId: string): string[] {
  const clip = clipOrFail(project, clipId);
  if (!clip.linkGroup) return [clipId];
  return project.timeline.clips
    .filter((item) => item.linkGroup === clip.linkGroup)
    .map((item) => item.id);
}

/**
 * Expande un conjunto de ids con los miembros de sus grupos de vínculo.
 * Es la pieza que usan borrar/mover/seleccionar para tratar el grupo
 * como una unidad.
 */
export function expandWithLinked(
  project: ProjectDocument,
  clipIds: readonly string[],
): string[] {
  const expanded = new Set(clipIds);
  for (const clipId of clipIds) {
    for (const linked of linkedClipIds(project, clipId)) {
      expanded.add(linked);
    }
  }
  return [...expanded];
}

/**
 * Vincula dos o más clips bajo un grupo nuevo (reemplaza vínculos
 * previos de esos clips). Devuelve el `linkGroup` asignado.
 */
export function linkClips(
  project: ProjectDocument,
  clipIds: readonly string[],
): { project: ProjectDocument; linkGroup: string } {
  const unique = [...new Set(clipIds)];
  if (unique.length < 2) {
    throw new ProjectActionError('vincular necesita al menos dos clips');
  }
  for (const clipId of unique) {
    clipOrFail(project, clipId);
  }
  // Idempotente: si los clips ya comparten linkGroup no hay nada que hacer
  // (evita una mutación del documento que ensucie undo y el historial).
  const existing = project.timeline.clips.find((item) => item.id === unique[0])?.linkGroup;
  if (
    existing !== undefined &&
    unique.every(
      (clipId) =>
        project.timeline.clips.find((item) => item.id === clipId)?.linkGroup === existing,
    )
  ) {
    return { project, linkGroup: existing };
  }
  const linkGroup = newId();
  // Grupos viejos que podrían quedar con un solo miembro: disolverlos.
  const staleGroups = new Set(
    unique
      .map((clipId) => project.timeline.clips.find((item) => item.id === clipId)?.linkGroup)
      .filter((group): group is string => group !== undefined && group !== linkGroup),
  );
  const next = cloneProject(project);
  for (const clip of next.timeline.clips) {
    if (unique.includes(clip.id)) {
      clip.linkGroup = linkGroup;
    }
  }
  for (const group of staleGroups) {
    const members = next.timeline.clips.filter((clip) => clip.linkGroup === group);
    if (members.length < 2) {
      for (const member of members) delete member.linkGroup;
    }
  }
  touch(next);
  return { project: next, linkGroup };
}

/**
 * Quita el vínculo de los clips indicados. Un clip sin `linkGroup` se
 * ignora; el resto del grupo conserva su vínculo entre sí.
 */
export function unlinkClips(
  project: ProjectDocument,
  clipIds: readonly string[],
): { project: ProjectDocument; unlinked: number } {
  const unique = [...new Set(clipIds)];
  for (const clipId of unique) {
    clipOrFail(project, clipId);
  }
  // Grupos afectados: si quedan con menos de 2 miembros el vínculo se
  // disuelve — un linkGroup de uno solo es un badge fantasma.
  const affectedGroups = new Set(
    unique
      .map((clipId) => project.timeline.clips.find((item) => item.id === clipId)?.linkGroup)
      .filter((group): group is string => group !== undefined),
  );
  const next = cloneProject(project);
  let unlinked = 0;
  for (const clip of next.timeline.clips) {
    if (unique.includes(clip.id) && clip.linkGroup !== undefined) {
      delete clip.linkGroup;
      unlinked += 1;
    }
  }
  if (unlinked === 0) return { project, unlinked: 0 };
  for (const group of affectedGroups) {
    const members = next.timeline.clips.filter((clip) => clip.linkGroup === group);
    if (members.length < 2) {
      for (const member of members) delete member.linkGroup;
    }
  }
  touch(next);
  return { project: next, unlinked };
}
