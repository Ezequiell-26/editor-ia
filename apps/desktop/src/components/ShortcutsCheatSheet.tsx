import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ViewId } from '../app/navigation';
import { workspaceGroupFor } from '../app/workspace-map';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  SHORTCUT_LABELS,
  SHORTCUTS_CHANGED_EVENT,
  loadShortcuts,
  type ShortcutId,
  type ShortcutMap,
} from '../state/shortcuts';

export type ShortcutCategoryFilter =
  | 'all'
  | 'playback'
  | 'timeline'
  | 'edit'
  | 'nav'
  | 'file'
  | 'gestures';

interface ExtraShortcutItem {
  readonly id: string;
  readonly label: string;
  readonly keys: string;
  readonly category: string;
  readonly categoryKey: ShortcutCategoryFilter;
  readonly hint?: string;
  /**
   * Sólo para atajos `nav.*`: etiqueta del grupo del workspace-map al que
   * pertenece la vista («Preparar», «Editar», …). La sección se muestra como
   * «Navegación · <grupo>» para no colisionar con la categoría «Editar».
   */
  readonly workspaceGroup?: string;
}

const GESTURE_SHORTCUTS: readonly ExtraShortcutItem[] = [
  {
    id: 'gesture.timelineZoomWheel',
    label: 'Zoom continuo en la línea de tiempo',
    keys: 'Ctrl+Rueda',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Acercar o alejar centrado en el puntero',
  },
  {
    id: 'gesture.timelineScrollH',
    label: 'Desplazamiento horizontal',
    keys: 'Shift+Rueda',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Mover la vista a lo largo de la secuencia',
  },
  {
    id: 'gesture.handTool',
    label: 'Herramienta Mano (Pan)',
    keys: 'H',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Arrastrar para encuadrar la timeline libremente',
  },
  {
    id: 'gesture.scrubPlayhead',
    label: 'Scrubbing en regla de tiempo',
    keys: 'Clic+Arrastre',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Mover el cabezal de reproducción en tiempo real',
  },
  {
    id: 'gesture.clipDrag',
    label: 'Mover clip con imán magnético',
    keys: 'Arrastrar Clip',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Ajuste magnético automático en cortes contiguos',
  },
  {
    id: 'gesture.fullscreen',
    label: 'Pantalla completa',
    keys: 'F11',
    category: 'Ratón y Gestos',
    categoryKey: 'gestures',
    hint: 'Maximizar espacio de trabajo de edición',
  },
];

/** Categorías con iconos SVG del sistema, sin glifos emoji. */
const CATEGORY_TABS: readonly {
  readonly id: ShortcutCategoryFilter;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { id: 'all', label: 'Todos', icon: 'grid' },
  { id: 'playback', label: 'Reproducción', icon: 'play' },
  { id: 'timeline', label: 'Línea de Tiempo', icon: 'film' },
  { id: 'edit', label: 'Edición', icon: 'split' },
  { id: 'nav', label: 'Navegación', icon: 'fit' },
  { id: 'file', label: 'Archivo', icon: 'save' },
  { id: 'gestures', label: 'Ratón y Gestos', icon: 'hand' },
];

function mapCategoryKey(rawCategory: string): ShortcutCategoryFilter {
  switch (rawCategory.toLowerCase()) {
    case 'reproducción':
      return 'playback';
    case 'timeline':
      return 'timeline';
    case 'editar':
      return 'edit';
    case 'navegación':
      return 'nav';
    case 'archivo':
      return 'file';
    default:
      return 'all';
  }
}

