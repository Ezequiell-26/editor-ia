import type { ProjectDocument } from '@editor-ia/project-schema';
import { addMotionGraphic, fpsOf } from './project-actions';

/**
 * Tarjeta de título del proyecto.
 *
 * No inventa un título: usa el nombre que la persona le puso al proyecto y,
 * como subtítulo, la primera frase de los subtítulos si existen. La heurística
 * de «la primera frase es el título» produce títulos malos («Hola, ¿cómo
 * están?»), así que acá el título es el nombre del proyecto.
 */

export interface TitleCardPlan {
  readonly title: string;
  readonly subtitle: string;
  readonly durationFrames: number;
}

export function planProjectTitleCard(project: ProjectDocument): TitleCardPlan | null {
  const title = project.name.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const firstCue = [...project.captions.cues].sort(
    (a, b) => a.startFrame - b.startFrame,
  )[0];
  const subtitle = (firstCue?.text ?? '').replace(/\s+/g, ' ').trim();
  return {
    title: title.slice(0, 60),
    subtitle: subtitle.slice(0, 80),
    durationFrames: Math.max(1, Math.round(fpsOf(project) * 3)),
  };
}

/** Agrega la tarjeta al inicio, en su propia pista. Null si no hay nombre. */
export function applyProjectTitleCard(project: ProjectDocument): ProjectDocument | null {
  const plan = planProjectTitleCard(project);
  if (!plan) return null;
  const { project: next } = addMotionGraphic(project, {
    templateId: 'title-card',
    templateVersion: '1.0.0',
    props: {
      title: plan.title,
      subtitle: plan.subtitle,
      background: '#0f172a',
      accent: '#35d6ff',
      align: 'left',
      animation: 'slide-up',
    },
    durationFrames: plan.durationFrames,
    atFrame: 0,
    label: plan.title,
  });
  return next;
}
