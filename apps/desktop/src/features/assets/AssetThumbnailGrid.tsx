import type { Asset } from '@editor-ia/project-schema';
import { useThumbnail } from '../../hooks/useThumbnail';
import { useProjectStore } from '../../state/project-store';
import { Icon } from '../../components/Icon';

interface AssetThumbnailGridProps {
  readonly assets: Asset[];
  readonly root: string;
  readonly onAssetClick: (asset: Asset) => void;
  readonly onAssetDoubleClick: (asset: Asset) => void;
  readonly selectedAssetId: string | null;
  readonly viewMode: 'grid' | 'list';
}

/**
 * Grid de thumbnails de assets como en Filmora.
 * Muestra previews visuales de imágenes y videos.
 */
export function AssetThumbnailGrid({
  assets,
  root,
  onAssetClick,
  onAssetDoubleClick,
  selectedAssetId,
  viewMode,
}: AssetThumbnailGridProps) {
  if (assets.length === 0) {
    return (
      <div className="asset-grid-empty">
        <Icon name="assets" size={48} />
        <p>No hay medios en esta carpeta</p>
        <p className="fine-print">Importá archivos o cambiá de carpeta</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="asset-list-view">
        {assets.map((asset) => (
          <AssetListItem
            key={asset.id}
            asset={asset}
            root={root}
            isSelected={selectedAssetId === asset.id}
            onClick={() => onAssetClick(asset)}
            onDoubleClick={() => onAssetDoubleClick(asset)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="asset-thumbnail-grid">
      {assets.map((asset) => (
        <AssetThumbnailCard
          key={asset.id}
          asset={asset}
          root={root}
          isSelected={selectedAssetId === asset.id}
          onClick={() => onAssetClick(asset)}
          onDoubleClick={() => onAssetDoubleClick(asset)}
        />
      ))}
    </div>
  );
}

interface AssetThumbnailCardProps {
  readonly asset: Asset;
  readonly root: string;
  readonly isSelected: boolean;
  readonly onClick: () => void;
  readonly onDoubleClick: () => void;
}

function AssetThumbnailCard({
  asset,
  root,
  isSelected,
  onClick,
  onDoubleClick,
}: AssetThumbnailCardProps) {
  const store = useProjectStore();
  const thumbnail = useThumbnail(store.service, asset, root);

  const getDuration = () => {
    if (asset.kind === 'video' && asset.media) {
      const fps = 30; // TODO: Get from project
      const seconds = asset.media.durationFrames / fps;
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return null;
  };

  const duration = getDuration();

  return (
    <div
      className={`asset-thumbnail-card ${isSelected ? 'selected' : ''} ${asset.status !== 'ready' ? 'unready' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={asset.label}
    >
      <div className="asset-thumbnail-preview">
        {thumbnail ? (
          <img src={thumbnail} alt={asset.label} loading="lazy" />
        ) : (
          <div className="asset-thumbnail-placeholder">
            <Icon name={getAssetIcon(asset.kind)} size={32} />
          </div>
        )}
        {duration && <span className="asset-duration-badge">{duration}</span>}
        {asset.kind === 'video' && <Icon name="play" size={16} className="asset-play-icon" />}
        {asset.favorite && (
          <Icon name="star" size={14} className="asset-favorite-icon" />
        )}
      </div>
      <div className="asset-thumbnail-info">
        <span className="asset-thumbnail-name" title={asset.label}>
          {asset.label}
        </span>
        {'media' in asset && asset.media && (
          <span className="asset-thumbnail-meta">
            {getResolution(asset)}
          </span>
        )}
      </div>
    </div>
  );
}

interface AssetListItemProps {
  readonly asset: Asset;
  readonly root: string;
  readonly isSelected: boolean;
  readonly onClick: () => void;
  readonly onDoubleClick: () => void;
}

function AssetListItem({
  asset,
  root,
  isSelected,
  onClick,
  onDoubleClick,
}: AssetListItemProps) {
  const store = useProjectStore();
  const thumbnail = useThumbnail(store.service, asset, root);

  return (
    <div
      className={`asset-list-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="asset-list-thumbnail">
        {thumbnail ? (
          <img src={thumbnail} alt={asset.label} loading="lazy" />
        ) : (
          <Icon name={getAssetIcon(asset.kind)} size={20} />
        )}
      </div>
      <div className="asset-list-info">
        <span className="asset-list-name">{asset.label}</span>
        <span className="asset-list-meta">
          {getAssetTypeLabel(asset.kind)} · {getResolution(asset)}
        </span>
      </div>
      {asset.favorite && <Icon name="star" size={14} className="asset-list-favorite" />}
    </div>
  );
}

function getAssetIcon(kind: Asset['kind']): 'film' | 'audio' | 'assets' | 'text' {
  switch (kind) {
    case 'video':
      return 'film';
    case 'audio':
      return 'audio';
    case 'image':
      return 'assets';
    case 'font':
      return 'text';
    case 'text':
      return 'text';
    default:
      return 'assets';
  }
}

function getAssetTypeLabel(kind: Asset['kind']): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'image':
      return 'Imagen';
    case 'font':
      return 'Fuente';
    case 'text':
      return 'Texto';
    default:
      return 'Archivo';
  }
}

function getResolution(asset: Asset): string {
  if (asset.kind === 'video' && 'media' in asset && asset.media) {
    return `${asset.media.width}×${asset.media.height}`;
  }
  if (asset.kind === 'image' && 'media' in asset && asset.media) {
    return `${asset.media.width}×${asset.media.height}`;
  }
  if (asset.kind === 'audio' && 'media' in asset && asset.media) {
    const seconds = asset.media.durationFrames / 30; // TODO: Get fps from project
    return `${Math.floor(seconds)}s`;
  }
  return '';
}
