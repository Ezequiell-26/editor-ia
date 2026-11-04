import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../app/commands';
import { foldText, fuzzyMatch } from '../app/commands';
import { loadRecents, type RecentProject } from '../lib/recents';
import { GLOBAL_HIT_LABEL, type GlobalSearchHit } from '../state/global-search';
import { useProjectStore } from '../state/project-store';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Icon } from './Icon';

interface CommandPaletteProps {
  readonly commands: readonly Command[];
  readonly onClose: () => void;
  /**
   * Búsqueda en el proyecto. Puede ser asíncrona porque el motor se carga bajo
   * demanda; la paleta muestra “Buscando…” hasta tener la primera respuesta.
   */
  readonly search?: (query: string) => Promise<readonly GlobalSearchHit[]> | readonly GlobalSearchHit[];
  readonly onPickHit?: (hit: GlobalSearchHit) => void;
}

type PaletteItem =
  | { readonly type: 'recent'; readonly key: string; readonly recent: RecentProject }
  | { readonly type: 'command'; readonly key: string; readonly command: Command }
  | { readonly type: 'hit'; readonly key: string; readonly hit: GlobalSearchHit };

/** Matchea un reciente por nombre, archivo o ruta, sin distinguir tildes. */
function matchesRecent(recent: RecentProject, query: string): boolean {
  const folded = foldText(query);
  if (!folded) return false;
  return foldText(`${recent.name} ${recent.label} ${recent.path}`).includes(folded);
}

