import { useEffect, useRef, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Icon } from './Icon';
import { MenuBar } from './MenuBar';
import { WindowControls } from './WindowControls';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { NAV_VIEWS, type NavView, type ViewId } from '../app/navigation';
import { useProjectStore } from '../state/project-store';

/** Último segmento de una ruta, para mostrar sólo el nombre del archivo. */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

interface AppShellProps {
  readonly activeId: ViewId;
  readonly views?: readonly NavView[];
  readonly moreViews?: readonly NavView[];
  readonly onSelect: (id: ViewId) => void;
  readonly onReturnToStart?: () => void;
  readonly onOpenPalette?: () => void;
  readonly content: ReactNode;
  readonly flush?: boolean;
}

export function AppShell({
  activeId,
  views = NAV_VIEWS,
  moreViews = [],
  onSelect,
  onReturnToStart,
  onOpenPalette,
  content,
  flush = false,
}: AppShellProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const error = store.state.error;
  const notice = store.state.notice;
  const mainRef = useRef<HTMLElement | null>(null);
  const hasClip = Boolean(project?.timeline.clips.length);
  const immersive = activeId === 'editor' && Boolean(project);
  // Las vistas quedan montadas: cada una conserva su propia posición de scroll
  // en vez de heredar la de la anterior o volver siempre arriba.
  const scrollPositions = useRef(new Map<ViewId, number>());
  const previousView = useRef<ViewId | null>(null);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const previous = previousView.current;
    if (previous) scrollPositions.current.set(previous, main.scrollTop);
    main.scrollTop = scrollPositions.current.get(activeId) ?? 0;
    previousView.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const applyTitles = () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('button.icon-text')) {
        if (button.title) continue;
        const label = button.getAttribute('aria-label') ?? button.textContent?.trim();
        if (label) button.title = label;
      }
    };
    applyTitles();
    const handle = window.requestAnimationFrame(applyTitles);
    return () => {
      window.cancelAnimationFrame(handle);
    };
  }, [activeId]);

  return (
    <div className={`app-shell${immersive ? ' editor-immersive' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand" title="Olyvia">
          <img src="/olyvia-mark.png" alt="" />
          <span>Olyvia</span>
        </div>
        {onReturnToStart && (
          <button
            type="button"
            className="topbar-home-btn"
            aria-label="Pantalla de inicio"
            data-tooltip="Volver a la pantalla de inicio"
            onClick={onReturnToStart}
          >
            <Icon name="home" size={14} />
            <span>Inicio</span>
          </button>
        )}
        <MenuBar
          activeId={activeId}
          views={views}
          onSelect={onSelect}
          {...(onReturnToStart ? { onOpenStart: onReturnToStart } : {})}
        />
        <div className="topbar-center" data-tauri-drag-region aria-hidden="true" />
        {immersive && project ? (
          <div className="topbar-project" data-tauri-drag-region>
            <strong className="topbar-project-name" title={project.name}>
              {project.name}
            </strong>
            <span className="topbar-project-phase">
              <span className={`statusbar-dot phase-${store.state.phase}`} aria-hidden="true" />
              {store.state.phase === 'saved'
                ? 'Guardado'
                : store.state.phase === 'saving'
                  ? 'Guardando…'
                  : store.state.phase === 'failed'
                    ? 'Error al guardar'
                    : 'Sin guardar'}
            </span>
          </div>
        ) : null}
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-search"
            aria-label="Buscar o ejecutar un comando"
            data-tooltip="Buscar vistas, proyectos y comandos · Ctrl+K"
            onClick={onOpenPalette}
          >
            <Icon name="search" size={14} />
            <span>Buscar</span>
            <kbd>Ctrl K</kbd>
          </button>
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
            className={`topbar-export-btn${hasClip ? ' ready' : ''}`}
            aria-label="Exportar video"
            data-tooltip={hasClip ? 'Exportar video · Ctrl+E' : 'Montá al menos un clip para exportar'}
            title={hasClip ? 'Exportar video · Ctrl+E' : 'Montá al menos un clip para exportar'}
            onClick={() => {
              if (activeId !== 'editor') onSelect('editor');
              store.requestExport();
            }}
            disabled={!project || !hasClip}
          >
            <Icon name="export" size={14} />
            <span>Exportar</span>
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
      {store.state.recoveryOffer ? (
        <div className="recovery-banner" role="status">
          <span className="recovery-banner-text">
            Se interrumpió la sesión anterior y quedaron cambios sin guardar en{' '}
            <strong>{fileNameOf(store.state.recoveryOffer.path)}</strong>.
          </span>
          <button type="button" className="primary" onClick={() => void store.acceptRecovery()}>
            Recuperar
          </button>
          <button type="button" className="ghost" onClick={() => store.dismissRecovery()}>
            Descartar
          </button>
        </div>
      ) : null}
      <div className="app-body">
        <Sidebar
          views={views}
          moreViews={moreViews}
          activeId={activeId}
          onSelect={onSelect}
          projectName={project?.name ?? null}
          phase={store.state.phase}
        />
        <main ref={mainRef} className={flush ? 'content content-flush' : 'content'}>{content}</main>
      </div>
      <AssistantDock activeId={activeId} onSelect={onSelect} />
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
