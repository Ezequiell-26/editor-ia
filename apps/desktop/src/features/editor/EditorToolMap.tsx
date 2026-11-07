import { useId, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { WORKSPACE_GROUPS, WORKSPACE_TOOLS } from '../../app/workspace-map';
import { Icon } from '../../components/Icon';

export interface EditorToolMapProps {
  readonly onNavigate: (id: ViewId) => void;
  /** Herramienta activa, para marcarla en el mapa. */
  readonly currentView?: ViewId;
}

/**
 * T2 · LA ÚNICA PUERTA cuando hay proyecto abierto.
 *
 * No copia ninguna lista: los grupos y las etiquetas salen de
 * `app/workspace-map.ts` (que a su vez lee `NAV_VIEWS` y `resolveViewRoute`).
 * Un buscador, cuatro grupos, un clic. Sin emojis, sin submenús escondidos.
 */
export function EditorToolMap({ onNavigate, currentView }: EditorToolMapProps) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const needle = query.trim().toLocaleLowerCase('es');

  const groups = useMemo(
    () =>
      WORKSPACE_GROUPS.map((group) => ({
        ...group,
        tools: WORKSPACE_TOOLS.filter(
          (tool) =>
            tool.group === group.id &&
            (!needle ||
              `${tool.label} ${tool.hint} ${group.label}`
                .toLocaleLowerCase('es')
                .includes(needle)),
        ),
      })),
    [needle],
  );
  const shown = groups.reduce((total, group) => total + group.tools.length, 0);

  return (
    <section className="editor-tool-map" aria-label="Mapa de herramientas">
      <header className="editor-tool-map-head">
        <div className="editor-tool-map-title">
          <p className="eyebrow">Un mapa para toda la app</p>
          <h3>Todas las herramientas, sin salir del editor</h3>
        </div>
        <div className="editor-tool-map-search">
          <Icon name="search" size={13} />
          <label className="sr-only" htmlFor={inputId}>
            Buscar herramienta
          </label>
          <input
            id={inputId}
            type="search"
            value={query}
            placeholder="Buscar herramienta"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="editor-tool-map-count fine-print">
          {shown} / {WORKSPACE_TOOLS.length}
        </span>
      </header>

      <div className="editor-tool-map-groups">
        {groups.map((group) =>
          group.tools.length === 0 ? null : (
            <section className="editor-tool-map-group" key={group.id} aria-label={group.label}>
              <h4>
                {group.label}
                <span className="fine-print">{group.tools.length}</span>
              </h4>
              <ul className="editor-tool-map-list">
                {group.tools.map((tool) => {
                  // Sólo la herramienta EXACTA se marca: si se marcara también
                  // la ruta canónica, estar en el editor pintaría 7 chips como
                  // «Aquí» y el mapa dejaría de ser legible.
                  const here = currentView === tool.view;
                  return (
                    <li key={tool.view}>
                      <button
                        type="button"
                        className={`editor-tool-chip${here ? ' is-here' : ''}`}
                        aria-label={`${tool.label}: ${tool.hint}`}
                        aria-current={here ? 'true' : undefined}
                        onClick={() => onNavigate(tool.view)}
                      >
                        <strong>{tool.label}</strong>
                        <span>{tool.hint}</span>
                        {here ? <em>Aquí</em> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
        )}
      </div>

      {shown === 0 ? (
        <p className="editor-tool-map-empty">
          Ninguna herramienta coincide con «{query.trim()}». Probá con otra palabra.
        </p>
      ) : null}
    </section>
  );
}
