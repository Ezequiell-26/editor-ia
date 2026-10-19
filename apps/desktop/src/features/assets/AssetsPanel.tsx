import { useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { useThumbnail } from '../../hooks/useThumbnail';
import {
  addAsset,
  addClipFromAsset,
  framesToSeconds,
  fpsOf,
  markAssetReady,
  removeAsset,
  updateAssetLabel,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

interface AssetsPanelProps {
  readonly onNavigate: (id: ViewId) => void;
}

function kindLabel(kind: Asset['kind']): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'image':
      return 'Imagen';
    case 'audio':
      return 'Audio';
    case 'font':
      return 'Fuente';
    case 'text':
      return 'Texto';
  }
}

function mediaSummary(asset: Asset): string {
  if (asset.kind === 'video' && asset.media) {
    return `${asset.media.width}×${asset.media.height} · ${asset.media.durationFrames} frames`;
  }
  if (asset.kind === 'image' && asset.media) {
    return `${asset.media.width}×${asset.media.height}`;
  }
  if (asset.kind === 'audio' && asset.media) {
    return `${asset.media.sampleRate} Hz · ${asset.media.channels} canales · ${asset.media.durationFrames} frames`;
  }
  return 'sin medición';
}

function AssetCard({
  asset,
  root,
  onUse,
}: {
  readonly asset: Asset;
  readonly root: string;
  readonly onUse: (asset: Asset, narration: boolean) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const thumbnail = useThumbnail(store.service, asset, root);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(asset.label);
  const inUse = project?.timeline.clips.some(
    (clip) => clip.source.type === 'asset' && clip.source.assetId === asset.id,
  );
  const selected = store.state.selection.kind === 'asset' && store.state.selection.id === asset.id;
  const canMount = asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio');

  return (
    <article
      className={selected ? 'asset-card selected' : 'asset-card'}
      onClick={() => store.setSelection({ kind: 'asset', id: asset.id })}
    >
      <div className="asset-thumb">
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <span className={`asset-kind kind-${asset.kind}`}>{kindLabel(asset.kind)}</span>
        )}
        <span className={`asset-status status-${asset.status}`}>{asset.status}</span>
      </div>
      <div className="asset-body">
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!project) return;
              const ok = store.update((current) => updateAssetLabel(current, asset.id, label));
              if (ok) setEditing(false);
            }}
          >
            <input
              value={label}
              autoFocus
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => setEditing(false)}
              aria-label="Nombre del material"
            />
          </form>
        ) : (
          <button
            type="button"
            className="asset-title"
            onClick={() => {
              setLabel(asset.label);
              setEditing(true);
            }}
            title="Editar nombre"
          >
            {asset.label}
          </button>
        )}
        <p className="asset-meta">
          {kindLabel(asset.kind)} · {mediaSummary(asset)}
        </p>
        <p className="asset-meta">
          Licencia: {asset.rights.license.id} · {asset.rights.license.commercialUse} ·{' '}
          {asset.integrity ? `${Math.round(asset.integrity.bytes / 1024)} KB` : 'sin hash'}
        </p>
        {asset.status !== 'ready' ? (
          <div className="rights-actions" onClick={(event) => event.stopPropagation()}>
            <span>Sin derechos confirmados</span>
            <button
              type="button"
              className="small"
              onClick={() => {
                if (!project) return;
                store.update((current) => markAssetReady(current, asset.id, 'allowed'), {
                  notice: `Derechos declarados para ${asset.label}.`,
                });
              }}
            >
              Uso permitido
            </button>
            <button
              type="button"
              className="small"
              onClick={() => {
                if (!project) return;
                store.update((current) => markAssetReady(current, asset.id, 'requires-attribution'), {
                  notice: `Derechos declarados con atribución para ${asset.label}.`,
                });
              }}
            >
              Requiere atribución
            </button>
          </div>
        ) : (
          <div className="actions compact" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="small" disabled={!canMount} onClick={() => onUse(asset, false)}>
              Montar
            </button>
            {asset.kind === 'audio' ? (
              <button type="button" className="small" onClick={() => onUse(asset, true)}>
                Como narración
              </button>
            ) : null}
            <button
              type="button"
              className="small danger-ghost"
              disabled={Boolean(inUse)}
              title={inUse ? 'Está en uso en la timeline' : 'Quitar de la biblioteca'}
              onClick={() => {
                if (!project) return;
                store.update((current) => removeAsset(current, asset.id));
              }}
            >
              Quitar
            </button>
          </div>
        )}
        {inUse ? <p className="fine-print">En uso en la timeline.</p> : null}
      </div>
    </article>
  );
}