export function CommandPalette({ commands, onClose, search, onPickHit }: CommandPaletteProps) {
  const store = useProjectStore();
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Los recientes se leen del almacenamiento real al abrir la paleta (es un
  // componente que sólo existe mientras está abierta). Los que ya no se pueden
  // abrir se filtraron en `loadRecents`; el proyecto actual no se ofrece.
  const [recents] = useState<readonly RecentProject[]>(() => loadRecents());
  const currentPath = store.state.opened?.path ?? null;

  // Trampa de foco (auditoría de accesibilidad, H1/H2): guarda el disparador,
  // enfoca el primer enfocable del panel (la búsqueda), atrapa Tab —antes
  // escapaba al editor detrás— y cierra con Escape devolviendo el foco. La
  // paleta se monta sólo mientras está abierta, así que no hace falta
  // `active`. El atajo de flechas y Enter vive en el efecto de más abajo.
  useDialogFocus({ containerRef: dialogRef, onClose });

  const commandMatches = useMemo(() => {
    const q = query.trim();
    if (!q) return commands.filter((c) => !c.disabled);
    return commands.filter((c) => !c.disabled && fuzzyMatch(q, `${c.category}: ${c.label}`));
  }, [commands, query]);

  // Proyectos recientes sólo cuando hay consulta: con la búsqueda vacía la
  // paleta mantiene el orden de siempre (Enter ejecuta el primer comando) y
  // no abre un proyecto por accidente.
  const recentMatches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return recents
      .filter((recent) => recent.path !== currentPath)
      .filter((recent) => matchesRecent(recent, q))
      .slice(0, 4);
  }, [currentPath, query, recents]);

  const [hits, setHits] = useState<readonly GlobalSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || !search) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void (async () => {
      try {
        const result = await search(trimmed);
        if (!cancelled) setHits(result);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, search]);

  const items = useMemo<readonly PaletteItem[]>(
    () => [
      ...recentMatches.map((recent) => ({
        type: 'recent' as const,
        key: `recent:${recent.path}`,
        recent,
      })),
      ...hits.map((hit) => ({ type: 'hit' as const, key: `hit:${hit.id}`, hit })),
      ...commandMatches.map((command) => ({
        type: 'command' as const,
        key: `command:${command.id}`,
        command,
      })),
    ],
    [commandMatches, hits, recentMatches],
  );

  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Si los resultados se achican (por ejemplo deja de haber coincidencias), la
  // selección no debe quedar apuntando a un índice inexistente.
  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      onClose();
      // Defer action so the modal is gone before any navigation/focus change.
      if (item.type === 'command') {
        setTimeout(() => item.command.action(), 0);
      } else if (item.type === 'hit') {
        if (onPickHit) setTimeout(() => onPickHit(item.hit), 0);
      } else {
        // Abrir un reciente es una acción real del store (misma ruta que Inicio
        // y Proyectos). Si sale bien, se navega al editor con el mismo comando
        // de navegación que ya usa la paleta; si falla, el error visible del
        // store lo muestra el shell.
        const openEditor = commands.find((command) => command.id === 'nav.editor');
        const path = item.recent.path;
        setTimeout(() => {
          void (async () => {
            const opened = await store.openProjectAt(path);
            if (opened && openEditor) openEditor.action();
          })();
        }, 0);
      }
    },
    [commands, onClose, onPickHit, store],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // El Escape lo maneja useDialogFocus (con guarda de overlays superiores).
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        activate(items[selected]);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activate, items, onClose, selected]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const renderOption = (item: PaletteItem, index: number) => {
    if (item.type === 'recent') {
      return (
        <button
          key={item.key}
          role="option"
          data-index={index}
          aria-selected={index === selected}
          className={`cmdp-item${index === selected ? ' selected' : ''}`}
          onClick={() => activate(item)}
          onMouseMove={() => setSelected(index)}
        >
          <span className="cmdp-item-body">
            <span className="cmdp-item-label">{item.recent.name}</span>
            <span className="cmdp-item-sub">{item.recent.label}</span>
          </span>
          <span className="cmdp-item-meta">
            <span className="cmdp-kind">Proyecto</span>
          </span>
        </button>
      );
    }
    if (item.type === 'hit') {
      return (
        <button
          key={item.key}
          role="option"
          data-index={index}
          aria-selected={index === selected}
          className={`cmdp-item${index === selected ? ' selected' : ''}`}
          onClick={() => activate(item)}
          onMouseMove={() => setSelected(index)}
        >
          <span className="cmdp-item-body">
            <span className="cmdp-item-label">{item.hit.title}</span>
            <span className="cmdp-item-sub">{item.hit.subtitle}</span>
          </span>
          <span className="cmdp-item-meta">
            <span className="cmdp-kind">{GLOBAL_HIT_LABEL[item.hit.kind]}</span>
          </span>
        </button>
      );
    }
    return (
      <button
        key={item.key}
        role="option"
        data-index={index}
        aria-selected={index === selected}
        className={`cmdp-item${index === selected ? ' selected' : ''}`}
        onClick={() => activate(item)}
        onMouseMove={() => setSelected(index)}
      >
        <span className="cmdp-item-label">{item.command.label}</span>
        <span className="cmdp-item-meta">
          <span className="cmdp-category">{item.command.category}</span>
          {item.command.shortcut && <kbd className="cmdp-shortcut">{item.command.shortcut}</kbd>}
        </span>
      </button>
    );
  };

  return (
    <div
      className="cmdp-overlay"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdp-panel">
        <div className="cmdp-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Buscar comandos, proyectos recientes o dentro del proyecto…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-autocomplete="list"
            aria-controls="cmdp-list"
          />
          <kbd className="cmdp-kbd">Esc</kbd>
        </div>

        <div ref={listRef} className="cmdp-list" id="cmdp-list" role="listbox">
          {items.length === 0 && !searching && <div className="cmdp-empty">Sin resultados</div>}
          {searching && hits.length === 0 ? <div className="cmdp-empty">Buscando…</div> : null}

          {recentMatches.length > 0 && (
            <div className="cmdp-section" role="group" aria-label="Proyectos recientes">
              <p className="cmdp-section-title">Proyectos recientes</p>
              {recentMatches.map((recent, index) =>
                renderOption({ type: 'recent', key: `recent:${recent.path}`, recent }, index),
              )}
            </div>
          )}

          {hits.length > 0 && (
            <div className="cmdp-section" role="group" aria-label="En el proyecto">
              <p className="cmdp-section-title">En el proyecto</p>
              {hits.map((hit, offset) =>
                renderOption(
                  { type: 'hit', key: `hit:${hit.id}`, hit },
                  recentMatches.length + offset,
                ),
              )}
            </div>
          )}

          {commandMatches.length > 0 && (
            <div className="cmdp-section" role="group" aria-label="Acciones">
              <p className="cmdp-section-title">Acciones</p>
              {commandMatches.map((command, offset) =>
                renderOption(
                  { type: 'command', key: `command:${command.id}`, command },
                  recentMatches.length + hits.length + offset,
                ),
              )}
            </div>
          )}
        </div>

        <div className="cmdp-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> para navegar · <kbd>Enter</kbd> para abrir
          </span>
          <span className="cmdp-count">
            {recentMatches.length > 0
              ? `${recentMatches.length} proyecto${recentMatches.length === 1 ? '' : 's'} · `
              : ''}
            {hits.length > 0 ? `${hits.length} en el proyecto · ` : ''}
            {commandMatches.length} comando{commandMatches.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
