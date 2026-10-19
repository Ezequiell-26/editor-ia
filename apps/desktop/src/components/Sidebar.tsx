import type { NavView, ViewId } from '../app/navigation';

interface SidebarProps {
  readonly views: readonly NavView[];
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly projectName: string | null;
}

export function Sidebar({ views, activeId, onSelect, projectName }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Vistas principales">
      <ul>
        {views.map((view) => (
          <li key={view.id}>
            <button
              type="button"
              aria-current={view.id === activeId ? 'page' : undefined}
              title={view.hint}
              onClick={() => {
                onSelect(view.id);
              }}
            >
              <span className="nav-label">{view.label}</span>
              <span className="nav-index" aria-hidden="true">
                {String(views.findIndex((item) => item.id === view.id) + 1).padStart(2, '0')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-project">
        <span className="sidebar-caption">Proyecto</span>
        <strong>{projectName ?? 'Ninguno abierto'}</strong>
      </div>
    </nav>
  );
}
