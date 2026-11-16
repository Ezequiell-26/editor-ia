import { useSyncExternalStore } from 'react';

/**
 * Modo «dibujar a mano» sobre el monitor (paridad del `maozinha` de
 * AlaukCut): el usuario traza libre sobre el frame y al soltar se crea un
 * clip gráfico con el template `shape` (`shape:'line'` + `boxX/Y/W/H` +
 * puntos decimados). Estado de UI efímero: no entra en el documento ni en
 * el historial de deshacer.
 */
let armed = false;
const listeners = new Set<() => void>();

/** Color y grosor del próximo trazo (fracción del lado menor de la caja,
 * igual que `strokeWidth` del template `shape`). Efímero como `armed`. */
let strokeColor = '#ffd23f';
let strokeWidth = 0.018;

export function getDoodleStyle(): { color: string; width: number } {
  return { color: strokeColor, width: strokeWidth };
}

export function setDoodleStyle(color: string, width: number): void {
  strokeColor = color;
  strokeWidth = width;
  for (const listener of listeners) listener();
}

export function isDoodleArmed(): boolean {
  return armed;
}

export function setDoodleArmed(value: boolean): void {
  if (armed === value) return;
  armed = value;
  for (const listener of listeners) listener();
}

export function subscribeDoodle(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDoodleArmed(): boolean {
  return useSyncExternalStore(subscribeDoodle, isDoodleArmed, isDoodleArmed);
}
