import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Sidebar } from './Sidebar';
import { TooltipEnhancer } from './TooltipEnhancer';
import { Icon, type IconName } from './Icon';
import { MenuBar } from './MenuBar';
import { WindowControls } from './WindowControls';
import { SafeText } from './SafeText';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { NAV_VIEWS, type NavView, type ViewId } from '../app/navigation';
import { useProjectStore } from '../state/project-store';
import { useEditorPreferences } from '../state/useEditorPreferences';
import { setEditorLayout, useEditorLayout, type EditorLayout } from '../state/editor-layout';
import { appCursorCss } from '../state/app-cursor';

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
  readonly onOpenPalette?: () => void;
  readonly onOpenShortcuts?: () => void;
  readonly onOpenTour?: () => void;
  /** T2: puerta única al mapa de las 33 herramientas dentro del editor. */
  readonly onOpenToolMap?: () => void;
  /** Franja opcional en el flujo del shell (aviso de modo navegador). */
  readonly banner?: ReactNode;
  readonly content: ReactNode;
  readonly flush?: boolean;
  /** F2: la superficie activa es el editor (incluye las vistas embebidas). */
  readonly editorSurface?: boolean;
  /** Vuelta al launcher (StartScreen): botón «Inicio» y entrada de menú. */
  readonly onReturnToStart?: () => void;
}

