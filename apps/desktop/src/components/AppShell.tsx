import { useEffect, useRef, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Icon } from './Icon';
import { MenuBar } from './MenuBar';
import { PipelineBar } from './PipelineBar';
import { WindowControls } from './WindowControls';
import { NAV_VIEWS, PIPELINE_HIDDEN_VIEWS, type ViewId } from '../app/navigation';
import { useProjectStore } from '../state/project-store';
import { usePipeline } from '../state/usePipeline';

interface AppShellProps {
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly onReturnToStart?: () => void;
  readonly content: ReactNode;
  readonly flush?: boolean;
}

export function AppShell({
  activeId,
  onSelect,
  onReturnToStart,
  content,
  flush = false,
}: AppShellProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const error = store.state.error;
  const notice = store.state.notice;
  const pipeline = usePipeline();
  const mainRef = useRef<HTMLElement | null>(null);
  const hasClip = Boolean(project?.timeline.clips.length);
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
    <div className="app-shell">
      <header className="topbar">
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
          onSelect={onSelect}
          {...(onReturnToStart ? { onOpenStart: onReturnToStart } : {})}
        />
        <div className="topbar-center" data-tauri-drag-region>
          {project ? (
            <div className="topbar-project-pill" title={`Proyecto: ${project.name} (${project.video.width}×${project.video.height})`}>
              <span className={`topbar-project-dot phase-${store.state.phase}`} aria-hidden="true" />
              <strong className="topbar-project-title">{project.name}</strong>
              <span className="topbar-project-spec">
                {project.video.width}×{project.video.height} · {(project.video.frameRate.num / project.video.frameRate.den).toFixed(0)}fps
              </span>
            </div>
          ) : (
            <div className="topbar-project-pill empty">
              <span className="topbar-project-dot" aria-hidden="true" />
              <span className="topbar-project-title">Sin proyecto activo</span>
            </div>
          )}
        </div>
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
          <div className="topbar-gpu-gauge" title="Aceleración por GPU local activa">
            <span className="gpu-label">GPU</span>
            <div className="gpu-track">
              <div className="gpu-fill" style={{ width: '92%' }} />
            </div>
            <span className="gpu-pct">97%</span>
          </div>
          <button
            type="button"
            className={`topbar-export-btn${hasClip ? ' ready' : ''}`}
            aria-label="Exportar video"
            data-tooltip={hasClip ? 'Exportar video · Ctrl+E' : 'Montá al menos un clip para exportar'}
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
      {!PIPELINE_HIDDEN_VIEWS.has(activeId) ? (
        <PipelineBar progress={pipeline} activeId={activeId} onSelect={onSelect} />
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
