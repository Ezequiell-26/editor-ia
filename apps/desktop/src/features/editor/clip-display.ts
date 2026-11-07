import type { Clip } from '@editor-ia/project-schema';

/**
 * Helpers de presentación compartidos por las secciones de recorte del
 * Inspector. Antes `SilenceCutsSection.tsx` y `SpeechCutsSection.tsx`
 * declaraban copias idénticas de ambas funciones.
 *
 * No se unifican con `features/visuals/visuals.ts` ni con
 * `state/brain/policies.ts`: esas funciones se llaman igual pero tienen
 * contratos distintos (etiqueta con `kind + id` y búsqueda por `clipId`
 * dentro de un proyecto, respectivamente). Mezclarlas cambiaría el texto
 * visible en el editor. La colisión de nombres se resuelve en F5.
 */
export function clipSpeedFactor(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  if (!speed) return 1;
  return speed.num / Math.max(1, speed.den);
}

export function clipDisplayName(clip: Clip): string {
  return clip.label ?? 'sin nombre';
}
