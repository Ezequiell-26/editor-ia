import { Fragment, memo, lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ViewId } from '../../app/navigation';
import { NAV_VIEWS } from '../../app/navigation';
import type { EditorModeId } from '../../app/view-routing';
import { Icon } from '../../components/Icon';
import { WorkspaceGuide } from '../../components/WorkspaceGuide';
import { EditorToolMap } from './EditorToolMap';
import { usePipeline } from '../../state/usePipeline';
import {
  ProjectActionError,
  deleteCaptionCue,
  deleteClip,
  fpsOf,
  moveClip,
  splitClip,
  totalFrames,
  trimClip,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import {
  clipKeyboardAction,
  nearestCompatibleTrack,
  type ClipKeyboardAction,
} from './timeline-keyboard';
import { Preview } from './Preview';
import { Transport } from './Transport';
import { usePlayback } from './usePlayback';
import {
  DetachedPreviewTitlebar,
  EditorImportGuide,
  PerformanceNotice,
  performanceNoticeDismissed,
  useDraggableWindow,
} from './FilmoraStates';

const loadAssets = () =>
  import('./EditorAssets').then((module) => ({ default: module.EditorAssets }));
const loadInspector = () =>
  import('./Inspector').then((module) => ({ default: module.Inspector }));
const loadTimeline = () => import('./Timeline').then((module) => ({ default: module.Timeline }));
const loadExportDialog = () =>
  import('./ExportDialog').then((module) => ({ default: module.ExportDialog }));
const loadTextEdit = () =>
  import('../text-edit/TextEditView').then((module) => ({ default: module.TextEditView }));
const loadMulticam = () =>
  import('../multicam/MulticamView').then((module) => ({ default: module.MulticamView }));
const loadMixer = () =>
  import('../mixer/MixerView').then((module) => ({ default: module.MixerView }));
const loadVfx = () =>
  import('../vfx/VfxView').then((module) => ({ default: module.VfxView }));
const loadMotion = () =>
  import('../motion/MotionView').then((module) => ({ default: module.MotionView }));
const loadVisuals = () =>
  import('../visuals/VisualsView').then((module) => ({ default: module.VisualsView }));
const loadBrain = () =>
  import('../brain/BrainPanel').then((module) => ({ default: module.BrainPanel }));
// F2: las seis vistas de flujo se cargan bajo demanda SÓLO cuando el usuario
// abre su modo. Sin proyecto siguen siendo pantallas standalone (App.tsx).
const loadScript = () =>
  import('../script/ScriptView').then((module) => ({ default: module.ScriptView }));
const loadAssetsPanel = () =>
  import('../assets/AssetsPanel').then((module) => ({ default: module.AssetsPanel }));
const loadProduction = () =>
  import('../production/ProductionView').then((module) => ({ default: module.ProductionView }));
const loadDirector = () =>
  import('../director/DirectorView').then((module) => ({ default: module.DirectorView }));
const loadAutoEdit = () =>
  import('../autoedit/AutoEditView').then((module) => ({ default: module.AutoEditView }));
const loadAiHub = () =>
  import('../ai-hub/AiHubView').then((module) => ({ default: module.AiHubView }));
// T2: hosts de herramientas. Se cargan SÓLO al abrir su panel desde el mapa;
// sin proyecto App.tsx sigue usando sus propias vistas standalone.
const loadHome = () =>
  import('../home/HomeView').then((module) => ({ default: module.HomeView }));
const loadProjects = () =>
  import('../projects/ProjectHome').then((module) => ({ default: module.ProjectHome }));
const loadDownloadHub = () =>
  import('../download/DownloadsHubView').then((module) => ({ default: module.DownloadsHubView }));
const loadCreatorHub = () =>
  import('../creator/CreatorHubView').then((module) => ({ default: module.CreatorHubView }));
const loadLabHub = () =>
  import('../lab/MediaLabView').then((module) => ({ default: module.MediaLabView }));
const loadLearn = () =>
  import('../learn/LearnView').then((module) => ({ default: module.LearnView }));
const loadMcp = () =>
  import('../mcp/McpView').then((module) => ({ default: module.McpView }));

const EditorAssets = lazy(loadAssets);
const Inspector = lazy(loadInspector);
const Timeline = lazy(loadTimeline);
const ExportDialog = lazy(loadExportDialog);
const TextEditView = lazy(loadTextEdit);
const MulticamView = lazy(loadMulticam);
const MixerView = lazy(loadMixer);
const VfxView = lazy(loadVfx);
const MotionView = lazy(loadMotion);
const VisualsView = lazy(loadVisuals);
const BrainPanel = lazy(loadBrain);
const ScriptView = lazy(loadScript);
const AssetsPanel = lazy(loadAssetsPanel);
const ProductionView = lazy(loadProduction);
const DirectorView = lazy(loadDirector);
const AutoEditView = lazy(loadAutoEdit);
const AiHubView = lazy(loadAiHub);
const HomeView = lazy(loadHome);
const ProjectHome = lazy(loadProjects);
const DownloadsHubView = lazy(loadDownloadHub);
const CreatorHubView = lazy(loadCreatorHub);
const MediaLabView = lazy(loadLabHub);
const LearnView = lazy(loadLearn);
const McpView = lazy(loadMcp);

type EditorMode = EditorModeId;
type EditorModeGroup = 'flujo' | 'herramientas';

/**
 * T2 · 16 modos en DOS bloques. «Todo» es la puerta única al mapa de las 33
 * herramientas. El separador es visual, no una superficie nueva: sigue siendo
 * un único `role="tablist"` y la timeline sigue montada. Los contratos de
 * tests ('Mezcla', 'Edición', 'Motion', 'Guía') se conservan.
 */
const EDITOR_MODES: readonly {
  readonly id: EditorMode;
  readonly label: string;
  readonly hint: string;
  readonly group: EditorModeGroup;
}[] = [
  { id: 'timeline', label: 'Edición', hint: 'Timeline, preview e inspector', group: 'flujo' },
  { id: 'tools', label: 'Todo', hint: 'Todas las herramientas en un mapa con buscador', group: 'flujo' },
  { id: 'script', label: 'Guion', hint: 'Escenas, narración y asistente, sin salir del editor', group: 'flujo' },
  { id: 'assets', label: 'Medios', hint: 'Biblioteca multimedia y licencias, sin salir del editor', group: 'flujo' },
  { id: 'production', label: 'Producción', hint: 'Voz por escena y montaje automático', group: 'flujo' },
  { id: 'director', label: 'Director', hint: 'Análisis medido, cortes y shorts', group: 'flujo' },
  { id: 'auto-edit', label: 'Automático', hint: 'Variantes editables analizadas localmente', group: 'flujo' },
  { id: 'ai-hub', label: 'AI Hub', hint: 'Prompts, briefs y operador local', group: 'flujo' },
  { id: 'guide', label: 'Guía', hint: 'Los seis pasos y el mapa del estudio, sin salir del editor', group: 'flujo' },
  { id: 'brain', label: 'Cerebro', hint: 'Mide la timeline y propone cortes con motivo', group: 'herramientas' },
  { id: 'text-edit', label: 'Texto', hint: 'Transcribir y cortar desde las frases', group: 'herramientas' },
  { id: 'multicam', label: 'Multicámara', hint: 'Sincronizar cámaras y cambiar de ángulo', group: 'herramientas' },
  { id: 'mixer', label: 'Mezcla', hint: 'Ganancia, paneo y EQ por pista', group: 'herramientas' },
  { id: 'vfx', label: 'VFX', hint: 'Nodos, rotoscopía y seguimiento', group: 'herramientas' },
  { id: 'motion', label: 'Motion', hint: 'Títulos y gráficos en movimiento', group: 'herramientas' },
  { id: 'visuals', label: 'Efectos', hint: 'Presets, transiciones y auditoría visual', group: 'herramientas' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Reservas de layout mientras llegan los chunks de los paneles. Conservan el
 * landmark y el ancho de cada columna para que el montaje no salte.
 */
function AssetsFallback() {
  return (
    <aside
      className="asset-rail"
      aria-label="Herramientas y biblioteca del editor"
      aria-busy="true"
    >
      <div className="view-loading panel-loading" aria-hidden="true">
        <span className="view-loading-dot" />
      </div>
    </aside>
  );
}

function InspectorFallback() {
  return (
    <aside className="inspector" aria-label="Detalles" aria-busy="true">
      <div className="inspector-head">
        <h3>Detalles</h3>
      </div>
      <div className="view-loading panel-loading" aria-hidden="true">
        <span className="view-loading-dot" />
      </div>
    </aside>
  );
}

function TimelineFallback() {
  return (
    <div className="view-loading" aria-hidden="true">
      <span className="view-loading-dot" />
    </div>
  );
}

// Inspector derecho redimensionable (patrón CapCut/Filmora): el ancho se
// persiste por equipo y el divisor es accesible por puntero y teclado.
const INSPECTOR_WIDTH_KEY = 'editoria.inspector-width.v1';
// 388 px sitúan el borde del inspector en x 972, medido a píxel en las
// capturas 93–137 a 1360 px. El divisor sigue siendo real (280–560).
const INSPECTOR_WIDTH_DEFAULT = 388;
const INSPECTOR_WIDTH_MIN = 280;
const INSPECTOR_WIDTH_MAX = 560;

function clampInspectorWidth(value: number): number {
  return Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, Math.round(value)));
}

function readInspectorWidth(): number {
  if (typeof window === 'undefined') return INSPECTOR_WIDTH_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampInspectorWidth(stored)
      : INSPECTOR_WIDTH_DEFAULT;
  } catch {
    return INSPECTOR_WIDTH_DEFAULT;
  }
}

