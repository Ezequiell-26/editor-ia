import { useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  customEffectIds,
  effectRegistry,
  fidelityLabel,
  manifestFidelity,
  type EffectCategory,
  type EffectManifest,
  type EffectKind,
} from '@editor-ia/effect-kit';
import {
  importCustomEffectPackage,
  restoreCustomEffects,
} from '../../state/custom-effects';
import { ThumbnailBrowser, type ThumbnailItem } from '../../components/ThumbnailBrowser';
import '../../styles/thumbnail-browser.css';
import './effect-browser.css';

export interface EffectBrowserProps {
  readonly kind: EffectKind;
  readonly onAdd: (manifest: EffectManifest) => void;
  readonly disabled?: boolean;
}

/**
 * Navegador de efectos con thumbnails estilo Filmora.
 *
 * Lista el catálogo completo con búsqueda sin acentos y filtro por categoría.
 * Usa el componente universal ThumbnailBrowser para mostrar previews visuales.
 */
export function EffectBrowser({ kind, onAdd, disabled }: EffectBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EffectCategory | 'all'>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [customVersion, setCustomVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  // Restaura paquetes de terceros guardados antes de listar el catálogo
  // (idempotente: corre en cada render sin costo).
  restoreCustomEffects();

  const categories = useMemo(() => effectRegistry.categories(kind), [kind, customVersion]);
  
  const results = useMemo(() => {
    const pool = query.trim().length > 0
      ? effectRegistry.search(query, kind)
      : effectRegistry.byKind(kind);
    const filtered = category === 'all'
      ? pool
      : pool.filter((manifest) => manifest.category === category);
    return [...filtered].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  }, [kind, query, category, customVersion]);

  // Convertir manifests a ThumbnailItems
  const customIds = useMemo(() => new Set(customEffectIds()), [customVersion]);

  const thumbnailItems: ThumbnailItem[] = useMemo(() => {
    return results.map((manifest) => {
      const fidelity = manifestFidelity(manifest);
      const isCustom = customIds.has(manifest.id);
      return {
        id: manifest.id,
        name: manifest.name,
        ...(isCustom ? {} : { thumbnail: `/thumbnails/effects/${manifest.id}.svg` }),
        badge: isCustom ? 'Terceros' : fidelityLabel(fidelity),
        badgeVariant: isCustom ? 'new' : (fidelity as 'pro' | 'standard' | 'basic'),
        description: manifest.description,
      };
    });
  }, [results, customIds]);

  const handleItemClick = (item: ThumbnailItem) => {
    const manifest = results.find((m) => m.id === item.id);
    if (manifest) {
      onAdd(manifest);
    }
  };

  async function importFile(file: File): Promise<void> {
    const text = await file.text();
    const result = importCustomEffectPackage(text);
    if (result.ok) {
      setNotice(`Efecto «${result.name}» importado como ${result.id ?? ''}.`);
      setCustomVersion((v) => v + 1);
    } else {
      setNotice(`No se pudo importar: ${result.error ?? 'error desconocido'}`);
    }
  }


  return (
    <section className="effect-browser" aria-label="Catálogo de efectos">
      <header className="effect-browser-head">
        <input
          type="search"
          value={query}
          placeholder="Buscar efecto, categoría o palabra clave"
          aria-label="Buscar efecto"
          onChange={(event) => setQuery(event.target.value)}
          className="effect-search-input"
        />
        <span className="effect-browser-count">{results.length}</span>
        <button
          type="button"
          className="chip"
          disabled={disabled}
          title="Importar un paquete de efecto (.json / .driftfx manifest)"
          onClick={() => fileInput.current?.click()}
        >
          Importar
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </header>
      {notice ? <p className="effect-browser-notice">{notice}</p> : null}
      
      <div className="effect-browser-chips" role="tablist" aria-label="Categorías">
        <button
          type="button"
          role="tab"
          aria-selected={category === 'all'}
          className={`chip${category === 'all' ? ' on' : ''}`}
          onClick={() => setCategory('all')}
        >
          Todos
        </button>
        {categories.map((entry) => (
          <button
            key={entry.category}
            type="button"
            role="tab"
            aria-selected={category === entry.category}
            className={`chip${category === entry.category ? ' on' : ''}`}
            onClick={() => setCategory(entry.category)}
          >
            {CATEGORY_LABELS[entry.category] ?? entry.label}
            <span>{entry.count}</span>
          </button>
        ))}
      </div>

      <ThumbnailBrowser
        items={thumbnailItems}
        onSelect={handleItemClick}
        emptyMessage={query.trim() ? `Ningún efecto coincide con "${query}".` : 'No hay efectos disponibles.'}
        searchPlaceholder="Buscar efecto, categoría o palabra clave"
      />
    </section>
  );
}
