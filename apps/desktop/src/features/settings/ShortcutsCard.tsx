import { useEffect, useMemo, useState } from 'react';
import { foldText } from '../../app/commands';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  SHORTCUT_LABELS,
  eventToBinding,
  isBindable,
  loadShortcuts,
  normalizeBinding,
  resetShortcuts,
  saveShortcuts,
  type ShortcutId,
  type ShortcutMap,
} from '../../state/shortcuts';

const CATEGORY_ORDER = ['General', 'Navegación', 'Archivo', 'Editar', 'Reproducción'] as const;

const ALL_IDS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[];

function includes(query: string, text: string): boolean {
  return foldText(text).includes(foldText(query));
}

export function ShortcutsCard() {
  const [map, setMap] = useState<ShortcutMap>(loadShortcuts);
  const [listening, setListening] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Mientras se escucha una combinación nueva, capturamos el teclado en fase
  // de captura para que ningún otro handler (paleta, editor) reaccione.
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      // Los modificadores solos no son un binding: esperar la tecla real.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListening(null);
        setError(null);
        return;
      }
      const binding = eventToBinding(event);
      if (!isBindable(binding)) {
        setError('Usá Ctrl o Alt, o una tecla especial (F1-F12, Espacio…).');
        return;
      }
      const conflict = (Object.entries(map) as [ShortcutId, string][]).find(
        ([id, value]) =>
          id !== listening && normalizeBinding(value) === normalizeBinding(binding),
      );
      if (conflict) {
        setError(`"${binding}" ya lo usa "${SHORTCUT_LABELS[conflict[0]]}".`);
        return;
      }
      const next: ShortcutMap = { ...map, [listening]: normalizeBinding(binding) };
      setMap(next);
      saveShortcuts(next);
      setListening(null);
      setError(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, map]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return ALL_IDS;
    return ALL_IDS.filter(
      (id) =>
        includes(q, SHORTCUT_LABELS[id]) ||
        includes(q, SHORTCUT_CATEGORIES[id]) ||
        includes(q, map[id]),
    );
  }, [query, map]);

  const byCategory = useMemo(() => {
    const grouped = new Map<string, ShortcutId[]>();
    for (const id of filtered) {
      const category = SHORTCUT_CATEGORIES[id];
      const list = grouped.get(category) ?? [];
      list.push(id);
      grouped.set(category, list);
    }
    return [...grouped.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0] as 'General') - CATEGORY_ORDER.indexOf(b[0] as 'General'),
    );
  }, [filtered]);

  function restoreOne(id: ShortcutId): void {
    const next: ShortcutMap = { ...map, [id]: DEFAULT_SHORTCUTS[id] };
    setMap(next);
    saveShortcuts(next);
    setError(null);
  }

  function restoreAll(): void {
    setMap(resetShortcuts());
    setListening(null);
    setError(null);
  }

  return (
    <div className="shortcuts-card">
      <div className="shortcuts-search">
        <input
          type="text"
          placeholder="Buscar atajo…"
          aria-label="Buscar atajo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="shortcuts-count">{filtered.length}</span>
        <button type="button" className="ghost shortcuts-reset-btn" onClick={restoreAll}>
          Restablecer todo
        </button>
      </div>

      <p className="shortcuts-hint">
        Hacé clic en una combinación y presioná la nueva. Esc cancela. Los cambios se aplican al
        instante, también en la paleta (Ctrl+K por defecto).
      </p>

      {error && <p className="shortcuts-error">{error}</p>}

      {filtered.length === 0 && <p className="shortcuts-empty">Sin resultados</p>}

      <div className="shortcuts-list">
        {byCategory.map(([category, ids]) => (
          <div key={category} className="shortcuts-group">
            <h4 className="shortcuts-group-title">{category}</h4>
            <div className="shortcuts-rows">
              {ids.map((id) => {
                const customized = map[id] !== DEFAULT_SHORTCUTS[id];
                const active = listening === id;
                return (
                  <div
                    key={id}
                    className={`shortcuts-row${active ? ' listening' : ''}`}
                  >
                    <span className="shortcuts-label">
                      {SHORTCUT_LABELS[id]}
                      {customized && <span className="shortcuts-custom-badge">personalizado</span>}
                    </span>
                    <span className="shortcuts-controls">
                      {customized && !active && (
                        <button
                          type="button"
                          className="ghost shortcuts-restore-one"
                          title="Volver al atajo original"
                          onClick={() => restoreOne(id)}
                        >
                          ↺
                        </button>
                      )}
                      <button
                        type="button"
                        className="shortcuts-keys"
                        title="Clic para reasignar"
                        onClick={() => {
                          setError(null);
                          setListening(active ? null : id);
                        }}
                      >
                        {active ? 'Presioná la combinación…' : map[id]}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
