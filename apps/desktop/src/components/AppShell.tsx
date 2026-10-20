import { useEffect, useRef, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Icon } from './Icon';
import { MenuBar } from './MenuBar';
import { WindowControls } from './WindowControls';
import { NAV_VIEWS, type ViewId } from '../app/navigation';
import { useProjectStore } from '../state/project-store';

interface AppShellProps {
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly content: ReactNode;
  readonly flush?: boolean;
}

export function AppShell({ activeId, onSelect, content, flush = false }: AppShellProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const error = store.state.error;
  const notice = store.state.notice;
  const mainRef = useRef<HTMLElement | null>(null);
  const hasClip = Boolean(project?.timeline.clips.length);

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [activeId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <MenuBar activeId={activeId} onSelect={onSelect} />
        <div className="window-drag" data-tauri-drag-region aria-hidden="true" />
        {activeId !== 'editor' ? (
          <button
            type="button"
            className="project-chip"
            aria-live="polite"
            data-tooltip={
              project
                ? `Proyecto: ${project.name} · ${store.statusText} · clic para ir a Proyectos`
                : 'Sin proyecto abierto · clic para crear o abrir uno'
            }
            onClick={() => onSelect('projects')}
          >
            <span className={`phase-dot phase-${store.state.phase}`} aria-hidden="true" />
            <span className="project-chip-copy">
              <strong>{project?.name ?? 'Sin proyecto'}</strong>
              <span>{store.statusText}</span>
            </span>
          </button>
        ) : null}
        <div className="window-drag" data-tauri-drag-region aria-hidden="true" />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Deshacer"
            data-tooltip="Deshacer · Ctrl+Z"
            onClick={store.undo}
            disabled={!store.canUndo}
          >
            <Icon name="undo" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Rehacer"
            data-tooltip="Rehacer · Ctrl+Shift+Z"
            onClick={store.redo}
            disabled={!store.canRedo}
          >
            <Icon name="redo" size={16} />
          </button>
          <span className="topbar-divider" aria-hidden="true" />
          <button
            type="button"
            className={`icon-button${store.state.phase === 'dirty' ? ' dirty' : ''}`}
            aria-label="Guardar"
            data-tooltip={store.state.phase === 'saving' ? 'Guardando…' : 'Guardar · Ctrl+S'}
            onClick={() => {
              void store.saveNow();
            }}
            disabled={!project || store.state.phase === 'saving'}
          >
            <Icon name="save" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Exportar video"
            data-tooltip={hasClip ? 'Exportar video · Ctrl+E' : 'Montá al menos un clip para exportar'}
            onClick={() => {
              if (activeId !== 'editor') onSelect('editor');
              store.requestExport();
            }}
            disabled={!project || !hasClip}
          >
            <Icon name="export" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Tutorial"
            data-tooltip="Tutorial completo y ayuda"
            onClick={() => onSelect('learn')}
          >
            <Icon name="learn" size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Ajustes"
            data-tooltip="Apariencia y ajustes"
            onClick={() => onSelect('settings')}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
        <WindowControls />
      </header>
      {error ? (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={store.clearError}>
            Cerrar
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => store.setNotice(null)}>
            Cerrar
          </button>
        </div>
      ) : null}
      <div className="app-body">
        <Sidebar
          views={NAV_VIEWS}
          activeId={activeId}
          onSelect={onSelect}
          projectName={project?.name ?? null}
          phase={store.state.phase}
        />
        <main ref={mainRef} className={flush ? 'content content-flush' : 'content'}>{content}</main>
      </div>
      <footer className="app-statusbar">
        <span className={`statusbar-dot phase-${store.state.phase}`} aria-hidden="true" />
        <span className="statusbar-project">{project?.name ?? 'Sin proyecto abierto'}</span>
        {project ? (
          <span className="statusbar-meta">
            {project.video.width}×{project.video.height} ·{' '}
            {(project.video.frameRate.num / project.video.frameRate.den).toFixed(
              project.video.frameRate.den === 1 ? 0 : 2,
            )}{' '}
            fps
          </span>
        ) : null}
        <span className="statusbar-spacer" />
        <span className="statusbar-meta">{store.statusText}</span>
        <span className="statusbar-meta statusbar-local">FFmpeg local · sin nube</span>
      </footer>
    </div>
  );
}