export function AssetsPanel({ onNavigate }: AssetsPanelProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [licenseMode, setLicenseMode] = useState<'allowed' | 'requires-attribution'>('allowed');
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!project) {
    return (
      <section className="view">
        <div className="view-head">
          <div>
            <p className="eyebrow">Biblioteca</p>
            <h2>Medios</h2>
            <p className="view-summary">Importá archivos locales y declarales derechos antes de exportar.</p>
          </div>
        </div>
        <p className="empty-state">No hay un proyecto abierto. Creá o abrí uno para importar medios.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  const root = store.state.opened?.root ?? '';
  const fps = fpsOf(project);

  async function importMedia(): Promise<void> {
    if (!rightsConfirmed) {
      setWarnings(['Confirmá que tenés derechos para usar y exportar los archivos antes de importar.']);
      return;
    }
    setBusy(true);
    setWarnings([]);
    try {
      const outcome = await store.service.importAssets(project?.video.frameRate.num ?? 30, project?.video.frameRate.den ?? 1);
      if (!outcome) {
        return;
      }
      if (outcome.assets.length > 0) {
        const ok = store.mutate(
          (current) => {
            let next = current;
            for (const asset of outcome.assets) {
              next = addAsset(next, asset);
              next = markAssetReady(next, asset.id, licenseMode);
            }
            return { project: next };
          },
          { notice: `${outcome.assets.length} medio(s) importados a la carpeta del proyecto.` },
        );
        if (ok) {
          setWarnings(outcome.warnings);
        }
      } else {
        setWarnings(outcome.warnings.length ? outcome.warnings : ['No se seleccionó ningún archivo.']);
      }
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : 'la importación falló']);
    } finally {
      setBusy(false);
    }
  }

  function useAsset(asset: Asset, narration: boolean): void {
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: store.state.playheadFrame,
        narration,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice(`${asset.label} montado en la timeline.`);
      onNavigate('editor');
    }
  }

  return (
    <section className="view assets-view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Biblioteca del proyecto</p>
          <h2>Medios</h2>
          <p className="view-summary">
            {project.assets.length} archivo(s) · carpeta del proyecto <code>media/</code>. Los
            originales no se modifican: se copian y se miden con FFprobe.
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="primary" onClick={() => void importMedia()} disabled={busy || !store.service.available}>
            {busy ? 'Importando…' : 'Importar medios…'}
          </button>
        </div>
      </div>

      <div className="import-bar">
        <label className="check">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <span>Confirmo que tengo derechos para usar y exportar estos archivos.</span>
        </label>
        <label className="field inline">
          <span>Licencia declarada</span>
          <select
            value={licenseMode}
            onChange={(event) => setLicenseMode(event.target.value as 'allowed' | 'requires-attribution')}
          >
            <option value="allowed">Uso comercial permitido</option>
            <option value="requires-attribution">Requiere atribución</option>
          </select>
        </label>
      </div>
      <p className="fine-print">
        El formato de proyecto rechaza materiales “ready” con licencia desconocida. El render
        también se detiene si un clip usa un material sin derechos declarados.
      </p>

      {warnings.length > 0 ? (
        <div className="notice notice-warning" role="status">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {project.assets.length === 0 ? (
        <p className="empty-state">
          No hay assets todavía. Importá un video, una imagen o un audio; cada archivo llega con
          hash, medición y licencia declarada por vos.
        </p>
      ) : (
        <div className="asset-grid">
          {project.assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} root={root} onUse={useAsset} />
          ))}
        </div>
      )}

      <div className="assets-foot">
        <p className="fine-print">
          Duración del proyecto: {framesToSeconds(store.durationFrames, fps).toFixed(1)} s ·{' '}
          {project.timeline.clips.length} clips en la timeline.
        </p>
        <button type="button" className="ghost" onClick={() => onNavigate('editor')}>
          Volver al editor
        </button>
      </div>
    </section>
  );
}
