import type { NavView, ViewId } from '../app/navigation';

interface SidebarProps {
  readonly views: readonly NavView[];
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
}

export function Sidebar({ views, activeId, onSelect }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Vistas principales">
      <ul>
        {views.map((view) => (
          <li key={view.id}>
            <button
              type="button"
              aria-current={view.id === activeId ? 'page' : undefined}
              onClick={() => {
                onSelect(view.id);
              }}
            >
              {view.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