/** Formatea una tecla o combinación en elementos kbd separados */
function renderKeys(binding: string) {
  // Manejo de casos especiales como tecla '+'
  if (binding.trim() === '+') {
    return (
      <div className="shortcut-key-badges">
        <kbd>+</kbd>
      </div>
    );
  }

  const parts = binding
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="shortcut-key-badges">
      {parts.map((part, index) => {
        let display = part;
        if (part === 'Space') display = 'Espacio';
        else if (part === 'ArrowLeft') display = '←';
        else if (part === 'ArrowRight') display = '→';
        else if (part === 'ArrowUp') display = '↑';
        else if (part === 'ArrowDown') display = '↓';
        else if (part === 'Delete') display = 'Supr';

        return (
          <span key={`${part}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {index > 0 && <span className="shortcut-key-separator">+</span>}
            <kbd>{display}</kbd>
          </span>
        );
      })}
    </div>
  );
}

export interface ShortcutsCheatSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenSettings?: () => void;
}

export function ShortcutsCheatSheet({ open, onClose, onOpenSettings }: ShortcutsCheatSheetProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ShortcutCategoryFilter>('all');
  const [shortcutsMap, setShortcutsMap] = useState<ShortcutMap>(() => loadShortcuts());

  // Escuchar cambios de atajos en tiempo real
  useEffect(() => {
    const handleChanged = () => {
      setShortcutsMap(loadShortcuts());
    };
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(SHORTCUTS_CHANGED_EVENT, handleChanged);
  }, []);

  // Foco accesible y trampa de Escape
  useDialogFocus({
    containerRef: dialogRef,
    active: open,
    onClose,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [open]);

  // Lista unificada de todos los atajos
  const allItems = useMemo(() => {
    const regularItems: ExtraShortcutItem[] = (Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]).map((id) => {
      const binding = shortcutsMap[id] || DEFAULT_SHORTCUTS[id];
      const label = SHORTCUT_LABELS[id] || id;
      const rawCategory = SHORTCUT_CATEGORIES[id] || 'General';
      const categoryKey = mapCategoryKey(rawCategory);
      // Los atajos nav.* apuntan a un ViewId: su sección sigue el grupo del
      // mapa único del estudio, igual que la paleta de comandos.
      const workspaceGroup = id.startsWith('nav.')
        ? workspaceGroupFor(id.slice('nav.'.length) as ViewId)?.label
        : undefined;

      return {
        id,
        label,
        keys: binding,
        category: rawCategory,
        categoryKey,
        ...(workspaceGroup ? { workspaceGroup } : {}),
      };
    });

    return [...regularItems, ...GESTURE_SHORTCUTS];
  }, [shortcutsMap]);

  // Filtrado por texto y categoría
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();

    return allItems.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryKey !== selectedCategory) {
        return false;
      }

      if (!normalizedQuery) return true;

      return (
        item.label.toLowerCase().includes(normalizedQuery) ||
        item.keys.toLowerCase().includes(normalizedQuery) ||
        item.category.toLowerCase().includes(normalizedQuery) ||
        (item.hint && item.hint.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [allItems, selectedCategory, query]);

  // Conteo de atajos por categoría para los botones de pestañas
  const categoryCounts = useMemo(() => {
    const counts: Record<ShortcutCategoryFilter, number> = {
      all: allItems.length,
      playback: 0,
      timeline: 0,
      edit: 0,
      nav: 0,
      file: 0,
      gestures: GESTURE_SHORTCUTS.length,
    };

    for (const item of allItems) {
      if (item.categoryKey in counts && item.categoryKey !== 'all') {
        counts[item.categoryKey] += 1;
      }
    }
    return counts;
  }, [allItems]);

  // Agrupar items filtrados por categoría para mostrar secciones legibles.
  // Los atajos de navegación se subdividen por el grupo del workspace-map.
  const groupedItems = useMemo(() => {
    const groups = new Map<string, typeof filteredItems>();
    for (const item of filteredItems) {
      const groupName = item.workspaceGroup
        ? `${item.category} · ${item.workspaceGroup}`
        : item.category;
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(item);
    }
    return Array.from(groups.entries());
  }, [filteredItems]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-sheet-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="shortcuts-sheet-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="shortcuts-sheet-header">
          <div className="shortcuts-sheet-title-group">
            <div className="shortcuts-sheet-icon" aria-hidden="true">
              <Icon name="keyboard" size={22} />
            </div>
            <div>
              <h2 id="shortcuts-title" className="shortcuts-sheet-title">
                Atajos de Teclado & Controles
              </h2>
              <p className="shortcuts-sheet-subtitle">
                Referencia rápida de teclas de acceso rápido para acelerar tu edición en Olyvia
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar ventana de atajos (Esc)"
            data-tooltip="Cerrar (Esc)"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="shortcuts-sheet-controls">
          <div className="shortcuts-search-wrap">
            <span className="shortcuts-search-icon" aria-hidden="true">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="shortcuts-search-input"
              placeholder="Buscar atajo, acción o tecla (ej: split, zoom, guardar, Espacio, Ctrl)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar atajos de teclado"
            />
            {query ? (
              <button
                type="button"
                className="shortcuts-search-clear"
                onClick={() => setQuery('')}
                aria-label="Limpiar búsqueda"
              >
                <Icon name="close" size={13} />
              </button>
            ) : null}
          </div>

          <div className="shortcuts-category-tabs" role="tablist" aria-label="Categorías de atajos">
            {CATEGORY_TABS.map((tab) => {
              const active = selectedCategory === tab.id;
              const count = categoryCounts[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`shortcuts-tab-btn${active ? ' active' : ''}`}
                  onClick={() => setSelectedCategory(tab.id)}
                >
                  <Icon name={tab.icon} size={13} />
                  <span>{tab.label}</span>
                  <span className="shortcuts-tab-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shortcuts-sheet-body">
          {filteredItems.length === 0 ? (
            <div className="shortcuts-sheet-empty">
              <Icon name="alert" size={28} />
              <p>No se encontraron atajos que coincidan con &ldquo;{query}&rdquo;.</p>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setQuery('');
                  setSelectedCategory('all');
                }}
              >
                Restablecer filtros
              </button>
            </div>
          ) : (
            groupedItems.map(([groupName, items]) => (
              <div key={groupName} className="shortcuts-group">
                <div className="shortcuts-group-title">
                  <span>{groupName}</span>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                    ({items.length})
                  </span>
                </div>
                <div className="shortcuts-list-grid">
                  {items.map((item) => (
                    <div key={item.id} className="shortcut-card">
                      <div className="shortcut-card-info">
                        <span className="shortcut-card-label" title={item.label}>
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="shortcut-card-detail" title={item.hint}>
                            {item.hint}
                          </span>
                        )}
                      </div>
                      {renderKeys(item.keys)}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="shortcuts-sheet-footer">
          <div className="shortcuts-footer-hint">
            <span>Abrir en cualquier momento con</span>
            <kbd>?</kbd>
            <span>o</span>
            <kbd>Shift + /</kbd>
          </div>
          <div className="shortcuts-footer-actions">
            {onOpenSettings && (
              <button
                type="button"
                className="ghost icon-text"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              >
                <Icon name="settings" size={14} />
                <span>Personalizar en Ajustes</span>
              </button>
            )}
            <button type="button" className="primary" onClick={onClose}>
              Entendido
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
