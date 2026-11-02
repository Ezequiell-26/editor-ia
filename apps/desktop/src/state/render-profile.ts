import type { ProjectDocument } from '@editor-ia/project-schema';
import { aspectRatioOf } from './video-format';

/**
 * Elección del perfil de entrega.
 *
 * Un proyecto vertical exportado con el perfil de YouTube sale con barras
 * negras; uno horizontal exportado como Short sale recortado. El formato del
 * proyecto ya dice cuál corresponde, así que no hace falta preguntarlo.
 */

export function projectRatio(project: ProjectDocument): string {
  return aspectRatioOf(project.video.width, project.video.height);
}

type Profile = ProjectDocument['renderProfiles'][number];

/**
 * Perfil que corresponde al formato del proyecto. Prioridad:
 * 1. el perfil nativo si su resolución es exactamente la del proyecto;
 * 2. el que declara el mismo aspecto;
 * 3. el primero de la lista.
 */
export function chooseExportProfile(project: ProjectDocument): Profile | null {
  const profiles = project.renderProfiles;
  if (profiles.length === 0) return null;
  const native = profiles.find((profile) => profile.name.startsWith('Formato del proyecto'));
  if (
    native &&
    native.resolution.width === project.video.width &&
    native.resolution.height === project.video.height
  ) {
    return native;
  }
  const ratio = projectRatio(project);
  return profiles.find((profile) => profile.aspectRatio === ratio) ?? profiles[0] ?? null;
}
