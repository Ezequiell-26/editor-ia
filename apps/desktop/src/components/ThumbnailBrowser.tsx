import { useState } from 'react';
import { Icon } from './Icon';

export interface ThumbnailItem {
  readonly id: string;
  readonly name: string;
  readonly thumbnail?: string; // URL de la imagen preview
  readonly icon?: string; // Icono de respaldo si no hay thumbnail
  readonly category?: string;
  readonly duration?: number; // Para transiciones/efectos
  readonly badge?: string; // Texto para badge (ej: "PRO", "4K", etc)
  readonly badgeVariant?: 'pro' | 'standard' | 'basic' | 'new'; // Estilo del badge
  readonly description?: string; // Descripción para tooltip
}

interface ThumbnailBrowserProps {
  readonly items: ThumbnailItem[];
  readonly onSelect: (item: ThumbnailItem) => void;
  readonly onDoubleClick?: (item: ThumbnailItem) => void;
  readonly selectedId?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly categories?: string[];
}

/**
 * Navegador universal de thumbnails para cualquier tipo de contenido.
 * Usado para: transiciones, efectos, títulos, elementos, etc.
 */
export function ThumbnailBrowser({
  items,
  onSelect,
  onDoubleClick,
  selectedId,
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'No hay elementos disponibles',
  categories = [],
}: ThumbnailBrowserProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = items.filter((item) => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !activeCategory || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="thumbnail-browser">
      {/* Barra de búsqueda */}
      <div className="thumbnail-browser-header">
        <div className="thumbnail-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      </div>

      {/* Categorías */}
      {categories.length > 0 && (
        <div className="thumbnail-categories">
          <button
            type="button"
            className={`category-btn ${!activeCategory ? 'active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`category-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Grid de thumbnails */}
      <div className="thumbnail-grid">
        {filtered.length === 0 ? (
          <div className="thumbnail-empty">
            <Icon name="assets" size={32} />
            <p>{emptyMessage}</p>
          </div>
        ) : (
          filtered.map((item) => (
            <ThumbnailCard
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onClick={() => onSelect(item)}
              onDoubleClick={() => onDoubleClick?.(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ThumbnailCardProps {
  readonly item: ThumbnailItem;
  readonly isSelected: boolean;
  readonly onClick: () => void;
  readonly onDoubleClick?: () => void;
}

function ThumbnailCard({ item, isSelected, onClick, onDoubleClick }: ThumbnailCardProps) {
  return (
    <div
      className={`thumbnail-card ${isSelected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={item.name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      title={item.description || item.name}
    >
      <div className="thumbnail-preview">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} loading="lazy" />
        ) : (
          <div className="thumbnail-placeholder">
            <Icon name={item.icon as any || 'assets'} size={28} />
          </div>
        )}
        {item.duration !== undefined && (
          <span className="thumbnail-duration">{item.duration}s</span>
        )}
        {item.badge && (
          <span className={`thumbnail-badge ${item.badgeVariant || 'standard'}`}>
            {item.badge}
          </span>
        )}
      </div>
      <div className="thumbnail-info">
        <span className="thumbnail-name">{item.name}</span>
      </div>
    </div>
  );
}