export function AppShell({
  activeId,
  views = NAV_VIEWS,
  moreViews = [],
  onSelect,
  onOpenPalette,
  onOpenShortcuts,
  onOpenTour,
  onOpenToolMap,
  banner = null,
  content,
  flush = false,
  editorSurface = false,
  onReturnToStart,
}: AppShellProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const error = store.state.error;
  const notice = store.state.notice;
  const preferences = useEditorPreferences();
  const [recovering, setRecovering] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const editorLayout = useEditorLayout();
  // Onda de click del cursor propio (paridad `cursor_editar` de AlaukCut):
  // sólo cuando el cursor de la app está activo y la onda habilitada.
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const rippleSeq = useRef(0);
  const customCursor = preferences.editorCursor !== 'system';
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const hasClip = Boolean(project?.timeline.clips.length);
  const immersive = editorSurface && Boolean(project);

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
  // El menú de layout se cierra al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!layoutMenuRef.current?.contains(event.target as Node)) setLayoutMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLayoutMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [layoutMenuOpen]);

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

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!customCursor || !preferences.editorCursorRipple || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = ++rippleSeq.current;
    setRipples((list) => [
      ...list.slice(-11),
      { id, x: event.clientX - rect.left, y: event.clientY - rect.top },
    ]);
  }

  function dropRipple(id: number): void {
    setRipples((list) => list.filter((ripple) => ripple.id !== id));
  }

  return (
    <div
      className={`app-shell${immersive ? ' editor-immersive' : ''}`}
      style={{ cursor: appCursorCss(preferences.editorCursor) }}
      onPointerDown={handlePointerDown}
    >
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="app-cursor-ripple"
          style={{ left: ripple.x, top: ripple.y }}
          onAnimationEnd={() => dropRipple(ripple.id)}
        />
      ))}
      <TooltipEnhancer />
      <header className="topbar">
        <div className="topbar-brand" title="Olyvia" data-tour="brand">
          <img src="/olyvia-mark.png" alt="" />
          <span>Olyvia</span>
        </div>
        {onReturnToStart ? (
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
        ) : null}
        {/* UN SOLO EDITOR: no existe un botón que saque de la superficie de
            edición. «Inicio» es un PANEL dentro del editor, no una pantalla. */}
        {/* F4 (parcial): desde cualquier hub o herramienta hay un retorno
            persistente al editor, sin tener que volver a buscar la puerta. */}
        {project && !editorSurface ? (
          <button
            type="button"
            className="topbar-back-editor"
            aria-label="Volver al editor"
            data-tooltip="Volver al editor · la timeline sigue abierta"
            onClick={() => onSelect('editor')}
          >
            <Icon name="editor" size={13} />
            <span>Editor</span>
          </button>
        ) : null}
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
          {/* Puerta única: con proyecto abierto, TODAS las herramientas están
              en el mapa del editor, disponible desde cualquier superficie. */}
          {immersive && project ? (
            <button
              type="button"
              className="topbar-ai-btn"
              aria-label="Abrir edición con IA"
              data-tooltip="Abrir el asistente dentro del editor"
              onClick={() => window.dispatchEvent(new Event('olyvia:assistant-open'))}
            >
              <Icon name="sparkles" size={14} />
              <span>Edición IA</span>
            </button>
          ) : null}
          {project && onOpenToolMap ? (
            <button
              type="button"
              className="icon-button topbar-tool-map-btn"
              aria-label="Mapa de herramientas"
              data-tooltip="Todas las herramientas dentro del editor"
              onClick={onOpenToolMap}
            >
              <Icon name="grid" size={15} />
              <span>Herramientas</span>
            </button>
          ) : null}
          {/* Layout del editor (paridad `paineis.js` de AlaukCut): el mismo
              grid redistribuido — estándar o columna vertical para Shorts. */}
          {immersive ? (
            <div className="topbar-layout" ref={layoutMenuRef}>
              <button
                type="button"
                className={`icon-button${layoutMenuOpen ? ' active' : ''}`}
                aria-label="Layout del editor"
                data-tooltip="Layout del editor"
                aria-expanded={layoutMenuOpen}
                aria-haspopup="menu"
                onClick={() => setLayoutMenuOpen((open) => !open)}
              >
                <Icon name="layout" size={16} />
              </button>
              {layoutMenuOpen ? (
                <div className="layout-menu" role="menu" aria-label="Layouts del editor">
                  <LayoutOption
                    layout="padrao"
                    current={editorLayout}
                    onPick={(layout) => {
                      setEditorLayout(layout);
                      setLayoutMenuOpen(false);
                    }}
                  />
                  <LayoutOption
                    layout="shorts"
                    current={editorLayout}
                    onPick={(layout) => {
                      setEditorLayout(layout);
                      setLayoutMenuOpen(false);
                    }}
                  />
                  <LayoutOption
                    layout="edicion"
                    current={editorLayout}
                    onPick={(layout) => {
                      setEditorLayout(layout);
                      setLayoutMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
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
          <span><SafeText value={error} /></span>
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

/**
 * Opción del menú de layout con miniatura SVG (paridad de las
 * `.layout-thumb` de AlaukCut: el dibujo ES la explicación).
 */
function LayoutOption({
  layout,
  current,
  onPick,
}: {
  readonly layout: EditorLayout;
  readonly current: EditorLayout;
  readonly onPick: (layout: EditorLayout) => void;
}) {
  const active = layout === current;
  const isShorts = layout === 'shorts';
  const isEdicion = layout === 'edicion';
  const label = isShorts ? 'Vertical (Shorts)' : isEdicion ? 'Edición con IA' : 'Estándar';
  const hint = isShorts
    ? 'Monitor a la derecha, para 9:16'
    : isEdicion
      ? 'Columna de IA a la derecha'
      : 'Biblioteca · monitor · inspector';
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`layout-opcion${active ? ' activo' : ''}`}
      onClick={() => onPick(layout)}
    >
      <svg className="layout-thumb" viewBox="0 0 96 54" aria-hidden="true">
        {/* barra del topo */}
        <rect className="lt-topo" x="0" y="0" width="96" height="6" rx="2" />
        {isShorts ? (
          <>
            {/* biblioteca + inspector a la izquierda/centro, monitor 9:16 a
                la derecha a toda la altura, timeline abajo sólo bajo ellos */}
            <rect className="lt-painel" x="2" y="8" width="20" height="28" rx="1.5" />
            <rect className="lt-painel" x="24" y="8" width="44" height="28" rx="1.5" />
            <rect className="lt-pantalla" x="70" y="8" width="24" height="44" rx="1.5" />
            <rect className="lt-timeline" x="2" y="40" width="68" height="12" rx="1.5" />
          </>
        ) : isEdicion ? (
          <>
            {/* biblioteca | monitor | inspector | IA a toda la altura;
                la timeline pasa por debajo de todo menos la columna IA */}
            <rect className="lt-painel" x="2" y="8" width="18" height="28" rx="1.5" />
            <rect className="lt-pantalla" x="22" y="8" width="36" height="28" rx="1.5" />
            <rect className="lt-painel" x="60" y="8" width="14" height="28" rx="1.5" />
            <rect className="lt-ia" x="76" y="8" width="18" height="44" rx="1.5" />
            <rect className="lt-timeline" x="2" y="38" width="72" height="14" rx="1.5" />
          </>
        ) : (
          <>
            <rect className="lt-painel" x="2" y="8" width="26" height="28" rx="1.5" />
            <rect className="lt-pantalla" x="30" y="8" width="34" height="28" rx="1.5" />
            <rect className="lt-painel" x="66" y="8" width="28" height="28" rx="1.5" />
            <rect className="lt-timeline" x="2" y="38" width="92" height="14" rx="1.5" />
          </>
        )}
      </svg>
      <span className="layout-opcion-txt">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </button>
  );
}
