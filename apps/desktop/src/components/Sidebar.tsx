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
      <div
        className="sidebar-brand"
        onClick={() => onSelect('home')}
        title="Montaje AI Studio"
        role="button"
        tabIndex={0}
      >
        <div className="sidebar-logo-box">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <circle cx="7" cy="8" r="4" stroke="#e05252" strokeWidth="1.6" fill="rgba(224, 82, 82, 0.2)" />
            <circle cx="17" cy="8" r="4" stroke="#48b85c" strokeWidth="1.6" fill="rgba(72, 184, 92, 0.2)" />
            <circle cx="12" cy="16" r="4" stroke="#4881c2" strokeWidth="1.6" fill="rgba(72, 129, 194, 0.25)" />
            <polygon points="11 14.5 14 16 11 17.5" fill="#4881c2" />
          </svg>
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">Montaje</span>
          <span className="sidebar-brand-sub">AI Studio</span>
        </div>
      </div>

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
