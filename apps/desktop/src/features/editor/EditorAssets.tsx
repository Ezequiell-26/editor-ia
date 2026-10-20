import { useMemo, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon, type IconName } from '../../components/Icon';
import { useThumbnail } from '../../hooks/useThumbnail';
import { friendlyAssetLabel } from '../../state/asset-labels';
import { addClipFromAsset, addTitleFromTemplate, fpsOf } from '../../state/project-actions';
import { TITLE_TEMPLATES, type TitleTemplate } from '../../state/title-templates';
import { useProjectStore } from '../../state/project-store';

type AssetFilter = 'all' | 'video' | 'image' | 'audio';

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

function kindIcon(kind: Asset['kind']): IconName {
  switch (kind) {
    case 'video':
      return 'film';
    case 'image':
      return 'assets';
    case 'audio':
      return 'audio';
    default:
      return 'script';
  }
}

function durationLabel(asset: Asset, fps: number): string | null {
  const media = 'media' in asset ? asset.media : undefined;
  const frames = media && 'durationFrames' in media ? media.durationFrames : 0;
  if (frames <= 0) return null;
  const seconds = frames / Math.max(1, fps);
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }
  return `${seconds.toFixed(1)} s`;
}

function RailAsset({
  asset,
  fps,
  onMount,
}: {
  readonly asset: Asset;
  readonly fps: number;
  readonly onMount: (asset: Asset, narration: boolean) => void;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const thumbnail = useThumbnail(store.service, asset, root || null);
  const canMount =
    asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio');
  const label = friendlyAssetLabel(asset.label);
  const duration = durationLabel(asset, fps);
  const status = asset.status === 'ready' ? 'listo' : asset.status;
  const inUse = store.state.project?.timeline.clips.some(
    (clip) => clip.source.type === 'asset' && clip.source.assetId === asset.id,
  );

  return (
    <div className="rail-asset">
      <div className={`rail-thumb kind-${asset.kind}`}>
        {thumbnail ? (
          <img src={thumbnail} alt="" draggable={false} />
        ) : (
          <span className="rail-thumb-fallback">
            <Icon name={kindIcon(asset.kind)} size={16} />
          </span>
        )}
        <span className="rail-thumb-kind" aria-hidden="true">
          <Icon name={kindIcon(asset.kind)} size={9} />
        </span>
        {duration ? <span className="rail-thumb-time">{duration}</span> : null}
      </div>
      <div className="rail-info">
        <strong title={asset.label}>
          {label}
          {inUse ? (
            <span
              className="rail-in-use-dot"
              title="En la timeline"
              aria-label="En la timeline"
            />
          ) : null}
        </strong>
        <span>
          {kindLabel(asset.kind)} · {status}
        </span>
        <div className="rail-actions">
          <button
            type="button"
            className="small"
            disabled={!canMount}
            onClick={() => onMount(asset, false)}
            aria-label={`Montar ${label} en el playhead`}
            title={canMount ? 'Montar en el playhead' : 'Confirmá los derechos en Medios'}
          >
            Montar
          </button>
          {asset.kind === 'audio' ? (
            <button
              type="button"
              className="small ghost"
              disabled={!canMount}
              onClick={() => onMount(asset, true)}
              aria-label={`Montar ${label} como narración`}
              title="Montar como narración"
            >
              Voz
            </button>
          ) : null}
          <button
            type="button"
            className="small ghost"
            onClick={() => store.setSelection({ kind: 'asset', id: asset.id })}
            aria-label={`Ver detalles de ${label}`}
            title="Ver licencia, procedencia y proxy de este material"
          >
            Detalles
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditorAssets({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'media' | 'titles'>('media');
  const [titleText, setTitleText] = useState('Tu título aquí');
  const fps = project ? fpsOf(project) : 30;

  const counts = useMemo(() => {
    const assets = project?.assets ?? [];
    return {
      all: assets.length,
      video: assets.filter((asset) => asset.kind === 'video').length,
      image: assets.filter((asset) => asset.kind === 'image').length,
      audio: assets.filter((asset) => asset.kind === 'audio').length,
    };
  }, [project]);

  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es');
    return (project?.assets ?? []).filter((asset) => {
      if (filter !== 'all' && asset.kind !== filter) return false;
      if (!needle) return true;
      return (
        asset.label.toLocaleLowerCase('es').includes(needle) ||
        friendlyAssetLabel(asset.label).toLocaleLowerCase('es').includes(needle)
      );
    });
  }, [filter, project, query]);

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
      store.setNotice(
        `${friendlyAssetLabel(asset.label)} montado en la pista ${narration ? 'de narración' : 'correspondiente'}.`,
      );
    }
  }

  function addTitle(template: TitleTemplate): void {
    const text = titleText.trim() || template.sample;
    const result = store.mutate((current) =>
      addTitleFromTemplate(current, {
        text,
        startFrame: store.state.playheadFrame,
        durationFrames: Math.round(3 * fps),
        template,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'cue', id: result.cueId });
      store.setNotice(`${template.name}: título agregado en el playhead.`);
    }
  }

  function templatePreview(template: TitleTemplate) {
    const style = template.style;
    return {
      fontFamily: `"${style.fontFamily}", sans-serif`,
      fontWeight: style.bold ? 800 : 500,
      fontStyle: style.italic ? 'italic' : 'normal',
      color: style.color,
      ...(style.backgroundColor ? { background: style.backgroundColor } : {}),
      WebkitTextStroke:
        style.borderStyle === 'box' ? undefined : `1px ${style.outlineColor}`,
      textShadow: style.shadow ? '0 3px 10px rgba(0, 0, 0, 0.55)' : undefined,
    };
  }

  const filters: ReadonlyArray<{ id: AssetFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todo', count: counts.all },
    { id: 'video', label: 'Video', count: counts.video },
    { id: 'image', label: 'Imagen', count: counts.image },
    { id: 'audio', label: 'Audio', count: counts.audio },
  ];

  return (
    <aside className="asset-rail" aria-label="Biblioteca del editor">
      <div className="rail-head">
        <div>
          <p className="eyebrow">{view === 'media' ? 'Medios' : 'Títulos'}</p>
          <strong>{view === 'media' ? project.assets.length : TITLE_TEMPLATES.length}</strong>
        </div>
        {view === 'media' ? (
          <button type="button" className="small icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="plus" size={12} />
            <span>Importar</span>
          </button>
        ) : (
          <button type="button" className="small ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="script" size={12} />
            <span>Guía</span>
          </button>
        )}
      </div>
      <div className="rail-tabs" role="tablist" aria-label="Biblioteca del editor">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'media'}
          className={view === 'media' ? 'active' : ''}
          onClick={() => setView('media')}
        >
          Medios
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'titles'}
          className={view === 'titles' ? 'active' : ''}
          onClick={() => setView('titles')}
        >
          Títulos
        </button>
      </div>
      {view === 'media' ? (
        <>
          <div className="rail-browser">
            <div className="rail-search">
              <Icon name="search" size={13} />
              <input
                type="search"
                value={query}
                placeholder="Buscar…"
                aria-label="Buscar medios"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  className="rail-search-clear"
                  aria-label="Limpiar búsqueda de medios"
                  onClick={() => setQuery('')}
                >
                  <Icon name="close" size={11} />
                </button>
              ) : null}
            </div>
            <select
              className="rail-filter"
              value={filter}
              aria-label="Filtrar medios por tipo"
              onChange={(event) => setFilter(event.target.value as AssetFilter)}
            >
              {filters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.count}
                </option>
              ))}
            </select>
          </div>
          <div className="rail-list">
            {visibleAssets.length === 0 ? (
              <p className="empty-inline">
                {project.assets.length === 0
                  ? 'No hay medios. Importá archivos locales y declarales derechos antes de montarlos.'
                  : 'Ningún medio coincide con el filtro o la búsqueda.'}
              </p>
            ) : (
              visibleAssets.map((asset) => (
                <RailAsset key={asset.id} asset={asset} fps={fps} onMount={mount} />
              ))
            )}
          </div>
          <button
            type="button"
            className="ghost small rail-foot"
            onClick={() => onNavigate('assets')}
          >
            Abrir biblioteca de medios
          </button>
        </>
      ) : (
        <div className="rail-titles">
          <label className="field rail-title-text">
            <span>Texto del título</span>
            <input
              type="text"
              value={titleText}
              maxLength={120}
              onChange={(event) => setTitleText(event.target.value)}
            />
          </label>
          <p className="fine-print">
            Se agrega en el playhead con su propio estilo. Después podés editarlo o moverlo en la
            timeline.
          </p>
          <div className="title-template-list">
            {TITLE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="title-template-card"
                onClick={() => addTitle(template)}
              >
                <span className="title-template-preview" style={templatePreview(template)}>
                  {template.sample}
                </span>
                <span className="title-template-info">
                  <strong>{template.name}</strong>
                  <em>{template.description}</em>
                </span>
                <span className="title-template-action">Agregar</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
