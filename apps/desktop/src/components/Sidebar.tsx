import { Fragment, useEffect, useRef, useState } from 'react';
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
  'auto-edit': 'sparkles',
  youtube: 'globe',
  factory: 'factory',
  creator: 'sparkles',
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
  lab: 'lab',
  learn: 'learn',
  mcp: 'plug',
  settings: 'settings',
};

/** Cada grupo, salvo el primero, abre con un separador rotulado. */
const GROUP_LABELS: Readonly<Partial<Record<NavGroup, string>>> = {
  ruta: 'RUTA',
  herramientas: 'HERRAMIENTAS',
  ayuda: 'AYUDA',
};

interface SidebarProps {
  readonly views: readonly NavView[];
  readonly moreViews?: readonly NavView[];
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly projectName: string | null;
  readonly phase: ProjectPhase;
}

export function Sidebar({
  views,
  moreViews = [],
  activeId,
  onSelect,
  projectName,
  phase,
}: SidebarProps) {
  const { appearance } = useAppearance();
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    setMoreOpen(false);
  }, [activeId]);

  return (
    <nav
      ref={rootRef}
      className={`sidebar${appearance.sidebarLabels !== false ? ' expanded' : ''}`}
      aria-label="Vistas principales"
    >
      <ul>
        {views.map((view, index) => (
          <Fragment key={view.id}>
            {GROUP_LABELS[view.group] && views[index - 1]?.group !== view.group ? (
              <li className="nav-separator" aria-hidden="true">
                <span className="nav-separator-label">{GROUP_LABELS[view.group]}</span>
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
        {moreViews.length > 0 ? (
          <li className="nav-more">
            <button
              type="button"
              aria-label={moreOpen ? 'Cerrar herramientas avanzadas' : 'Más herramientas'}
              aria-expanded={moreOpen}
              aria-controls="sidebar-more-list"
              data-tooltip="Más herramientas · Director, Automático y modos del editor (Texto, Multicámara, Mezcla, VFX, Motion, Efectos)"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Icon name="grid" className="nav-icon" size={15} />
              <span className="nav-label" aria-hidden="true">Más</span>
            </button>
            {moreOpen ? (
              <ul
                className="nav-more-list"
                id="sidebar-more-list"
                aria-label="Herramientas avanzadas"
              >
                {moreViews.map((view) => (
                  <li key={view.id}>
                    <button
                      type="button"
                      aria-label={view.label}
                      aria-current={view.id === activeId ? 'page' : undefined}
                      data-tooltip={view.hint}
                      onClick={() => {
                        setMoreOpen(false);
                        onSelect(view.id);
                      }}
                    >
                      <Icon name={VIEW_ICONS[view.id]} className="nav-icon" size={14} />
                      <span className="nav-label" aria-hidden="true">{view.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
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
