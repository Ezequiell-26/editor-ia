import { useSyncExternalStore } from 'react';

/**
 * Registro del elemento DOM que hospeda al asistente cuando el layout del
 * editor es «Edición» (paridad de la `.ia-coluna` de AlaukCut): el panel del
 * AssistantDock se monta por portal dentro de esa columna en vez de flotar
 * como popover, y vuelve a flotar solo al salir del layout — el estado de la
 * conversación nunca se remonta.
 */

let element: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setAiColumnElement(node: HTMLElement | null): void {
  if (element === node) return;
  element = node;
  emit();
}

export function getAiColumnElement(): HTMLElement | null {
  return element;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiColumnElement(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getAiColumnElement, () => null);
}
