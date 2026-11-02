import { useMemo, useState } from 'react';
import {
  CATEGORY_LABELS,
  effectRegistry,
  fidelityLabel,
  manifestFidelity,
  type EffectCategory,
  type EffectManifest,
  type EffectKind,
} from '@editor-ia/effect-kit';

export interface EffectBrowserProps {
  readonly kind: EffectKind;
  readonly onAdd: (manifest: EffectManifest) => void;
  readonly disabled?: boolean;
}

/**
 * Navegador de efectos.
 *
 * Lista el catálogo completo con búsqueda sin acentos y filtro por categoría.
 * No conoce ningún efecto en particular: si mañana entra un paquete nuevo al
 * registro, aparece acá sin tocar el componente.
 */
export function EffectBrowser({ kind, onAdd, disabled }: EffectBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EffectCategory | 'all'>('all');

  const categories = useMemo(() => effectRegistry.categories(kind), [kind]);
  const results = useMemo(() => {
    const pool = query.trim().length > 0
      ? effectRegistry.search(query, kind)
      : effectRegistry.byKind(kind);
    const filtered = category === 'all'
      ? pool
      : pool.filter((manifest) => manifest.category === category);
    return [...filtered].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  }, [kind, query, category]);

  return (
    <section className="effect-browser" aria-label="Catálogo de efectos">
      <header className="effect-browser-head">
        <input
          type="search"
          value={query}
          placeholder="Buscar efecto, categoría o palabra clave"
          aria-label="Buscar efecto"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="effect-browser-count">{results.length}</span>
      </header>
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
      <ul className="effect-browser-list">
        {results.map((manifest) => {
          const fidelity = manifestFidelity(manifest);
          return (
            <li key={manifest.id}>
              <button
                type="button"
                className="effect-card"
                disabled={disabled}
                title={manifest.description}
                onClick={() => onAdd(manifest)}
              >
                <span className="effect-card-name">{manifest.name}</span>
                <span className={`effect-card-badge ${fidelity}`}>{fidelityLabel(fidelity)}</span>
                <span className="effect-card-desc">{manifest.description}</span>
              </button>
            </li>
          );
        })}
        {results.length === 0 ? (
          <li className="effect-browser-empty">Ningún efecto coincide con “{query}”.</li>
        ) : null}
      </ul>
    </section>
  );
}
