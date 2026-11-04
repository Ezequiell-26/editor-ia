import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Icon, type IconName } from './Icon';
import { MenuBar } from './MenuBar';
import { WindowControls } from './WindowControls';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { NAV_VIEWS, type NavView, type ViewId } from '../app/navigation';
import { useProjectStore } from '../state/project-store';
import { useEditorPreferences } from '../state/useEditorPreferences';

/** Último segmento de una ruta, para mostrar sólo el nombre del archivo. */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** “14:32” en la zona horaria del equipo; vacío si la fecha no es válida. */
function savedClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

interface AppShellProps {
  readonly activeId: ViewId;
  readonly views?: readonly NavView[];
  readonly moreViews?: readonly NavView[];
  readonly onSelect: (id: ViewId) => void;
  readonly onReturnToStart?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onOpenShortcuts?: () => void;
  readonly onOpenTour?: () => void;
  /** Franja opcional en el flujo del shell (aviso de modo navegador). */
  readonly banner?: ReactNode;
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
  onOpenShortcuts,
  onOpenTour,
  banner = null,
  content,
  flush = false,
}: AppShellProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const error = store.state.error;
  const notice = store.state.notice;
  const preferences = useEditorPreferences();
  const [recovering, setRecovering] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const hasClip = Boolean(project?.timeline.clips.length);
  const immersive = activeId === 'editor' && Boolean(project);

  /**
   * Estado de autoguardado visible en la statusbar. Usa la señal real del
   * store: `phase` (dirty → saving → saved/failed) y `lastSavedAt` que el store
   * actualiza al completar un guardado (manual o automático). No hay
   * persistencia nueva: sólo se muestra lo que el store ya sabe.
   */
  const autosave = useMemo<{ readonly icon: IconName; readonly label: string }>(() => {
    const delaySeconds = preferences.autosaveDelayMs / 1_000;
    const delayLabel = Number.isInteger(delaySeconds)
      ? `${delaySeconds} s`
      : `${delaySeconds.toFixed(1).replace('.', ',')} s`;
    switch (store.state.phase) {
      case 'saving':
        return { icon: 'save', label: 'Guardando…' };
      case 'saved': {
        const clock = store.state.lastSavedAt ? savedClock(store.state.lastSavedAt) : '';
        return { icon: 'check', label: clock ? `Guardado ${clock}` : 'Sin cambios' };
      }
      case 'dirty':
        return {
          icon: 'save',
          label: `Cambios sin guardar · autoguardado en ${delayLabel}`,
        };
      case 'failed':
        return { icon: 'alert', label: 'Error al guardar' };
      case 'loading':
        return { icon: 'refresh', label: 'Abriendo proyecto…' };
      default:
        return { icon: 'check', label: 'Sin cambios' };
    }
  }, [preferences.autosaveDelayMs, store.state.lastSavedAt, store.state.phase]);

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

  /**
   * Recuperación de la instantánea de crash: única superficie dentro del shell
   * (el launcher muestra la misma oferta cuando está fuera). El descarte pide
   * confirmación para no perder trabajo sin guardar por un clic accidental.
   */
  async function recoverSession(): Promise<void> {
    if (recovering) return;
    setRecovering(true);
    try {
      await store.acceptRecovery();
    } finally {
      setRecovering(false);
    }
  }

  function discardSession(): void {
    const confirmed = window.confirm(
      'Se descarta la sesión sin guardar; el proyecto en disco queda como está. ¿Continuar?',
    );
    if (confirmed) store.dismissRecovery();
  }

  return (
    <div className={`app-shell${immersive ? ' editor-immersive' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand" title="Olyvia" data-tour="brand">
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
          {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
          {...(onOpenTour ? { onOpenTour } : {})}
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
            data-tour="export"
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
          <span className="topbar-divider" aria-hidden="true" />
          {onOpenShortcuts && (
            <button
              type="button"
              className="icon-button"
              aria-label="Atajos de teclado (Shift + ?)"
              data-tooltip="Atajos de teclado · Shift + ?"
              onClick={onOpenShortcuts}
            >
              <Icon name="keyboard" size={16} />
            </button>
          )}
          {onOpenTour && (
            <button
              type="button"
              className="icon-button"
              aria-label="Tour interactivo"
              data-tooltip="Tour guiado · Conocer Olyvia"
              onClick={onOpenTour}
            >
              <Icon name="sparkles" size={16} />
            </button>
          )}
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
      {banner}
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
          <button
            type="button"
            className="primary"
            onClick={() => void recoverSession()}
            disabled={recovering}
          >
            {recovering ? 'Recuperando…' : 'Recuperar'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={discardSession}
            disabled={recovering}
          >
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
        {onOpenShortcuts && (
          <button
            type="button"
            className="statusbar-meta statusbar-btn"
            onClick={onOpenShortcuts}
            title="Ver atajos de teclado (Shift + ?)"
          >
            <Icon name="keyboard" size={12} />
            <span>Atajos (?)</span>
          </button>
        )}
        {onOpenTour && (
          <button
            type="button"
            className="statusbar-meta statusbar-btn"
            onClick={onOpenTour}
            title="Iniciar tour interactivo de Olyvia"
          >
            <Icon name="sparkles" size={12} />
            <span>Tour</span>
          </button>
        )}
        {/* El estado del proyecto ya se lee a la izquierda; sin proyecto abierto
            evitamos repetir «Sin proyecto abierto» dos veces. */}
        {project ? (
          <span
            className={`statusbar-meta statusbar-autosave phase-${store.state.phase}`}
            role="status"
            aria-live="polite"
            title={autosave.label}
          >
            <Icon name={autosave.icon} size={12} />
            <span>{autosave.label}</span>
          </span>
        ) : null}
        <span className="statusbar-meta statusbar-local">FFmpeg local · sin nube</span>
      </footer>
    </div>
  );
}
