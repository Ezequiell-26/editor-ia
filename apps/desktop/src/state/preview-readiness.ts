import { useSyncExternalStore } from 'react';

/**
 * Registro de medios de la preview que aún no pueden dibujar/sonar
 * (paridad de `prontidao.js` de AlaukCut: fetches y decodes en vuelo).
 * Las capas reportan su estado y el monitor enciende un indicador
 * «Cargando…» mientras quede alguno pendiente.
 *
 * Cobertura (paridad `prontidao.js` de AlaukCut, que cuenta fetches,
 * decodes y fuentes): imagen, video, audio y fuentes tipográficas en
 * vuelo (`document.fonts`). Los fetches internos del motor (proxies,
 * LUTs) no se trackean — no pasan por elementos DOM.
 */

const pending = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** `ready=false` marca el medio como pendiente; `true` lo libera. */
export function reportPreviewMedia(key: string, ready: boolean): void {
  const had = pending.delete(key);
  if (!ready) pending.add(key);
  if (had !== ready || !ready) emit();
}

/** Libera la clave sin importar su estado (al desmontar la capa). */
export function clearPreviewMedia(key: string): void {
  if (pending.delete(key)) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cantidad actual de medios pendientes (snapshot, sin suscripción). */
export function previewMediaPendingCount(): number {
  return pending.size;
}

let fontsTracked = false;

/**
 * Reporta las fuentes tipográficas en vuelo como una clave única
 * (`fonts`): `document.fonts.status === 'loading'` mientras haya
 * `FontFace` cargando; los eventos `loading`/`loadingdone`/
 * `loadingerror` la reevalúan. Idempotente — llamarla una vez desde
 * el monitor alcanza. Sin `document.fonts` (jsdom/tests) es no-op.
 */
export function trackPreviewFonts(): void {
  if (fontsTracked || typeof document === 'undefined' || !document.fonts) return;
  fontsTracked = true;
  const sync = () =>
    reportPreviewMedia('fonts', document.fonts.status !== 'loading');
  document.fonts.addEventListener('loading', sync);
  document.fonts.addEventListener('loadingdone', sync);
  document.fonts.addEventListener('loadingerror', sync);
  sync();
}

/** Cantidad de medios visibles aún cargando (0 = preview lista). */
export function usePreviewMediaPending(): number {
  return useSyncExternalStore(
    subscribe,
    () => pending.size,
    () => 0,
  );
}
