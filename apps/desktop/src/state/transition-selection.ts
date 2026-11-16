import { useSyncExternalStore } from 'react';

/**
 * Selección de transición de entrada compartida entre Timeline y el borrado
 * contextual (paridad del nivel «transición» de `excluirPeloAtalho` en
 * AlaukCut: Delete prioriza clave > transición > clip). Olyvia modela la
 * transición como atributo `transitionIn` del clip, así que la referencia es
 * el id del clip dueño; el delete valida que la transición siga existiendo.
 */
export interface SelectedTransitionRef {
  readonly clipId: string;
}

let current: SelectedTransitionRef | null = null;
const listeners = new Set<() => void>();

export function getSelectedTransition(): SelectedTransitionRef | null {
  return current;
}

export function setSelectedTransition(ref: SelectedTransitionRef | null): void {
  if (
    current === ref ||
    (current && ref && current.clipId === ref.clipId)
  ) {
    return;
  }
  current = ref;
  for (const listener of listeners) listener();
}

export function subscribeTransitionSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedTransition(): SelectedTransitionRef | null {
  return useSyncExternalStore(
    subscribeTransitionSelection,
    getSelectedTransition,
    getSelectedTransition,
  );
}
