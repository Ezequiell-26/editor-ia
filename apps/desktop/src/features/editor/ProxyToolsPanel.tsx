import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProxyProgressEvent, ProxyStatus } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import { saveEditorPreferences } from '../../state/editor-preferences';
import {
  applyProxyAssetToProject,
  detectProxyPlaybackSupport,
  isProxyCandidate,
  proxyActionLabel,
  proxyBadge,
  proxyPlaybackPath,
} from './proxy-ui';

const MAX_TRACKED = 24;

/**
 * Panel compacto de proxies dentro del rail de medios.
 *
 * La UI decide cuándo generar (el backend nunca auto-genera): con `autoProxy`
 * activo se piden para video >1080p al abrir el editor; también hay acción
 * manual/cancelar/reintentar. El progreso viene del evento `proxy-progress`.
 * Si el backend no está disponible, se informa y no se simula ningún estado.
 */
export function ProxyToolsPanel() {
  const store = useProjectStore();
  const preferences = useEditorPreferences();
  const project = store.state.project;
  const [statuses, setStatuses] = useState<Record<string, ProxyStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const autoRequested = useRef<Set<string>>(new Set());
  const playbackSupport = detectProxyPlaybackSupport(store.service);

  const videos = useMemo(
    () => (project ? project.assets.filter((asset) => asset.kind === 'video').slice(0, MAX_TRACKED) : []),
    [project],
  );
  const candidates = useMemo(
    () => videos.filter((asset) => isProxyCandidate(asset)),
    [videos],
  );
  const visible = useMemo(
    () =>
      videos.filter((asset) => {
        const status = statuses[asset.id];
        return Boolean(status && status.state !== 'missing') || isProxyCandidate(asset);
      }),
    [videos, statuses],
  );

  useEffect(() => {
    if (!store.service.available || videos.length === 0) return;
    let active = true;
    void Promise.all(
      videos.map((asset) =>
        store.service
          .proxyStatus(asset.id)
          .then((status) => (active ? ([asset.id, status] as const) : null))
          .catch(() => null),
      ),
    ).then((entries) => {
      if (!active) return;
      const next: Record<string, ProxyStatus> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setStatuses((current) => ({ ...current, ...next }));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.service, videos.length]);

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    let off: (() => void) | null = null;
    void store.service
      .onProxyProgress((event: ProxyProgressEvent) => {
        if (!active) return;
        setStatuses((current) => {
          const previous = current[event.assetId];
          if (!previous) return current;
          return {
            ...current,
            [event.assetId]: {
              ...previous,
              state: event.state,
              quality: event.quality,
              percent: event.percent,
              phase: event.phase,
            },
          };
        });
        if (event.state !== 'queued' && event.state !== 'generating') {
          // Al terminar/cancelar/fallar se refresca el estado verificado; si
          // quedó listo, se aplica el proxy al asset del proyecto.
          void store.service
            .proxyStatus(event.assetId)
            .then((status) => {
              if (active) setStatuses((current) => ({ ...current, [event.assetId]: status }));
              if (event.state === 'ready' && active && playbackSupport.supported) {
                return adoptProxy(event.assetId);
              }
              return undefined;
            })
            .catch(() => null);
        }
      })
      .then((unlisten) => {
        off = unlisten;
      })
      .catch(() => null);
    return () => {
      active = false;
      off?.();
    };
  }, [store.service]);

  async function adoptProxy(assetId: string): Promise<void> {
    // Firma del contrato: un argumento; el backend resuelve la ruta verificada.
    const updated = await store.service.applyProxyToAsset(assetId);
    if (!updated) {
      setError(
        'El proxy está listo, pero el backend no pudo aplicarlo al proyecto; la reproducción sigue usando el original.',
      );
      return;
    }
    store.update((current) => applyProxyAssetToProject(current, updated));
  }

  async function generate(assetId: string): Promise<void> {
    setBusy(assetId);
    setError(null);
    try {
      const status = await store.service.ensureProxy(assetId, preferences.proxyQuality);
      setStatuses((current) => ({ ...current, [assetId]: status }));
      if (proxyPlaybackPath(status) && playbackSupport.supported) {
        await adoptProxy(assetId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo generar el proxy');
    } finally {
      setBusy(null);
    }
  }

  async function cancel(assetId: string): Promise<void> {
    setBusy(assetId);
    setError(null);
    try {
      const status = await store.service.cancelProxy(assetId);
      setStatuses((current) => ({ ...current, [assetId]: status }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo cancelar el proxy');
    } finally {
      setBusy(null);
    }
  }

  // Auto-proxy sólo para candidatos >1080p, una vez por asset y sesión.
  useEffect(() => {
    if (!preferences.autoProxy || !store.service.available) return;
    for (const asset of candidates) {
      const status = statuses[asset.id];
      if (!status || autoRequested.current.has(asset.id)) continue;
      if (status.exists && status.upToDate) continue;
      if (status.state === 'queued' || status.state === 'generating' || status.state === 'failed') continue;
      autoRequested.current.add(asset.id);
      void generate(asset.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.autoProxy, candidates, statuses, store.service]);

  if (!project) return null;

  return (
    <section className="proxy-tools" aria-label="Proxies de reproducción">
      <div className="proxy-tools-head">
        <p className="eyebrow">Proxies</p>
        <label className="check proxy-auto">
          <input
            type="checkbox"
            checked={preferences.autoProxy}
            onChange={(event) =>
              saveEditorPreferences({ ...preferences, autoProxy: event.target.checked })
            }
            disabled={!store.service.available}
          />
          <span>Auto &gt;1080p</span>
        </label>
      </div>
      {!store.service.available ? (
        <p className="fine-print">Proxies no disponibles en navegador.</p>
      ) : visible.length === 0 ? (
        <p className="fine-print">No hay medios 4K/&gt;1080p para proxear.</p>
      ) : (
        <ul className="proxy-list">
          {visible.map((asset) => {
            const status = statuses[asset.id];
            const badge = proxyBadge(status);
            const playback = proxyPlaybackPath(status);
            const working = status?.state === 'queued' || status?.state === 'generating';
            return (
              <li key={asset.id} className={`proxy-item ${badge.tone}`}>
                <div className="proxy-item-main">
                  <strong title={asset.label}>{asset.label}</strong>
                  <span className={`proxy-badge ${badge.tone}`}>
                    {badge.label}
                    {badge.percent !== null ? ` ${badge.percent}%` : ''}
                  </span>
                </div>
                {badge.percent !== null ? (
                  <div className="proxy-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={badge.percent}>
                    <span style={{ width: `${badge.percent}%` }} />
                  </div>
                ) : null}
                {playback ? (
                  <p className="fine-print proxy-path" title={playback}>
                    {playback}
                  </p>
                ) : null}
                <div className="actions compact">
                  <button
                    type="button"
                    className="small"
                    disabled={busy === asset.id || status?.state === 'ready'}
                    onClick={() => {
                      if (working) void cancel(asset.id);
                      else void generate(asset.id);
                    }}
                  >
                    {busy === asset.id ? '…' : proxyActionLabel(status)}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!playbackSupport.supported ? (
        <p className="fine-print">{playbackSupport.reason}</p>
      ) : null}
      {error ? <p className="notice notice-error">{error}</p> : null}
    </section>
  );
}
