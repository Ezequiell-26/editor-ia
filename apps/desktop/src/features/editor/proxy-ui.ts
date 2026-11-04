/**
 * Helpers de UI para proxies (contrato redesign-workspace task-16).
 *
 * Sólo presentación y decisiones de frontend: qué medios son candidatos a
 * proxy, cómo etiquetar el estado y qué ruta usar para reproducir. El backend
 * nunca auto-genera: la app decide cuándo llamar `ensureProxy`.
 */
export type ProxyQuality = '540p' | '720p';
export type ProxyState = 'missing' | 'queued' | 'generating' | 'ready' | 'cancelled' | 'failed';

export interface ProxyStatusLike {
  readonly assetId: string;
  readonly state: ProxyState;
  readonly quality: ProxyQuality | null;
  readonly path: string | null;
  readonly exists: boolean;
  readonly upToDate: boolean;
  readonly percent: number;
  readonly phase: string;
  readonly error: string | null;
}

export interface ProxyBadge {
  readonly label: string;
  readonly tone: 'idle' | 'busy' | 'ready' | 'warn';
  readonly percent: number | null;
}

const LABELS: Record<ProxyState, string> = {
  missing: 'Sin proxy',
  queued: 'Proxy en cola',
  generating: 'Generando proxy',
  ready: 'Proxy listo',
  cancelled: 'Proxy cancelado',
  failed: 'Proxy falló',
};

export function proxyBadge(status: ProxyStatusLike | null | undefined): ProxyBadge {
  if (!status) return { label: 'Sin proxy', tone: 'idle', percent: null };
  const tone: ProxyBadge['tone'] =
    status.state === 'ready' && status.exists && status.upToDate
      ? 'ready'
      : status.state === 'queued' || status.state === 'generating'
        ? 'busy'
        : status.state === 'failed' || status.state === 'cancelled'
          ? 'warn'
          : 'idle';
  const percent =
    status.state === 'queued' || status.state === 'generating'
      ? Math.min(100, Math.max(0, Math.round(status.percent)))
      : null;
  return { label: LABELS[status.state] ?? 'Sin proxy', tone, percent };
}

/**
 * Candidato a proxy: video por encima de 1080p (o 4K) — mismo umbral que usa
 * el backend de referencia. Imágenes/audio no se proxean.
 */
export function isProxyCandidate(asset: {
  readonly kind: string;
  readonly media?: unknown;
}): boolean {
  if (asset.kind !== 'video') return false;
  const media = asset.media as
    | { readonly durationFrames?: number; readonly width?: number; readonly height?: number }
    | undefined;
  if (!media) return false;
  const width = typeof media.width === 'number' ? media.width : 0;
  const height = typeof media.height === 'number' ? media.height : 0;
  return width > 1920 || height > 1080;
}

/** Ruta relativa del proxy reproducible, sólo si existe y está actualizado. */
export function proxyPlaybackPath(status: ProxyStatusLike | null | undefined): string | null {
  if (!status || status.state !== 'ready' || !status.exists || !status.upToDate) return null;
  return status.path ?? null;
}

/** Calidad recomendada según el tamaño del origen y la preferencia. */
export function proxyQualityFor(preference: ProxyQuality, candidate: boolean): ProxyQuality {
  return candidate ? preference : preference;
}

/** Etiqueta del botón de acción según el estado actual. */
export function proxyActionLabel(status: ProxyStatusLike | null | undefined): 'Generar proxy' | 'Reintentar proxy' | 'Cancelar' | 'Listo' {
  if (!status) return 'Generar proxy';
  if (status.state === 'failed' || status.state === 'cancelled') return 'Reintentar proxy';
  if (status.state === 'queued' || status.state === 'generating') return 'Cancelar';
  return status.state === 'ready' ? 'Listo' : 'Generar proxy';
}

/** Feature-detect del cable de playback: el backend debe exponer
 * `applyProxyToAsset(assetId)` (un argumento; resuelve la ruta del proxy ya
 * verificado y devuelve el `Asset` actualizado o null). Hasta que exista, la UI
 * lo informa y no toca la reproducción. */
export function detectProxyPlaybackSupport(service: unknown): {
  readonly supported: boolean;
  readonly reason: string | null;
} {
  const candidate =
    service && typeof service === 'object'
      ? (service as { applyProxyToAsset?: unknown })
      : null;
  const supported = typeof candidate?.applyProxyToAsset === 'function';
  return {
    supported,
    reason: supported
      ? null
      : 'Reproducción con proxy pendiente: el backend todavía no expone applyProxyToAsset(assetId); se sigue usando el original',
  };
}

/** Reemplaza el asset por la versión que devolvió el backend (con `proxy`). */
export function applyProxyAssetToProject<
  T extends { readonly assets: readonly { readonly id: string }[] },
>(project: T, updated: { readonly id: string }): T {
  return {
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === updated.id ? (updated as unknown as typeof asset) : asset,
    ),
  };
}
