import { useSyncExternalStore } from 'react';

/**
 * Espía de medios (paridad `espiada_midia.js` de AlaukCut): al pasar el
 * cursor sobre la tarjeta de un medio en la biblioteca, el monitor
 * muestra el frame del instante bajo el cursor con su timecode.
 *
 * El estado es efímero (fuera del documento): `assetId` + `url` +
 * `durationSeconds` identifican el medio; `timeSeconds` se actualiza
 * con el puntero y la preview busca el frame en un <video> propio.
 */

export interface MediaSpyState {
  readonly assetId: string;
  readonly url: string;
  readonly kind: 'video' | 'image';
  readonly durationSeconds: number;
  readonly timeSeconds: number;
}

let current: MediaSpyState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Abre el espía sobre un medio; `timeSeconds` es el instante inicial. */
export function showMediaSpy(
  assetId: string,
  url: string,
  kind: 'video' | 'image',
  durationSeconds: number,
  timeSeconds: number,
): void {
  current = { assetId, url, kind, durationSeconds, timeSeconds };
  emit();
}

/** Actualiza sólo el instante (movimiento del puntero sobre la tarjeta). */
export function scrubMediaSpy(timeSeconds: number): void {
  if (!current) return;
  current = { ...current, timeSeconds };
  emit();
}

export function hideMediaSpy(): void {
  if (!current) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMediaSpy(): MediaSpyState | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Snapshot sin suscripción (tests, handlers imperativos). */
export function getMediaSpy(): MediaSpyState | null {
  return current;
}
