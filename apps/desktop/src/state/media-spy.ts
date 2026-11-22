import { useSyncExternalStore } from 'react';

/**
 * Espía de medios (paridad `espiada_midia.js` de AlaukCut): al pasar el
 * cursor sobre la tarjeta de un medio en la biblioteca, el monitor
 * muestra el frame del instante bajo el cursor con su timecode.
 *
 * El estado es efímero (fuera del documento): `assetId` + `url` +
 * `durationSeconds` identifican el medio; `timeSeconds` se actualiza
 * con el puntero y la preview busca el frame en un <video> propio.
 *
 * `pinned` (source monitor mínimo): un clic en la tarjeta fija el medio
 * en el monitor — el puntero puede irse y el frame queda. Mientras está
 * fijado, `showMediaSpy` de OTROS medios se ignora (hay que des fijar
 * con otro clic o Escape); `scrubMediaSpy` queda limitado al asset
 * fijado para que la tarjeta vecina no mueva su tiempo.
 */

export interface MediaSpyState {
  readonly assetId: string;
  readonly url: string;
  readonly kind: 'video' | 'image';
  readonly durationSeconds: number;
  readonly timeSeconds: number;
  readonly pinned: boolean;
}

let current: MediaSpyState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Abre el espía sobre un medio; `timeSeconds` es el instante inicial.
 *  Si hay un espía fijado de OTRO medio, la llamada se ignora: el pin
 *  tiene prioridad hasta que se suelta. */
export function showMediaSpy(
  assetId: string,
  url: string,
  kind: 'video' | 'image',
  durationSeconds: number,
  timeSeconds: number,
): void {
  if (current?.pinned && current.assetId !== assetId) return;
  const pinned = current?.assetId === assetId ? current.pinned : false;
  current = { assetId, url, kind, durationSeconds, timeSeconds, pinned };
  emit();
}

/** Actualiza sólo el instante (movimiento del puntero sobre la tarjeta).
 *  Ignora llamadas de otra tarjeta: con pin activo, pasar por encima de
 *  otro medio no debe mover el tiempo del fijado. */
export function scrubMediaSpy(assetId: string, timeSeconds: number): void {
  if (!current || current.assetId !== assetId) return;
  current = { ...current, timeSeconds };
  emit();
}

/** Fija/suelta el medio espiado actual. Si se pide fijar OTRO medio,
 *  reemplaza el estado con ese medio ya fijado (el clic es explícito,
 *  no un hover accidental). */
export function pinMediaSpy(
  assetId: string,
  url: string,
  kind: 'video' | 'image',
  durationSeconds: number,
  timeSeconds: number,
): void {
  if (current?.assetId === assetId) {
    current = { ...current, pinned: !current.pinned };
  } else {
    current = { assetId, url, kind, durationSeconds, timeSeconds, pinned: true };
  }
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
