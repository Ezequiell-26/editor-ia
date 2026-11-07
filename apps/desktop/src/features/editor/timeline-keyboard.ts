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
import {
  DEFAULT_SHORTCUTS,
  normalizeBinding,
  type ShortcutId,
  type ShortcutMap,
} from '../../state/shortcuts';

/** Ids del registro que gobiernan las acciones de clip por teclado. */
export type ClipShortcutId = Extract<
  ShortcutId,
  | 'timeline.clipMoveLeft'
  | 'timeline.clipMoveRight'
  | 'timeline.clipMoveTrackUp'
  | 'timeline.clipMoveTrackDown'
  | 'timeline.clipTrimIn'
  | 'timeline.clipTrimOut'
>;

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
 * Binding canónico del evento (mismo formato que `eventToBinding`, pero sobre
 * la forma mínima del evento que este módulo necesita para los tests).
 */
function eventBinding(event: ClipKeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key);
  return normalizeBinding(parts.join('+'));
}

/**
 * Quita `Shift` de un binding: en las acciones de clip Shift NO es parte del
 * atajo sino el modificador de la acción (±1 segundo, borde de salida). Por
 * eso el match se hace con el binding "base" de ambos lados.
 */
function stripShift(binding: string): string {
  return normalizeBinding(binding)
    .split('+')
    .filter((part) => part !== 'Shift')
    .join('+');
}

/**
 * ¿Qué acción de clip pide este evento? Devuelve null si el evento no es una
 * combinación de edición de clip o si otro control ya lo prevenió (grip del
 * playhead, asas de fade, menú contextual).
 *
 * Los bindings se leen del registro (`shortcuts`, p.ej. el mapa vigente de
 * Ajustes → Atajos): el usuario puede reasignar cada acción. Sin `shortcuts`
 * se usan los defaults de fábrica, que reproducen el esquema Alt/Ctrl+Alt.
 */
export function clipKeyboardAction(
  event: ClipKeyboardEvent,
  fps: number,
  shortcuts?: ShortcutMap,
): ClipKeyboardAction | null {
  if (event.defaultPrevented) return null;
  const pressed = stripShift(eventBinding(event));
  if (!pressed) return null;
  const second = Math.max(1, Math.round(fps));
  const match = (id: ClipShortcutId): boolean =>
    pressed ===
    stripShift(shortcuts?.[id] ?? DEFAULT_SHORTCUTS[id]);
  if (match('timeline.clipTrimIn')) {
    return { kind: 'trim', edge: event.shiftKey ? 'end' : 'start', deltaFrames: -1 };
  }
  if (match('timeline.clipTrimOut')) {
    return { kind: 'trim', edge: event.shiftKey ? 'end' : 'start', deltaFrames: 1 };
  }
  if (match('timeline.clipMoveLeft')) {
    return { kind: 'move', deltaFrames: event.shiftKey ? -second : -1 };
  }
  if (match('timeline.clipMoveRight')) {
    return { kind: 'move', deltaFrames: event.shiftKey ? second : 1 };
  }
  if (match('timeline.clipMoveTrackUp')) {
    return { kind: 'move-track', direction: -1 };
  }
  if (match('timeline.clipMoveTrackDown')) {
    return { kind: 'move-track', direction: 1 };
  }
  return null;
}
