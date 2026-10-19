import { useEffect, useRef, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
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

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [activeId]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1 className="brand">
            Editor<span className="brand-mark">IA</span>
          </h1>
          <p className="brand-note">Editor de video local-first · Windows</p>
        </div>
        <div className="project-chip" aria-live="polite">
          <span className={`phase-dot phase-${store.state.phase}`} aria-hidden="true" />
          <div>
            <strong>{project?.name ?? 'Sin proyecto'}</strong>
            <span>{store.statusText}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost"
            onClick={store.undo}
            disabled={!store.canUndo}
            title="Deshacer (Ctrl+Z)"
          >
            Deshacer
          </button>
          <button
            type="button"
            className="ghost"
            onClick={store.redo}
            disabled={!store.canRedo}
            title="Rehacer (Ctrl+Shift+Z)"
          >
            Rehacer
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void store.saveNow();
            }}
            disabled={!project || store.state.phase === 'saving'}
          >
            {store.state.phase === 'saving' ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
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
        />
        <main ref={mainRef} className={flush ? 'content content-flush' : 'content'}>{content}</main>
      </div>
    </div>
  );
}
