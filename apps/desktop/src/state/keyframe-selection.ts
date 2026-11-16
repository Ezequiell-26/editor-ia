import { useSyncExternalStore } from 'react';

/**
 * Selección de keyframe de transformación compartida entre Inspector y
 * Timeline (paridad del delete contextual de AlaukCut: Delete prioriza la
 * clave seleccionada sobre el clip). Antes vivía como `useState` local del
 * Inspector y la timeline no podía saber qué clave estaba elegida.
 */
export interface SelectedKeyframeRef {
  readonly clipId: string;
  /** Frame local del clip (no absoluto de timeline). */
  readonly frame: number;
}

let current: SelectedKeyframeRef | null = null;
const listeners = new Set<() => void>();

export function getSelectedKeyframe(): SelectedKeyframeRef | null {
  return current;
}

export function setSelectedKeyframe(ref: SelectedKeyframeRef | null): void {
  if (current === ref) return;
  if (
    current &&
    ref &&
    current.clipId === ref.clipId &&
    current.frame === ref.frame
  ) {
    return;
  }
  current = ref;
  for (const listener of listeners) listener();
}

export function subscribeKeyframeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedKeyframe(): SelectedKeyframeRef | null {
  return useSyncExternalStore(
    subscribeKeyframeSelection,
    getSelectedKeyframe,
    getSelectedKeyframe,
  );
}
