import { useSyncExternalStore } from 'react';
import type { Clip, ClipEffects } from '@editor-ia/project-schema';

/**
 * Audición de looks del catálogo (patrón Concat «Library audition»): al
 * pasar el cursor o el foco por una tarjeta de filtro/efecto del panel de
 * biblioteca, la vista previa muestra el clip seleccionado con esos efectos
 * SIN tocar el documento — nada de `mutate`, nada de historial de deshacer.
 *
 * El estado vive fuera del store del proyecto (mismo mecanismo que
 * `catalog-favorites.ts`) porque es efímero: no se persiste, no ensucia el
 * `.editoria.json` y desaparece al soltar el cursor, cambiar de clip, de
 * vista o desmontar el panel.
 *
 * Semántica fiel a `applyPreset`: aplicar un look REEMPLAZA `clip.effects`
 * entero, así que la audición también reemplaza — lo que se ve al pasar el
 * cursor es exactamente lo que queda al hacer clic.
 */
export interface LookAudition {
  /** Clip sobre el que se audiciona (normalmente el seleccionado). */
  readonly clipId: string;
  /** Nombre visible, para marcar la tarjeta que está sonando. */
  readonly label: string;
  /** Efectos que la preview debe usar en lugar de los del clip. */
  readonly effects: ClipEffects;
}

let current: LookAudition | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getLookAudition(): LookAudition | null {
  return current;
}

export function setLookAudition(next: LookAudition | null): void {
  if (current === next) return;
  current = next;
  emit();
}

export function clearLookAudition(): void {
  setLookAudition(null);
}

export function subscribeLookAudition(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook de audición: re-renderiza sólo cuando cambia la tarjeta sonando. */
export function useLookAudition(): LookAudition | null {
  return useSyncExternalStore(
    subscribeLookAudition,
    getLookAudition,
    getLookAudition,
  );
}

/**
 * Efectos que la preview debe usar para `clip`: durante la audición, los del
 * catálogo reemplazan los del clip (igual que al aplicar); fuera de ella, los
 * propios. Clips sin `effects` (audio, compound) devuelven `undefined`.
 */
export function auditionedEffects(
  clip: Clip,
  audition: LookAudition | null,
): ClipEffects | undefined {
  if (!('effects' in clip)) return undefined;
  if (audition && audition.clipId === clip.id) return audition.effects;
  return clip.effects;
}

/** Sólo para tests: deja el módulo en cero. */
export function resetLookAuditionForTests(): void {
  current = null;
  emit();
}
