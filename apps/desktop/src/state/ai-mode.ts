import { useSyncExternalStore } from 'react';

/**
 * «Modo IA» del editor: una vista reducida de la pantalla de edición —
 * preview + timeline (la pantalla donde se ve lo que la IA hace) y el
 * asistente lateral— que oculta las herramientas manuales (biblioteca de
 * medios, inspector, toolbar de la timeline).
 *
 * Es una VISTA, no un bloqueo: la edición manual sigue posible por teclado
 * y menú, y al apagarlo se restaura exactamente el estado anterior (los
 * paneles nunca se desmontan con estado propio que se pierda: se decide en
 * el render, no se guarda nada extra).
 *
 * Estado efímero de UI persistido en localStorage: no entra al documento
 * del proyecto ni al historial de deshacer. Mismo patrón que
 * `editor-layout.ts`.
 *
 * `aiOnly` es el modo de superficie de la app completa: cuando está activo,
 * `getAiMode()` siempre devuelve true y las superficies manuales se ocultan.
 */

const STORAGE_KEY = 'editoria.ai-mode.v1';
const AI_ONLY_KEY = 'editoria.ai-only.v1';

/**
 * Superficie única de la app: el editor se abre con preview, timeline y el
 * chat acoplado, sin controles de edición manual. Es la configuración por
 * defecto en la app real (dev y build); los tests conservan el escenario
 * anterior para no alterar los cientos de casos que cubren el editor completo.
 * Se puede desactivar con `localStorage['editoria.ai-only.v1'] = '0'`.
 */
const AI_ONLY_DEFAULT = import.meta.env.MODE !== 'test';

function readAiMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readAiOnly(): boolean {
  try {
    const stored = window.localStorage.getItem(AI_ONLY_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* almacenamiento no disponible: vale el default de la compilación */
  }
  return AI_ONLY_DEFAULT;
}

let aiOnly: boolean = typeof window === 'undefined' ? AI_ONLY_DEFAULT : readAiOnly();
let current: boolean = typeof window === 'undefined' ? false : readAiMode();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getAiMode(): boolean {
  // Con la superficie IA-only el modo reducido deja de ser opcional: todas las
  // superficies que consultan `useAiMode()` ven la misma vista reducida.
  return aiOnly || current;
}

export function getAiOnly(): boolean {
  return aiOnly;
}

export function setAiOnly(enabled: boolean): void {
  if (enabled === aiOnly) return;
  aiOnly = enabled;
  try {
    window.localStorage.setItem(AI_ONLY_KEY, enabled ? '1' : '0');
  } catch {
    /* almacenamiento no disponible: la preferencia vale para esta sesión */
  }
  emit();
}

export function setAiMode(enabled: boolean): void {
  if (enabled === current) return;
  current = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* almacenamiento no disponible: el modo vale para la sesión */
  }
  emit();
}

export function toggleAiMode(): void {
  setAiMode(!current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiMode(): boolean {
  return useSyncExternalStore(subscribe, getAiMode, () => false);
}

export function useAiOnly(): boolean {
  return useSyncExternalStore(subscribe, getAiOnly, () => false);
}

/** Nombre único para el proyecto con el que arranca la superficie IA. */
export function suggestAiProjectName(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Proyecto IA ${stamp}`;
}
