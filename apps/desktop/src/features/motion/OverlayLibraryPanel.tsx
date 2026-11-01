import { useEffect, useState } from 'react';
import type { BuiltinOverlay } from '../../services/project-service';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  updateClip,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

/**
 * Biblioteca de overlays empaquetados: videos procedurales propios (CC0) que
 * se copian al proyecto y se montan en una pista "Overlays" con la mezcla que
 * declara el catálogo. Sin backend nativo la lista viene vacía y no se muestra
 * nada; no hay placeholders ni overlays simulados.
 */
export function OverlayLibraryPanel() {
  const store = useProjectStore();
  const project = store.state.project;
  const [overlays, setOverlays] = useState<readonly BuiltinOverlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    store.service
      .listBuiltinOverlays()
      .then((items) => {
        if (!cancelled) setOverlays(items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'no se pudo leer la biblioteca');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store.service]);

  async function addOverlay(overlay: BuiltinOverlay): Promise<void> {
    if (!project || busyId) return;
    setBusyId(overlay.id);
    setError('');
    try {
      const fps = project.video.frameRate;
      const imported = await store.service.importBuiltinOverlay({
        id: overlay.id,
        fpsNum: fps.num,
        fpsDen: fps.den,
      });
      const atFrame = store.state.playheadFrame;
      const durationFrames = Math.max(
        1,
        Math.round(imported.durationSeconds * (fps.num / Math.max(1, fps.den))),
      );
      store.update((current) => {
        const withAsset = addAsset(current, imported.asset);
        const existing = withAsset.timeline.tracks.find(
          (track) => track.kind === 'video' && track.label === 'Overlays',
        );
        let base = withAsset;
        let trackId = existing?.id ?? '';
        if (!existing) {
          const created = addTrack(withAsset, 'video', 'Overlays');
          base = created.project;
          trackId = created.trackId;
        }
        const added = addClipFromAsset(base, imported.asset, {
          trackId,
          atFrame,
          durationFrames,
        });
        return imported.blendMode === 'normal'
          ? added.project
          : updateClip(added.project, added.clipId, {
              blendMode: imported.blendMode,
            });
      });
      store.setNotice(
        `Overlay “${imported.label}” agregado en la pista Overlays con mezcla ${imported.blendMode}.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo agregar el overlay');
    } finally {
      setBusyId(null);
    }
  }

  if (!loading && overlays.length === 0 && !error) return null;
  return (
    <section className="motion-overlays" aria-label="Overlays propios">
      <div className="motion-overlays-head">
        <div>
          <p className="eyebrow">Overlays propios</p>
          <h3>Recursos incluidos, sin stock</h3>
          <p className="fine-print">
            Generados por Olyvia (CC0). Se copian al proyecto y se montan en una pista
            Overlays con mezcla Screen.
          </p>
        </div>
      </div>
      {loading ? <p className="fine-print">Cargando overlays…</p> : null}
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      <div className="motion-overlay-grid">
        {overlays.map((overlay) => (
          <article key={overlay.id} className="motion-overlay-card">
            {overlay.thumbnail ? (
              <img
                src={overlay.thumbnail}
                alt={`Miniatura de ${overlay.label}`}
                loading="lazy"
              />
            ) : (
              <div className="motion-overlay-placeholder" aria-hidden="true" />
            )}
            <div className="motion-overlay-body">
              <strong>{overlay.label}</strong>
              <small>{overlay.description}</small>
              <span className="fine-print">
                {overlay.durationSeconds}s · {overlay.width}×{overlay.height} ·{' '}
                {overlay.blendMode === 'screen'
                  ? 'Screen'
                  : overlay.blendMode === 'normal'
                    ? 'Normal'
                    : overlay.blendMode}
                {overlay.hasAlpha ? ' · Alfa' : ''}
              </span>
            </div>
            <button
              type="button"
              className="small primary"
              disabled={!project || busyId !== null}
              onClick={() => void addOverlay(overlay)}
            >
              {busyId === overlay.id ? 'Agregando…' : 'Agregar'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
