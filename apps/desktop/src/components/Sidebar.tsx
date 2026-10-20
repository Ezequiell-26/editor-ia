import { Fragment } from 'react';
import type { NavView, ViewId } from '../app/navigation';
import type { ProjectPhase } from '../state/project-store';
import { useAppearance } from '../state/AppearanceProvider';
import { Icon, type IconName } from './Icon';
import { ProfileMenu } from './ProfileMenu';

const VIEW_ICONS: Record<ViewId, IconName> = {
  projects: 'projects',
  director: 'sparkles',
  production: 'film',
  factory: 'layers',
  editor: 'editor',
  script: 'script',
  assets: 'assets',
  download: 'download',
  convert: 'fit',
  learn: 'learn',
  mcp: 'plug',
  settings: 'settings',
};

const BREAK_BEFORE: ReadonlySet<ViewId> = new Set<ViewId>(['editor', 'learn']);

interface SidebarProps {
  readonly views: readonly NavView[];
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly projectName: string | null;
  readonly phase: ProjectPhase;
}

export function Sidebar({ views, activeId, onSelect, projectName, phase }: SidebarProps) {
  const { appearance } = useAppearance();
  return (
    <nav
      className={`sidebar${appearance.sidebarLabels ? ' expanded' : ''}`}
      aria-label="Vistas principales"
    >
      <ul>
        {views.map((view) => (
          <Fragment key={view.id}>
            {BREAK_BEFORE.has(view.id) ? <li className="nav-separator" aria-hidden="true" /> : null}
            <li>
              <button
                type="button"
                aria-current={view.id === activeId ? 'page' : undefined}
                aria-label={view.label}
                data-tooltip={`${view.label} · ${view.hint}`}
                onClick={() => {
                  onSelect(view.id);
                }}
              >
                <Icon name={VIEW_ICONS[view.id]} className="nav-icon" size={19} />
                <span className="nav-label" aria-hidden="true">
                  {view.label}
                </span>
              </button>
            </li>
          </Fragment>
        ))}
      </ul>
      <div className="sidebar-tail">
        <span
          className="sidebar-project-dot"
          data-tooltip={`Proyecto activo: ${projectName ?? 'ninguno'}`}
        >
          <span className={`phase-dot phase-${phase}`} aria-hidden="true" />
          {appearance.sidebarLabels ? (
            <span className="sidebar-project-name">{projectName ?? 'Sin proyecto'}</span>
          ) : null}
        </span>
        <ProfileMenu onSelect={onSelect} />
      </div>
    </nav>
  );
}
