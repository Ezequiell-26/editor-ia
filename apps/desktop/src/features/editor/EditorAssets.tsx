import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { useThumbnail } from '../../hooks/useThumbnail';
import { addClipFromAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

function RailAsset({
  asset,
  onMount,
}: {
  readonly asset: Asset;
  readonly onMount: (asset: Asset, narration: boolean) => void;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const thumbnail = useThumbnail(store.service, asset, root || null);
  const canMount = asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio');
  return (
    <div className="rail-asset">
      <div className="rail-thumb">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span>{asset.kind.slice(0, 3)}</span>}
      </div>
      <div className="rail-info">
        <strong title={asset.label}>{asset.label}</strong>
        <span>
          {asset.kind} · {asset.status}
        </span>
        <div className="rail-actions">
          <button
            type="button"
            className="small"
            disabled={!canMount}
            onClick={() => onMount(asset, false)}
            title={canMount ? 'Montar en el playhead' : 'Confirmá los derechos en Medios'}
          >
            Montar
          </button>
          {asset.kind === 'audio' ? (
            <button type="button" className="small ghost" disabled={!canMount} onClick={() => onMount(asset, true)}>
              Voz
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EditorAssets({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  if (!project) return null;

  function mount(asset: Asset, narration: boolean): void {
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: store.state.playheadFrame,
        narration,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice(`${asset.label} montado en la pista ${narration ? 'de narración' : 'correspondiente'}.`);
    }
  }

  return (
    <aside className="asset-rail" aria-label="Medios del proyecto">
      <div className="rail-head">
        <div>
          <p className="eyebrow">Medios</p>
          <strong>{project.assets.length}</strong>
        </div>
        <button type="button" className="small" onClick={() => onNavigate('assets')}>
          Importar
        </button>
      </div>
      <div className="rail-list">
        {project.assets.length === 0 ? (
          <p className="empty-inline">
            No hay medios. Importá archivos locales y declarales derechos antes de montarlos.
          </p>
        ) : (
          project.assets.map((asset) => <RailAsset key={asset.id} asset={asset} onMount={mount} />)
        )}
      </div>
      <button type="button" className="ghost small rail-foot" onClick={() => onNavigate('assets')}>
        Abrir biblioteca de medios
      </button>
    </aside>
  );
}
