/**
 * Traducción de teclado a acciones de clip en la timeline (fase 2 de
 * accesibilidad): mover y recortar sin mouse, sobre el clip seleccionado.
 *
 * Esquema (registrado en `state/shortcuts.ts` y documentado en
 * docs/ATAJOS-PRO.md; las flechas sin Alt siguen moviendo el playhead):
 *
 * - `Alt+←` / `Alt+→`           mueve el clip 1 frame a la izquierda/derecha.
 * - `Alt+Shift+←` / `Alt+Shift+→`  mueve el clip 1 segundo (fps frames).
 * - `Alt+↑` / `Alt+↓`           lleva el clip a la pista compatible de
 *                               arriba/abajo en el orden de la interfaz.
 * - `Ctrl+Alt+←` / `Ctrl+Alt+→`   recorta el **borde de entrada**.
 * - `Ctrl+Alt+Shift+←` / `Ctrl+Alt+Shift+→`  recorta el **borde de salida**.
 *
 * El "borde activo" es el borde que la combinación tiene agarrado: Ctrl+Alt
 * agarra el de entrada, Ctrl+Alt+Shift el de salida, y la flecha apunta hacia
 * dónde se mueve ese borde (→ estira o acorta según el borde, igual que
 * arrastrar el asa con el mouse).
 *
 * Es un módulo puro: decide la acción, no la ejecuta. La ejecución vive en el
 * keydown del contenedor de la timeline (`EditorWorkspace.tsx`), que es donde
 * ya viven Supr, S dividir y el paso de playhead con flechas.
 */

import type { Clip, ProjectDocument, Track } from '@editor-ia/project-schema';

export type ClipKeyboardAction =
  | { kind: 'move'; deltaFrames: number }
  | { kind: 'move-track'; direction: -1 | 1 }
  | { kind: 'trim'; edge: 'start' | 'end'; deltaFrames: number };

/** Sólo los campos del evento que la decisión necesita (fácil de probar). */
export interface ClipKeyboardEvent {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
}

/**
 * Compatibilidad clip ↔ pista. Espeja la tabla interna de `project-actions`
 * (`compatibleTrackKinds`), igual que hace el arrastre en `Timeline.tsx`.
 */
export function isCompatibleTrack(kind: Clip['kind'], trackKind: Track['kind']): boolean {
  switch (kind) {
    case 'video':
      return trackKind === 'video';
    case 'image':
      return trackKind === 'image';
    case 'audio':
      return trackKind === 'audio' || trackKind === 'narration';
    case 'graphic':
      return trackKind === 'graphic';
    case 'freeze':
      return trackKind === 'video';
    case 'adjustment':
      return trackKind === 'adjustment';
    case 'compound':
      return trackKind === 'video' || trackKind === 'image' || trackKind === 'graphic' || trackKind === 'adjustment';
    default:
      return false;
  }
}

/**
 * Pista compatible más cercana en la dirección pedida, siguiendo el orden de
 * la interfaz (las filas se pintan de mayor a menor `order`, así que "arriba"
 * es el orden más alto). Salta pistas de otro tipo sin detenerse en ellas.
 */
export function nearestCompatibleTrack(
  project: ProjectDocument,
  clip: Clip,
  direction: -1 | 1,
): Track | null {
  const ordered = [...project.timeline.tracks].sort((a, b) => b.order - a.order);
  const index = ordered.findIndex((track) => track.id === clip.trackId);
  if (index < 0) return null;
  for (let i = index + direction; i >= 0 && i < ordered.length; i += direction) {
    const candidate = ordered[i];
    if (candidate && isCompatibleTrack(clip.kind, candidate.kind)) return candidate;
  }
  return null;
}

/**
 * ¿Qué acción de clip pide este evento? Devuelve null si el evento no es una
 * combinación de edición de clip: sin Alt, teclas que no son flechas, o un
 * evento que otro control ya prevenió (grip del playhead, asas de fade, menú
 * contextual).
 */
export function clipKeyboardAction(
  event: ClipKeyboardEvent,
  fps: number,
): ClipKeyboardAction | null {
  if (event.defaultPrevented) return null;
  if (!event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return null;
    const edge = event.shiftKey ? 'end' : 'start';
    return { kind: 'trim', edge, deltaFrames: event.key === 'ArrowRight' ? 1 : -1 };
  }
  const second = Math.max(1, Math.round(fps));
  switch (event.key) {
    case 'ArrowLeft':
      return { kind: 'move', deltaFrames: event.shiftKey ? -second : -1 };
    case 'ArrowRight':
      return { kind: 'move', deltaFrames: event.shiftKey ? second : 1 };
    case 'ArrowUp':
      return { kind: 'move-track', direction: -1 };
    case 'ArrowDown':
      return { kind: 'move-track', direction: 1 };
    default:
      return null;
  }
}
