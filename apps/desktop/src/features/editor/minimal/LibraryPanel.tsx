import { useEffect, useState, type ReactNode } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import { Icon } from '../../../components/Icon';
import { useThumbnail } from '../../../hooks/useThumbnail';
import { useProjectStore } from '../../../state/project-store';
import {
  MEDIA_ITEMS, STUDIO_ITEMS, SUBTITLE_STYLES, TABS,
  type Scene,
} from './model';

export interface LibraryPanelProps {
  readonly scene: Scene;
  readonly activeTab: string;
  readonly onTab: (id: string) => void;
  readonly onImport: () => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly subtitleStyle: number;
  readonly onSubtitleStyle: (index: number) => void;
  readonly onGenerate: () => void;
  /** Dispara una acción real del editor (navegación, diálogo, store). */
  readonly onAction?: ((label: string) => void) | undefined;
  /** Agrega el material real a la timeline. */
  readonly onAddToTimeline?: ((assetId: string) => void) | undefined;
}

/** Tarjeta de un material REAL del proyecto, con miniatura del servicio. */
function RealAssetCard({ asset, selected, onSelect, onAdd }: {
  readonly asset: Asset;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onAdd: () => void;
}): ReactNode {
  const { state, service } = useProjectStore();
  const thumbnail = useThumbnail(service, asset, state.opened?.root ?? null);
  const kindIcon = asset.kind === 'audio' ? 'audio'
    : asset.kind === 'image' ? 'grid' : 'film';

  return (
    <button
      type="button"
      className={`me-media-item${selected ? ' selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={onAdd}
      title={`${asset.label} · doble clic para agregar a la timeline`}
    >
      <span className="me-media-thumb">
        {thumbnail
          ? <img src={thumbnail} alt="" draggable={false} />
          : <span className="me-media-placeholder"><Icon name={kindIcon} size={18} /></span>}
      </span>
      <span className="me-media-label">{asset.label}</span>
    </button>
  );
}

function MediaGrid({ items, selectedId, onSelect, studio = false }: {
  readonly items: typeof MEDIA_ITEMS;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly studio?: boolean;
}): ReactNode {
  return (
    <div className={`me-media-grid${studio ? ' me-media-grid-studio' : ''}`}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`me-media-item${selectedId === item.id ? ' selected' : ''}`}
          onClick={() => onSelect(item.id)}
          title={item.label}
        >
          <span className="me-media-thumb">
            <img src={item.thumb} alt="" draggable={false} />
            {item.duration ? <span className="me-media-duration">{item.duration}</span> : null}
            {studio && item.duration ? <span className="me-media-badges"><i>▣</i><i>✓</i></span> : null}
            {studio && !item.duration ? <span className="me-media-badges"><i>♧</i></span> : null}
          </span>
          <span className="me-media-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function SubtitleStyles({ active, onSelect }: {
  readonly active: number;
  readonly onSelect: (index: number) => void;
}): ReactNode {
  return (
    <div className="me-sub-panel">
      <p className="me-sub-intro">
        O sistema <strong>ouve o áudio da timeline</strong> (offline) e cria legendas com o tempo de cada
        <strong> palavra</strong>. Escolha o estilo:
      </p>
      <div className="me-sub-grid">
        {SUBTITLE_STYLES.map((style, index) => (
          <button
            key={`${style.name}-${index}`}
            type="button"
            className={`me-sub-cell s${index}${active === index ? ' selected' : ''}`}
            onClick={() => onSelect(index)}
          >
            <span className="me-sub-sample">{style.sample}</span>
            <span className="me-sub-name">{style.name} <em>{style.variant}</em></span>
          </button>
        ))}
      </div>
      <p className="me-sub-hint">
        Cor, fonte e tamanho: selecione a legenda na timeline e ajuste à direita.{' '}
        <strong>Botão direito</strong> no clipe → <strong>Efeito especial</strong> (misturar estilos na frase).
      </p>
    </div>
  );
}

export function LibraryPanel({
  scene, activeTab, onTab, onImport, selectedId, onSelect,
  subtitleStyle, onSubtitleStyle, onGenerate, onAction, onAddToTimeline,
}: LibraryPanelProps): ReactNode {
  const isStudio = scene === 'studio';
  const isCaptions = scene === 'captions';
  const { state } = useProjectStore();
  const assets = state.project?.assets ?? [];
  const [kindFilter, setKindFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all');
  const [compact, setCompact] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);

  // Las pestañas de categoría filtran los materiales REALES del proyecto.
  useEffect(() => {
    if (activeTab === 'audio') setKindFilter('audio');
    else if (activeTab === 'elementos') setKindFilter('image');
    else setKindFilter('all');
  }, [activeTab]);

  const visibleAssets = assets
    .filter((asset) => kindFilter === 'all' || asset.kind === kindFilter)
    .slice()
    .sort((a, b) => (sortAsc ? 1 : -1) * a.label.localeCompare(b.label, 'es'));
  const showRealAssets = !isStudio && !isCaptions && assets.length > 0;
  const filterLabel = kindFilter === 'all' ? 'Todos'
    : kindFilter === 'video' ? 'Vídeos'
      : kindFilter === 'audio' ? 'Áudio' : 'Imagens';

  const cycleFilter = (): void => {
    const order = ['all', 'video', 'audio', 'image'] as const;
    setKindFilter(order[(order.indexOf(kindFilter) + 1) % order.length] ?? 'all');
  };

  return (
    <section className="me-left" aria-label="Biblioteca de mídia">
      <div className="me-tabs" role="tablist" aria-label="Categorias">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`me-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => onTab(tab.id)}
          >
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="me-left-tools">
        <button type="button" className="me-import-btn" onClick={onImport}>
          <Icon name="plus" size={12} /> Importar
        </button>
        <button
          type="button"
          className="me-filter-btn"
          onClick={cycleFilter}
          aria-label={`Filtrar materiales: ${filterLabel}`}
          title="Cambiar filtro de materiales"
        >
          <Icon name="grid" size={12} /> {filterLabel}
        </button>
        <button
          type="button"
          className="me-filter-btn me-square"
          aria-label="Visualização compacta"
          aria-pressed={compact}
          title="Alternar vista compacta"
          onClick={() => setCompact((value) => !value)}
        ><Icon name="film" size={12} /></button>
        <button
          type="button"
          className="me-filter-btn me-square"
          aria-label="Ordenar"
          aria-pressed={sortAsc}
          title="Invertir orden por nombre"
          onClick={() => setSortAsc((value) => !value)}
        ><Icon name="chevron-down" size={12} /></button>
        {showRealAssets
          ? <span className="me-left-count">{visibleAssets.length} de {assets.length}</span>
          : scene === 'media' ? <span className="me-left-count">7 de 7 selecionadas</span> : null}
        {isStudio ? <span className="me-left-count">1 de 2 selecionada</span> : null}
        {isStudio ? <span className="me-thumb-size" aria-hidden="true"><i /></span> : null}
      </div>

      {isStudio ? (
        <div className="me-search"><Icon name="search" size={12} /><span>Pesquisar mídia</span></div>
      ) : null}

      {scene === 'empty' ? (
        <div className="me-empty">
          <div className="me-import-art" aria-hidden="true">
            <span className="me-import-arrow">↓</span>
            <span className="me-import-card">AC</span>
          </div>
          <strong>Importar</strong>
          <p>Arraste e solte vídeos, fotos e arquivos de<br />áudio aqui</p>
        </div>
      ) : null}

      {showRealAssets ? (
        <div className={`me-media-grid${compact ? ' me-media-grid-compact' : ''}`}>
          {visibleAssets.map((asset) => (
            <RealAssetCard
              key={asset.id}
              asset={asset}
              selected={selectedId === asset.id}
              onSelect={() => onSelect(asset.id)}
              onAdd={() => onAddToTimeline?.(asset.id)}
            />
          ))}
        </div>
      ) : scene === 'media' ? (
        <MediaGrid items={MEDIA_ITEMS} selectedId={selectedId} onSelect={onSelect} />
      ) : null}

      {isStudio ? (
        <MediaGrid items={STUDIO_ITEMS} selectedId={selectedId} onSelect={onSelect} studio />
      ) : null}

      {isCaptions ? (
        <SubtitleStyles active={subtitleStyle} onSelect={onSubtitleStyle} />
      ) : null}

      <div className="me-left-foot">
        {scene === 'empty' ? (
          <p className="me-left-hint">Ainda não tem mídia? Crie agora com estas ferramentas</p>
        ) : null}
        {isCaptions ? (
          <button type="button" className="me-generate" onClick={onGenerate}>
            <Icon name="sparkles" size={12} /> Gerar legendas
          </button>
        ) : null}
        {!isCaptions ? (
          <div className="me-left-cards">
            <button type="button" onClick={() => onAction?.(isStudio ? 'Gravar Mídias' : 'Gravar tela / webcam')}>
              <span className="me-card-icon red"><Icon name="camera" size={13} /></span>
              {isStudio ? 'Gravar Mídias' : 'Gravar tela / webcam'}
              {isStudio ? <span className="me-beta">⚠ BETA</span> : null}
            </button>
            <button type="button" onClick={() => onAction?.('Mão Mágica')}>
              <span className="me-card-icon"><Icon name="pencil" size={13} /></span> Mão Mágica
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
