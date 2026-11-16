import { useSyncExternalStore } from 'react';

/**
 * Layout del editor (paridad `paineis.js` de AlaukCut): el mismo grid se
 * redistribuye sin mover piezas en el HTML.
 *
 * - `padrao`: biblioteca | monitor | inspector, timeline abajo (el actual).
 * - `shorts`: monitor como columna derecha de altura completa, pensado para
 *   video vertical 9:16; la timeline ocupa sólo el bloque izquierdo.
 * - `edicion`: columna derecha dedicada a la IA (paridad `layout-edicao` de
 *   AlaukCut): el asistente se hospeda ahí por portal y la timeline pasa por
 *   debajo de todos los paneles salvo esa columna.
 *
 * La variante `duplo` de AlaukCut (previsualización en segunda ventana) ya
 * existe en Olyvia como `previewDetached` — no se duplica acá.
 *
 * Estado efímero de UI persistido en localStorage: no entra al documento
 * del proyecto ni al historial de deshacer.
 */

export type EditorLayout = 'padrao' | 'shorts' | 'edicion';

export const EDITOR_LAYOUTS: readonly EditorLayout[] = ['padrao', 'shorts', 'edicion'];

const STORAGE_KEY = 'editoria.layout.v1';

function readLayout(): EditorLayout {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'padrao' || value === 'shorts' || value === 'edicion') return value;
    return 'padrao';
  } catch {
    return 'padrao';
  }
}

// First run uses AlaukCut's media, monitor and inspector workspace.
// Any explicitly saved layout choice is respected.
let current: EditorLayout = typeof window === 'undefined' ? 'padrao' : readLayout();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getEditorLayout(): EditorLayout {
  return current;
}

export function setEditorLayout(layout: EditorLayout): void {
  if (layout === current) return;
  current = layout;
  try {
    window.localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    /* almacenamiento no disponible: el layout vale para la sesión */
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditorLayout(): EditorLayout {
  return useSyncExternalStore(subscribe, getEditorLayout, () => 'padrao' as const);
}
