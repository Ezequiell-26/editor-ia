import { useSyncExternalStore } from 'react';
import type { ProxyStatus } from '../../services/contracts/media';

/**
 * Registro compartido de estados de proxy para la vista previa.
 *
 * `ProxyToolsPanel` consulta `proxyStatus` por asset para su lista; el modo
 * «Calidad automática» del monitor necesita el mismo dato para las capas de
 * video visibles SIN mutar el proyecto (a diferencia de
 * `applyProxyToAsset`, que persiste `asset.proxy`). Este store es la fuente
 * única: cualquier consumidor publica lo que el backend verifica y los
 * lectores (VideoLayer) suscriben por assetId.
 *
 * Estado efímero de sesión, mismo mecanismo que `look-audition.ts`: no se
 * persiste ni ensucia el documento.
 */

const statuses = new Map<string, ProxyStatus>();
/** assetIds ya reclamados para fetch esta sesión (evita re-consultar en loop). */
const claimed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Publica (o retira con `null`) el estado verificado de un asset. */
export function publishProxyStatus(status: ProxyStatus | null, assetId?: string): void {
  const id = status?.assetId ?? assetId;
  if (!id) return;
  const previous = statuses.get(id);
  if (!status) {
    if (!statuses.delete(id)) return;
  } else {
    if (
      previous &&
      previous.state === status.state &&
      previous.path === status.path &&
      previous.exists === status.exists &&
      previous.upToDate === status.upToDate &&
      previous.percent === status.percent
    ) {
      return;
    }
    statuses.set(id, status);
  }
  emit();
}

/** Estado conocido del asset, si alguien ya lo consultó. */
export function getProxyStatus(assetId: string): ProxyStatus | undefined {
  return statuses.get(assetId);
}

/**
 * Reclama el asset para una única consulta de estado. Devuelve `true` la
 * primera vez (el caller debe fetchear y publicar); `false` después.
 */
export function claimProxyStatusFetch(assetId: string): boolean {
  if (claimed.has(assetId)) return false;
  claimed.add(assetId);
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Versión actual del registro (sin suscripción; útil en tests y logs). */
export function proxyStatusVersion(): number {
  return version;
}

/**
 * Versión del registro para `useSyncExternalStore`. El Map es estable; los
 * consumidores leen con `getProxyStatus(assetId)` dentro del render.
 */
export function useProxyStatusVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

/** Sólo para tests: deja el registro en cero. */
export function resetProxyStatusStoreForTests(): void {
  statuses.clear();
  claimed.clear();
  emit();
}