export const EditorWorkspace = memo(function EditorWorkspace({
  onNavigate,
  initialMode = 'timeline',
  modeRequest = 0,
  onOpenTour,
  onOpenShortcuts,
  onModeChange,
  toolView,
  toolTab,
  toolRequest = 0,
  onClearTool,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly initialMode?: EditorModeId;
  readonly modeRequest?: number;
  readonly onOpenTour?: () => void;
  readonly onOpenShortcuts?: () => void;
  /** F2: sincroniza el rail con el modo elegido dentro del editor. */
  readonly onModeChange?: (mode: EditorModeId) => void;
  /** T2: host canónico a montar en el modo «Todo»; sin él se muestra el mapa. */
  readonly toolView?: ViewId;
  /** Pestaña inicial cuando el origen era un alias de hub. */
  readonly toolTab?: string;
  /** Contador para reabrir la misma herramienta y reaplicar su pestaña. */
  readonly toolRequest?: number;
  /** Vuelta al mapa desde el breadcrumb de la herramienta. */
  readonly onClearTool?: () => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const pipeline = usePipeline();
  const preferences = useEditorPreferences();
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  usePlayback();

  // Captura 109: el monitor puede desacoplarse a una ventana arrastrable y
  // volver a acoplarse. Captura 95: aviso de rendimiento descartable.
  const previewWindow = useDraggableWindow({ x: 420, y: 160 });
  const [previewDetached, setPreviewDetached] = useState(false);
  const [performanceNoticeOpen, setPerformanceNoticeOpen] = useState(
    () => !performanceNoticeDismissed(),
  );
  const [importGuideDismissed, setImportGuideDismissed] = useState(false);

  // Ancho del panel Detalles (persistido). El drag actualiza sólo este estado:
  // el timeline no se re-renderiza por mover el divisor.
  const [inspectorWidth, setInspectorWidth] = useState<number>(readInspectorWidth);
  const inspectorDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {
      // Sin almacenamiento: el ancho vale para esta sesión.
    }
  }, [inspectorWidth]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, modeRequest]);

  // T2: abrir una herramienta desde el mapa (o reabrir la misma) vuelve al
  // modo «Todo» aunque el usuario estuviera en otro tab del editor.
  useEffect(() => {
    if (toolView) setMode('tools');
  }, [toolView, toolRequest]);

  useEffect(() => {
    if (!store.state.exportRequested) return;
    setExportOpen(true);
    store.consumeExportRequest();
  }, [store.state.exportRequested, store.consumeExportRequest]);

  useEffect(() => {
    /**
     * Ejecuta una acción de clip pedida por teclado (fase 2 de accesibilidad).
     * Usa las mismas acciones de dominio que el arrastre (`moveClip`,
     * `trimClip`); si la acción no se puede aplicar (pista bloqueada, hueco
     * ocupado, ventana de origen agotada) avisa por el mismo canal que el
     * mouse: el error del store o un `notice`.
     */
    const runClipKeyboardAction = (action: ClipKeyboardAction, clipId: string): void => {
      const current = store.state.project;
      if (!current) return;
      const clip = current.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return;
      const owner = current.timeline.tracks.find((item) => item.id === clip.trackId);
      if (owner?.locked) {
        store.setNotice('La pista del clip está bloqueada; desbloqueala para moverla o recortarla.');
        return;
      }
      if (action.kind === 'move') {
        const target = clip.startFrame + action.deltaFrames;
        store.update((doc) => {
          const next = moveClip(doc, clipId, target);
          if (!next) {
            throw new ProjectActionError('no hay lugar libre para mover el clip a ese frame');
          }
          return next;
        });
        return;
      }
      if (action.kind === 'move-track') {
        const target = nearestCompatibleTrack(current, clip, action.direction);
        if (!target) {
          store.setNotice('No hay una pista compatible en esa dirección.');
          return;
        }
        store.update((doc) => {
          const next = moveClip(doc, clipId, clip.startFrame, target.id);
          if (!next) {
            throw new ProjectActionError(
              `no se pudo mover el clip a ${target.label}: la pista está bloqueada u ocupada en ese tramo`,
            );
          }
          return next;
        });
        return;
      }
      const target =
        action.edge === 'start'
          ? clip.startFrame + action.deltaFrames
          : clip.startFrame + clip.durationFrames + action.deltaFrames;
      store.update((doc) => {
        const next = trimClip(doc, clipId, action.edge, target);
        if (!next) {
          throw new ProjectActionError('ese recorte no es válido para la ventana de origen del clip');
        }
        return next;
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !project) return;
      const selection = store.state.selection;
      // Fase 2 de accesibilidad: mover y recortar el clip seleccionado con el
      // teclado (Alt = mover, Ctrl+Alt = recortar). Va antes del paso del
      // playhead: con un clip seleccionado las flechas con Alt editan el clip;
      // sin selección las flechas siguen moviendo el cabezal como siempre.
      const clipAction = clipKeyboardAction(event, fpsOf(project));
      if (clipAction && selection.kind === 'clip') {
        event.preventDefault();
        runClipKeyboardAction(clipAction, selection.id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.kind === 'clip') {
          event.preventDefault();
          let nextDuration = 0;
          store.update((current) => {
            const next = deleteClip(current, selection.id);
            nextDuration = totalFrames(next);
            return next;
          });
          store.setSelection({ kind: 'none' });
          store.setPlayhead(Math.min(store.getPlayhead(), nextDuration));
        } else if (selection.kind === 'cue') {
          event.preventDefault();
          store.update((current) => deleteCaptionCue(current, selection.id));
          store.setSelection({ kind: 'none' });
        }
      }
      if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
        if (selection.kind === 'clip') {
          event.preventDefault();
          store.mutate((current) => {
            const split = splitClip(current, selection.id, store.getPlayhead());
            if (!split) throw new Error('el playhead no está dentro del clip seleccionado');
            return { project: split.project, rightClipId: split.rightClipId };
          });
        }
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        // El paso base y el paso con Shift salen de Ajustes → Editor, así que
        // se puede trabajar frame a frame o saltos largos según el proyecto.
        const step = preferences.jumpStepFrames;
        const delta = event.shiftKey ? step * 10 : step;
        store.setPlaying(false);
        store.setPlayhead(store.getPlayhead() + (event.key === 'ArrowLeft' ? -delta : delta));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store, preferences.jumpStepFrames]);

  if (!project) {
    return (
      <section className="view editor-empty-view">
        <div className="editor-empty-card">
          <span className="editor-empty-eyebrow">Olyvia · Estudio de edición</span>
          <div className="editor-empty-icon" aria-hidden="true">
            <Icon name="film" size={24} />
          </div>
          <h2 className="editor-empty-title">Estudio de Edición de Video</h2>
          <p className="editor-empty-desc">
            Abrí un proyecto existente o creá uno nuevo en blanco para empezar a cortar y
            componer. No hay proyectos de demostración empaquetados: todo lo que ves en la
            timeline es material que importaste vos.
          </p>
          <div className="editor-empty-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void store.openProject()}
            >
              <Icon name="folder" size={15} />
              <span>Abrir proyecto</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => onNavigate('projects')}
            >
              <Icon name="plus" size={15} />
              <span>Nuevo proyecto</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => onNavigate('home')}
            >
              <Icon name="home" size={15} />
              <span>Volver a Inicio</span>
            </button>
          </div>
          {/* Antes había acá un cuarto recorrido de 3 pasos. Ahora es el mismo
              componente de seis etapas que Inicio, Aprender y el modo Guía. */}
          <div className="editor-empty-guide">
            <WorkspaceGuide
              onNavigate={onNavigate}
              progress={pipeline}
              compact
              currentView="editor"
              {...(onOpenTour ? { onOpenTour } : {})}
              {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
            />
          </div>
        </div>
      </section>
    );
  }

  const fps = fpsOf(project);
  const modeInfo = EDITOR_MODES.find((item) => item.id === mode) ?? EDITOR_MODES[0]!;

  function switchMode(next: EditorMode): void {
    setMode(next);
    onModeChange?.(next);
  }

  function navigateFromMode(id: ViewId): void {
    if (id === 'editor') {
      switchMode('timeline');
      return;
    }
    onNavigate(id);
  }

  // T2: en el modo «Todo» mostramos el mapa o, si ya se eligió una herramienta,
  // su componente real. Los tres hubs reciben la pestaña del alias de origen.
  const toolLabel = toolView
    ? NAV_VIEWS.find((view) => view.id === toolView)?.label ?? toolView
    : null;
  const toolContent = toolView ? (
    toolView === 'home' ? (
      <HomeView onNavigate={navigateFromMode} />
    ) : toolView === 'projects' ? (
      <ProjectHome onNavigate={navigateFromMode} />
    ) : toolView === 'download' ? (
      <DownloadsHubView
        onNavigate={navigateFromMode}
        {...(toolTab ? { initialTab: toolTab } : {})}
        requestId={toolRequest}
      />
    ) : toolView === 'creator' ? (
      <CreatorHubView
        onNavigate={navigateFromMode}
        {...(toolTab ? { initialTab: toolTab } : {})}
        requestId={toolRequest}
      />
    ) : toolView === 'lab' ? (
      <MediaLabView
        onNavigate={navigateFromMode}
        {...(toolTab ? { initialTab: toolTab } : {})}
        requestId={toolRequest}
      />
    ) : toolView === 'mcp' ? (
      <McpView />
    ) : toolView === 'learn' ? (
      <LearnView
        onNavigate={navigateFromMode}
        {...(onOpenTour ? { onOpenTour } : {})}
        {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
      />
    ) : (
      <EditorToolMap onNavigate={navigateFromMode} currentView={toolView} />
    )
  ) : (
    <EditorToolMap onNavigate={navigateFromMode} currentView="editor" />
  );

  const modeContent =
    mode === 'tools' ? (
      toolContent
    ) : mode === 'script' ? (
      <ScriptView onNavigate={navigateFromMode} />
    ) : mode === 'assets' ? (
      <AssetsPanel onNavigate={navigateFromMode} />
    ) : mode === 'production' ? (
      <ProductionView onNavigate={navigateFromMode} />
    ) : mode === 'director' ? (
      <DirectorView onNavigate={navigateFromMode} />
    ) : mode === 'auto-edit' ? (
      <AutoEditView onNavigate={navigateFromMode} />
    ) : mode === 'ai-hub' ? (
      <AiHubView onNavigate={navigateFromMode} />
    ) : mode === 'text-edit' ? (
      <TextEditView onNavigate={navigateFromMode} />
    ) : mode === 'multicam' ? (
      <MulticamView onNavigate={navigateFromMode} />
    ) : mode === 'mixer' ? (
      <MixerView onNavigate={navigateFromMode} />
    ) : mode === 'vfx' ? (
      <VfxView onNavigate={navigateFromMode} />
    ) : mode === 'motion' ? (
      <MotionView onNavigate={navigateFromMode} />
    ) : mode === 'visuals' ? (
      <VisualsView onNavigate={navigateFromMode} />
    ) : mode === 'brain' ? (
      <BrainPanel />
    ) : mode === 'guide' ? (
      <WorkspaceGuide
        onNavigate={navigateFromMode}
        progress={pipeline}
        compact
        currentView="editor"
        {...(onOpenTour ? { onOpenTour } : {})}
        {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
      />
    ) : null;

  return (
    <section className="editor-workspace">
      <nav className="editor-mode-tabs" role="tablist" aria-label="Modos de edición">
        {EDITOR_MODES.map((item, index) => {
          const firstTool = item.group === 'herramientas' && EDITOR_MODES[index - 1]?.group === 'flujo';
          return (
            <Fragment key={item.id}>
              {firstTool ? <span className="editor-mode-divider" aria-hidden="true" /> : null}
              <button
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                className={`editor-mode-tab${mode === item.id ? ' active' : ''}`}
                data-tooltip={item.hint}
                data-mode-group={item.group}
                onClick={() => switchMode(item.id)}
              >
                {item.label}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <div
        className={`editor-grid${mode !== 'timeline' ? ' editor-mode-active' : ''}`}
        style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}
      >
        {mode === 'timeline' ? (
          <>
            <Suspense fallback={<AssetsFallback />}>
              <EditorAssets
                onNavigate={onNavigate}
                emptyGuide={
                  project.assets.length === 0 && !importGuideDismissed ? (
                    <EditorImportGuide
                      onImport={() => onNavigate('assets')}
                      onDismiss={() => setImportGuideDismissed(true)}
                    />
                  ) : null
                }
              />
            </Suspense>
            <div
              className={`preview-panel${previewDetached ? ' is-detached' : ''}`}
              data-tour="preview"
              style={previewDetached ? previewWindow.style : undefined}
            >
              {/* Captura 109: barra de título arrastrable cuando se desacopla. */}
              {previewDetached ? (
                <DetachedPreviewTitlebar
                  onDock={() => setPreviewDetached(false)}
                  dragHandlers={previewWindow.handlers}
                >
                  Vista previa · {project.name}
                </DetachedPreviewTitlebar>
              ) : null}
              <Preview />
              <Transport />
              {/* Captura 95: la guía de importación vive en el panel de medios,
                  debajo del dropzone real. El monitor queda limpio y sin solapes. */}
              <button
                type="button"
                className="fm-preview-detach-toggle"
                aria-label={previewDetached ? 'Acoplar vista previa' : 'Desacoplar vista previa'}
                title={previewDetached ? 'Volver al panel del editor' : 'Abrir la vista previa en una ventana flotante'}
                onClick={() => setPreviewDetached((value) => !value)}
              >
                <Icon name={previewDetached ? 'restore' : 'maximize'} size={12} />
              </button>
            </div>
            <div
              className="editor-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Cambiar el ancho del panel Detalles"
              aria-valuemin={INSPECTOR_WIDTH_MIN}
              aria-valuemax={INSPECTOR_WIDTH_MAX}
              aria-valuenow={inspectorWidth}
              tabIndex={0}
              title="Arrastrá para cambiar el ancho de Detalles · doble clic para restablecer"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                inspectorDragRef.current = { startX: event.clientX, startWidth: inspectorWidth };
                document.body.classList.add('inspector-resizing');
                const move = (pointer: PointerEvent): void => {
                  const drag = inspectorDragRef.current;
                  if (!drag) return;
                  setInspectorWidth(
                    clampInspectorWidth(drag.startWidth - (pointer.clientX - drag.startX)),
                  );
                };
                const up = (): void => {
                  inspectorDragRef.current = null;
                  document.body.classList.remove('inspector-resizing');
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  window.removeEventListener('pointercancel', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
                window.addEventListener('pointercancel', up);
              }}
              onDoubleClick={() => setInspectorWidth(INSPECTOR_WIDTH_DEFAULT)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  setInspectorWidth((width) => clampInspectorWidth(width + 16));
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  setInspectorWidth((width) => clampInspectorWidth(width - 16));
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setInspectorWidth(INSPECTOR_WIDTH_DEFAULT);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setInspectorWidth(INSPECTOR_WIDTH_MAX);
                }
              }}
            />
            <Suspense fallback={<InspectorFallback />}>
              <Inspector />
            </Suspense>
          </>
        ) : (
          <div className="editor-mode-panel" role="tabpanel" aria-label={modeInfo.label}>
            {/* Contexto explícito: el usuario siempre sabe que sigue dentro del
                editor y tiene un camino directo de vuelta a la timeline. */}
            <div className="editor-mode-context">
              <span className="editor-mode-crumb">
                <Icon name="editor" size={12} />
                Editor
                <span aria-hidden="true">›</span>
                <strong>{mode === 'tools' ? 'Todo' : modeInfo.label}</strong>
                {mode === 'tools' && toolLabel ? (
                  <>
                    <span aria-hidden="true">›</span>
                    <strong>{toolLabel}</strong>
                  </>
                ) : null}
              </span>
              <span className="editor-mode-context-hint">
                {mode === 'tools' && toolView
                  ? 'Herramienta abierta dentro del editor · la timeline sigue visible'
                  : modeInfo.hint}
              </span>
              {mode === 'tools' && toolView ? (
                <button
                  type="button"
                  className="ghost small editor-mode-back"
                  onClick={() => onClearTool?.()}
                >
                  <Icon name="grid" size={12} />
                  Volver al mapa
                </button>
              ) : null}
              <button
                type="button"
                className="ghost small editor-mode-back"
                onClick={() => switchMode('timeline')}
              >
                <Icon name="restore" size={12} />
                Volver a Edición
              </button>
            </div>
            <div className="editor-mode-content">
              <Suspense fallback={<TimelineFallback />}>{modeContent}</Suspense>
            </div>
          </div>
        )}
        <div className="timeline-panel" data-tour="timeline">
          <div className="timeline-tabs" role="tablist" aria-label="Secuencias de la timeline">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'timeline'}
              className={mode === 'timeline' ? 'active' : ''}
              title="Volver a la secuencia principal (modo Edición)"
              onClick={() => switchMode('timeline')}
            >
              Timeline 01
            </button>
            <span className="timeline-tabs-meta">
              {project.name} · {(totalFrames(project) / fps).toFixed(1)} s
            </span>
          </div>
          <Suspense fallback={<TimelineFallback />}>
            <Timeline />
          </Suspense>
        </div>
      </div>

      {/* Captura 95: aviso de rendimiento en el editor vacío. Es un toast
          descartable, no un modal, y su cierre puede persistirse. */}
      {performanceNoticeOpen && project.assets.length === 0 && mode === 'timeline' ? (
        <PerformanceNotice onDismiss={() => setPerformanceNoticeOpen(false)} />
      ) : null}

      {exportOpen ? (
        <Suspense fallback={null}>
          <ExportDialog open onClose={() => setExportOpen(false)} />
        </Suspense>
      ) : null}
    </section>
  );
});
