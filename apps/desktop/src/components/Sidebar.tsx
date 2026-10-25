import { Fragment } from 'react';
import type { NavGroup, NavView, ViewId } from '../app/navigation';
import type { ProjectPhase } from '../state/project-store';
import { useAppearance } from '../state/AppearanceProvider';
import { Icon, type IconName } from './Icon';
import { ProfileMenu } from './ProfileMenu';

const VIEW_ICONS: Record<ViewId, IconName> = {
  home: 'home',
  projects: 'projects',
  script: 'script',
  assets: 'assets',
  production: 'production',
  editor: 'editor',
  'text-edit': 'text',
  multicam: 'layers',
  mixer: 'audio',
  vfx: 'effects',
  download: 'download',
  director: 'director',
  factory: 'factory',
  compliance: 'shield',
  convert: 'convert',
  compare: 'split',
  compress: 'compress',
  denoise: 'denoise',
  thumbnails: 'thumbnails',
  localization: 'globe',
  'ai-hub': 'ai-hub',
  motion: 'motion',
  visuals: 'filters',
  background: 'background',
  upscale: 'upscale',
  learn: 'learn',
  mcp: 'plug',
  settings: 'settings',
};

const BREAK_BEFORE_GROUP: ReadonlySet<NavGroup> = new Set<NavGroup>(['herramientas', 'ayuda']);

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
      className={`sidebar${appearance.sidebarLabels !== false ? ' expanded' : ''}`}
      aria-label="Vistas principales"
    >
      <ul>
        {views.map((view, index) => (
          <Fragment key={view.id}>
            {view.id === 'projects' ? (
              <li className="nav-group-header" aria-hidden="true">
                <span className="nav-separator-label">RUTA</span>
              </li>
            ) : null}
            {BREAK_BEFORE_GROUP.has(view.group) &&
            views[index - 1]?.group !== view.group ? (
              <li className="nav-separator" aria-hidden="true">
                <span className="nav-separator-label">
                  {view.group === 'herramientas'
                    ? 'HERRAMIENTAS IA'
                    : 'AYUDA'}
                </span>
              </li>
            ) : null}
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
                <Icon name={VIEW_ICONS[view.id]} className="nav-icon" size={15} />
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
          <span className="sidebar-project-name">{projectName ?? 'Sin proyecto'}</span>
        </span>
        <ProfileMenu onSelect={onSelect} />
      </div>
    </nav>
  );
}
