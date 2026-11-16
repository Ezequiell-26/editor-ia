import { Fragment, memo, lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ViewId } from '../../app/navigation';
import { NAV_VIEWS } from '../../app/navigation';
import type { EditorModeId } from '../../app/view-routing';
import { Icon } from '../../components/Icon';
import { openDualMonitorWindow } from '../../platform/tauri/dual-monitor';
import { WorkspaceGuide } from '../../components/WorkspaceGuide';
import { EditorToolMap } from './EditorToolMap';
import { usePipeline } from '../../state/usePipeline';
import {
  ProjectActionError,
  addMotionGraphic,
  deleteCaptionCue,
  deleteClip,
  fpsOf,
  moveClip,
  removeTransformKeyframe,
  splitClip,
  totalFrames,
  trimClip,
  updateClip,
  updateProjectSettings,
} from '../../state/project-actions';
import { useEditorLayout } from '../../state/editor-layout';
import { setAiColumnElement } from '../../state/ai-column';
import type {
  ClipInspectorTab,
  InspectorTabRequest,
} from '../../state/inspector-tab-command';
import { templateById } from '../../state/motion-templates';
import {
  getSelectedKeyframe,
  setSelectedKeyframe,
} from '../../state/keyframe-selection';
import {
  getSelectedTransition,
  setSelectedTransition,
} from '../../state/transition-selection';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import {
  SHORTCUTS_CHANGED_EVENT,
  bindingMatches,
  loadShortcuts,
  type ShortcutMap,
} from '../../state/shortcuts';
import {
  clipKeyboardAction,
  nearestCompatibleTrack,
  type ClipKeyboardAction,
} from './timeline-keyboard';
import { Preview } from './Preview';
import { AlaukFooter, AlaukTopBar } from './AlaukChrome';
import { editorSurfaceClass } from './editor-surface';
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
const loadNodes = () =>
  import('../nodes/NodeGraphView').then((module) => ({ default: module.NodeGraphView }));
// UN SOLO EDITOR: Ajustes también es un panel del editor, no una ventana.
const loadSettings = () =>
  import('../settings/SettingsHome').then((module) => ({ default: module.SettingsHome }));

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
const NodeGraphView = lazy(loadNodes);
const SettingsHome = lazy(loadSettings);

type EditorMode = EditorModeId;
type EditorModeGroup = 'flujo' | 'herramientas';

/**
 * Modos secundarios del workspace. La edición principal usa los módulos del rail;
 * «Todo» mantiene la puerta única al mapa de herramientas. La timeline sigue
 * montada al abrir una herramienta y los modos conservan sus rutas internas.
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
  { id: 'vfx', label: 'VFX', hint: 'Rotoscopía, máscaras y seguimiento', group: 'herramientas' },
  { id: 'nodes', label: 'Nodos', hint: 'Grafo visual de efectos, audio y render', group: 'herramientas' },
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

/** Pestañas de modo del editor; compartidas por la vista con y sin proyecto. */
function EditorModeTabs({
  mode,
  onSwitchMode,
}: {
  readonly mode: EditorMode;
  readonly onSwitchMode: (mode: EditorMode) => void;
}) {
  return (
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
              onClick={() => onSwitchMode(item.id)}
            >
              {item.label}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Estado vacío del editor: mismo contenido de antes, ahora dentro del shell. */
function EditorEmptyState({
  onNavigate,
  onOpenTour,
  onOpenShortcuts,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly onOpenTour?: () => void;
  readonly onOpenShortcuts?: () => void;
}) {
  const store = useProjectStore();
  const pipeline = usePipeline();
  return (
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
  );
}

/**
 * Modos que pueden renderizar su contenido real sin proyecto abierto:
 * «Todo» y «Guía» son superficies del propio editor, y las seis vistas de
 * flujo ya traen su empty-state honesto (antes eran standalone).
 */
const PROJECT_OPTIONAL_MODES: ReadonlySet<EditorMode> = new Set<EditorMode>([
  'tools',
  'guide',
  'script',
  'assets',
  'production',
  'director',
  'auto-edit',
  'ai-hub',
]);

/** Modos que necesitan un proyecto abierto; sin él se explica y se ofrece la puerta. */
function EditorNeedsProject({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  return (
    <div className="editor-empty-card editor-needs-project">
      <div className="editor-empty-icon" aria-hidden="true">
        <Icon name="film" size={24} />
      </div>
      <h2 className="editor-empty-title">Esta herramienta necesita un proyecto</h2>
      <p className="editor-empty-desc">
        Las vistas de flujo y los modos de edición trabajan sobre el proyecto
        abierto. Abrí uno existente o creá uno nuevo para seguir.
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
      </div>
    </div>
  );
}

// Inspector derecho redimensionable (patrón CapCut/Filmora): el ancho se
// persiste por equipo y el divisor es accesible por puntero y teclado.
const INSPECTOR_WIDTH_KEY = 'editoria.inspector-width.v1';
// 388 px sitúan el borde del inspector en x 972, medido a píxel en las
// capturas 93–137 a 1360 px. El divisor sigue siendo real (280–560).
const INSPECTOR_WIDTH_DEFAULT = 340;
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

// En «Vertical (Shorts)」el divisor pasa a redimensionar la columna del
// monitor (la pieza que queda a su derecha), no el inspector: el inspector
// ocupa el `1fr` central y no tiene ancho propio en ese layout.
const MONITOR_WIDTH_KEY = 'editoria.shorts-monitor-width.v1';
const MONITOR_WIDTH_DEFAULT = 420;
const MONITOR_WIDTH_MIN = 300;
const MONITOR_WIDTH_MAX = 640;

function clampMonitorWidth(value: number): number {
  return Math.min(MONITOR_WIDTH_MAX, Math.max(MONITOR_WIDTH_MIN, Math.round(value)));
}

function readMonitorWidth(): number {
  if (typeof window === 'undefined') return MONITOR_WIDTH_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(MONITOR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampMonitorWidth(stored)
      : MONITOR_WIDTH_DEFAULT;
  } catch {
    return MONITOR_WIDTH_DEFAULT;
  }
}

// Layout «Edición»: la columna de IA del borde derecho (paridad `--larg-ia`
// de AlaukCut) también es redimensionable con su propio divisor.
const IA_WIDTH_KEY = 'editoria.ia-width.v1';
const IA_WIDTH_DEFAULT = 320;
const IA_WIDTH_MIN = 300;
const IA_WIDTH_MAX = 560;

function clampIaWidth(value: number): number {
  return Math.min(IA_WIDTH_MAX, Math.max(IA_WIDTH_MIN, Math.round(value)));
}

function readIaWidth(): number {
  if (typeof window === 'undefined') return IA_WIDTH_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(IA_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampIaWidth(stored)
      : IA_WIDTH_DEFAULT;
  } catch {
    return IA_WIDTH_DEFAULT;
  }
}

/**
 * Divisor vertical de panel (patrón CapCut/Filmora/AlaukCut): arrastre por
 * puntero, flechas/Home/End por teclado y doble clic para restablecer. Cada
 * instancia tiene su propio estado de arrastre.
 */
function EditorSplitter({
  value,
  min,
  max,
  defaultValue,
  label,
  hint,
  className,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly label: string;
  readonly hint: string;
  readonly className?: string;
  readonly onChange: (width: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const clamp = (width: number): number =>
    Math.min(max, Math.max(min, Math.round(width)));
  return (
    <div
      className={`editor-splitter${className ? ` ${className}` : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title={`${hint} · doble clic para restablecer`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { startX: event.clientX, startWidth: value };
        document.body.classList.add('inspector-resizing');
        const move = (pointer: PointerEvent): void => {
          const drag = dragRef.current;
          if (!drag) return;
          onChange(clamp(drag.startWidth - (pointer.clientX - drag.startX)));
        };
        const up = (): void => {
          dragRef.current = null;
          document.body.classList.remove('inspector-resizing');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(event) => {
        // Las flechas mueven el playhead y Home/End saltan a los extremos
        // (handlers globales del editor): al ajustar el ancho del panel no
        // deben disparar esos atajos.
        event.stopPropagation();
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(clamp(value + 16));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(clamp(value - 16));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(defaultValue);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(max);
        }
      }}
    />
  );
}

export const EditorWorkspace = memo(function EditorWorkspace({
  onNavigate,
  initialMode = 'timeline',
  modeRequest = 0,
  onOpenTour,
  onOpenShortcuts,
  onOpenPalette,
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
  /** Paleta de comandos — la topbar global se oculta en modo timeline AlaukCut. */
  readonly onOpenPalette?: () => void;
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
  // Monitor persistente en los modos de herramienta: se puede plegar para
  // darle todo el ancho a vistas anchas (nodos, multicam) sin salir del modo.
  const [modeMonitorHidden, setModeMonitorHidden] = useState(false);
  const [performanceNoticeOpen, setPerformanceNoticeOpen] = useState(
    () => !performanceNoticeDismissed(),
  );
  const [importGuideDismissed, setImportGuideDismissed] = useState(false);

  // Ancho del panel Detalles (persistido). El drag actualiza sólo este estado:
  // el timeline no se re-renderiza por mover el divisor.
  const [inspectorWidth, setInspectorWidth] = useState<number>(readInspectorWidth);
  const [monitorWidth, setMonitorWidth] = useState<number>(readMonitorWidth);
  const [iaWidth, setIaWidth] = useState<number>(readIaWidth);
  const [aiColumnCollapsed, setAiColumnCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' &&
        window.localStorage.getItem('editoria.ai-column-collapsed.v1') === 'true';
    } catch {
      return false;
    }
  });
  const editorLayout = useEditorLayout();
  // Paridad `escolherLayout` de AlaukCut: entrar a «Vertical (Shorts)» cambia
  // el lienzo a 9:16 si el proyecto es horizontal, y al salir se restaura el
  // tamaño anterior (sólo si el cambio lo hizo este layout, no el usuario).
  const layoutFormatBackup = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!project || mode !== 'timeline') return;
    const backup = layoutFormatBackup.current;
    if (editorLayout === 'shorts') {
      if (project.video.width > project.video.height && !backup) {
        layoutFormatBackup.current = { width: project.video.width, height: project.video.height };
        store.update((current) =>
          updateProjectSettings(current, { width: 1080, height: 1920 }),
        );
      }
    } else if (backup) {
      layoutFormatBackup.current = null;
      store.update((current) => updateProjectSettings(current, backup));
    }
  }, [editorLayout, project, mode, store]);

  // El divisor siempre redimensiona la pieza que tiene a su derecha: en
  // «Estándar」es el inspector; en «Vertical (Shorts)」es la columna del
  // monitor (paridad de los divisores `divP`/`divisor` de AlaukCut).
  const shortsLayout = mode === 'timeline' && editorLayout === 'shorts';
  const splitterWidth = shortsLayout ? monitorWidth : inspectorWidth;
  const splitterMin = shortsLayout ? MONITOR_WIDTH_MIN : INSPECTOR_WIDTH_MIN;
  const splitterMax = shortsLayout ? MONITOR_WIDTH_MAX : INSPECTOR_WIDTH_MAX;
  const splitterDefault = shortsLayout ? MONITOR_WIDTH_DEFAULT : INSPECTOR_WIDTH_DEFAULT;
  const splitterLabel = shortsLayout
    ? 'Cambiar el ancho del monitor'
    : 'Cambiar el ancho del panel Detalles';
  const edicionLayout = mode === 'timeline' && editorLayout === 'edicion';

  useEffect(() => {
    try {
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {
      // Sin almacenamiento: el ancho vale para esta sesión.
    }
  }, [inspectorWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MONITOR_WIDTH_KEY, String(monitorWidth));
    } catch {
      // Sin almacenamiento: el ancho vale para esta sesión.
    }
  }, [monitorWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(IA_WIDTH_KEY, String(iaWidth));
    } catch {
      // Sin almacenamiento: el ancho vale para esta sesión.
    }
  }, [iaWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('editoria.ai-column-collapsed.v1', String(aiColumnCollapsed));
    } catch {
      // La preferencia sólo afecta la disposición visual.
    }
  }, [aiColumnCollapsed]);

  // Al abrir el asistente desde la barra superior, despliega primero su columna.
  useEffect(() => {
    const revealAiColumn = (): void => {
      setMode('timeline');
      setAiColumnCollapsed(false);
    };
    window.addEventListener('olyvia:assistant-open', revealAiColumn);
    return () => window.removeEventListener('olyvia:assistant-open', revealAiColumn);
  }, []);

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

  // Bindings vigentes de Ajustes → Atajos (S divide, flechas mueven el
  // playhead, Alt+flechas editan el clip). El listener se engancha una vez y
  // lee el mapa desde la ref en cada pulsación.
  const shortcutsRef = useRef<ShortcutMap>(loadShortcuts());
  useEffect(() => {
    const refresh = (): void => {
      shortcutsRef.current = loadShortcuts();
    };
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

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
      const clipAction = clipKeyboardAction(event, fpsOf(project), shortcutsRef.current);
      if (clipAction && selection.kind === 'clip') {
        event.preventDefault();
        runClipKeyboardAction(clipAction, selection.id);
        return;
      }
      // «D» además de Supr/Retroceso: el atajo `excluirPeloAtalho` de
      // AlaukCut también se dispara con la letra D (paridad `atalhos.js`).
      // Sin Ctrl/Alt/Cmd: Ctrl+D es duplicar clip, no borrar.
      const bareDeleteKey =
        (event.key === 'd' || event.key === 'D') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey;
      if (
        event.key === 'Delete' ||
        event.key === 'Backspace' ||
        bareDeleteKey
      ) {
        // Delete contextual (paridad `excluirPeloAtalho` de AlaukCut): una
        // clave de transformación seleccionada en el inspector tiene
        // prioridad sobre el clip, la transición y el marcador.
        const keyframeRef = getSelectedKeyframe();
        if (keyframeRef) {
          const keyframeClip = project.timeline.clips.find(
            (item) => item.id === keyframeRef.clipId,
          );
          const hasKeyframe = keyframeClip?.transform?.keyframes?.some(
            (item) => item.frame === keyframeRef.frame,
          );
          if (keyframeClip && hasKeyframe) {
            event.preventDefault();
            store.update((current) =>
              removeTransformKeyframe(current, keyframeRef.clipId, keyframeRef.frame),
            );
            setSelectedKeyframe(null);
            store.setNotice('Clave de movimiento eliminada.');
            return;
          }
          // Referencia vieja (clip borrado o clave ya quitada): limpiar y
          // seguir con el borrado normal.
          setSelectedKeyframe(null);
        }
        // Nivel «transición» del delete contextual (paridad
        // `excluirPeloAtalho`): una transición de entrada seleccionada en la
        // timeline se borra sin tocar el clip que la lleva.
        const transitionRef = getSelectedTransition();
        if (transitionRef) {
          const transitionClip = project.timeline.clips.find(
            (item) => item.id === transitionRef.clipId,
          );
          const hasTransition =
            transitionClip !== undefined &&
            'transitionIn' in transitionClip &&
            transitionClip.transitionIn !== undefined;
          if (transitionClip && hasTransition) {
            event.preventDefault();
            try {
              store.update((current) =>
                updateClip(current, transitionRef.clipId, { transitionIn: {} }),
              );
              setSelectedTransition(null);
              store.setNotice('Transición eliminada.');
            } catch {
              setSelectedTransition(null);
            }
            return;
          }
          setSelectedTransition(null);
        }
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
      if (bindingMatches(event, shortcutsRef.current['timeline.insertSolid'])) {
        event.preventDefault();
        const template = templateById('solid-frame');
        if (template) {
          try {
            store.mutate((current) => ({
              project: addMotionGraphic(current, {
                templateId: template.id,
                templateVersion: template.version,
                props: { color: '#ffffff' },
                durationFrames: Math.round(3 * fpsOf(current)),
                atFrame: store.getPlayhead(),
              }).project,
            }));
            store.setNotice('Cuadro sólido insertado.');
          } catch {
            store.setNotice('No se pudo insertar el cuadro sólido.');
          }
        }
      }
      if (bindingMatches(event, shortcutsRef.current['timeline.splitAtPlayhead'])) {
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

  // Pedido de pestaña del inspector («Paleta de colores»/«Recortar»/«Duración»/
  // «Editar» de la barra rápida y «Más herramientas»). El nonce hace que
  // pedidos repetidos a la misma pestaña vuelvan a aplicarse; el inspector
  // lo consume una sola vez. `subTab` pide una subpestaña concreta.
  // (Antes del early return de `!project`: son hooks.)
  const inspectorTabNonce = useRef(0);
  const [inspectorTabRequest, setInspectorTabRequest] =
    useState<InspectorTabRequest | null>(null);
  const requestInspectorTab = useCallback(
    (tab: ClipInspectorTab, subTab?: string) => {
      if (mode !== 'timeline') switchMode('timeline');
      inspectorTabNonce.current += 1;
      setInspectorTabRequest({
        tab,
        ...(subTab === undefined ? {} : { subTab }),
        nonce: inspectorTabNonce.current,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- switchMode es
    // estable por render y depende sólo de setMode/onModeChange.
    [mode],
  );

  // UN SOLO EDITOR: ya no hay una superficie paralela para «sin proyecto».
  // El early return viejo se reemplazó por el bloque `!project` que está
  // más abajo, después de `modeContent`: conserva las pestañas de modo y
  // deja las herramientas funcionando (el estado vacío es un modo más).

  const fps = project ? fpsOf(project) : 30;
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
    ) : toolView === 'settings' ? (
      <SettingsHome onNavigate={navigateFromMode} />
    ) : toolView === 'learn' ? (
      <LearnView
        onNavigate={navigateFromMode}
        {...(onOpenTour ? { onOpenTour } : {})}
        {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
      />
    ) : (
      <EditorToolMap
        onNavigate={navigateFromMode}
        currentView={toolView}
        currentMode={mode}
        onSwitchMode={switchMode}
      />
    )
  ) : (
    <EditorToolMap
      onNavigate={navigateFromMode}
      currentView="editor"
      currentMode={mode}
      onSwitchMode={switchMode}
    />
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
    ) : mode === 'nodes' ? (
      <NodeGraphView onNavigate={navigateFromMode} />
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

  // UN SOLO EDITOR · sin proyecto: las pestañas de modo siguen visibles y
  // cada modo muestra lo que puede hacer sin documento — la tarjeta vacía
  // (Edición), las herramientas reales (Todo/Guía) o el aviso de que la
  // vista de flujo necesita un proyecto. Nunca una pantalla paralela.
  if (!project) {
    const crumbTool =
      mode === 'tools' && toolView
        ? (NAV_VIEWS.find((view) => view.id === toolView)?.label ?? toolView)
        : null;
    return (
      <section
        className={editorSurfaceClass(mode)}
        data-editor-mode={mode}
      >
        {/* UN SOLO EDITOR: el MISMO chrome AlaukCut con y sin proyecto, y en
            todos los modos. La geometría de tres columnas de la referencia
            queda reservada al modo timeline (ver editor-surface.ts). */}
        <AlaukTopBar
          onNavigate={onNavigate}
          {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
          {...(onOpenPalette ? { onOpenPalette } : {})}
          onAutoEdit={() => switchMode('auto-edit')}
          onOpenTools={() => switchMode('tools')}
          showSkinToggle={mode === 'timeline'}
        />
        <EditorModeTabs mode={mode} onSwitchMode={switchMode} />
        <div className="editor-mode-panel" role="tabpanel" aria-label={modeInfo.label}>
          <div className="editor-mode-context">
            <span className="editor-mode-crumb">
              <Icon name="editor" size={12} />
              Editor
              <span aria-hidden="true">›</span>
              <strong>{mode === 'tools' ? 'Todo' : modeInfo.label}</strong>
              {crumbTool ? (
                <>
                  <span aria-hidden="true">›</span>
                  <strong>{crumbTool}</strong>
                </>
              ) : null}
            </span>
            <span className="editor-mode-context-hint">
              {mode === 'tools'
                ? 'Herramienta abierta dentro del editor'
                : modeInfo.hint}
            </span>
            {mode === 'tools' && toolView && onClearTool ? (
              <button
                type="button"
                className="ghost small editor-mode-back"
                onClick={onClearTool}
              >
                <Icon name="grid" size={12} />
                Volver al mapa
              </button>
            ) : null}
            {mode !== 'timeline' ? (
              <button
                type="button"
                className="ghost small editor-mode-back"
                onClick={() => switchMode('timeline')}
              >
                <Icon name="restore" size={12} />
                Volver a Edición
              </button>
            ) : null}
          </div>
          <div className="editor-mode-content">
            {mode === 'timeline' ? (
              <EditorEmptyState
                onNavigate={navigateFromMode}
                {...(onOpenTour ? { onOpenTour } : {})}
                {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
              />
            ) : PROJECT_OPTIONAL_MODES.has(mode) ? (
              // Estas vistas ya muestran su propio empty-state sin proyecto
              // (antes eran pantallas standalone): dentro del editor se ve
              // el mismo contenido, sin pantalla paralela.
              <Suspense fallback={<TimelineFallback />}>{modeContent}</Suspense>
            ) : (
              <EditorNeedsProject onNavigate={navigateFromMode} />
            )}
          </div>
        </div>
        <AlaukFooter />
      </section>
    );
  }

  return (
    <section
      className={editorSurfaceClass(mode)}
      data-editor-mode={mode}
    >
      <AlaukTopBar
        onNavigate={onNavigate}
        {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
        {...(onOpenPalette ? { onOpenPalette } : {})}
        onAutoEdit={() => switchMode('auto-edit')}
        onOpenTools={() => switchMode('tools')}
        showSkinToggle={mode === 'timeline'}
      />
      <EditorModeTabs mode={mode} onSwitchMode={switchMode} />
      <div
        className={`editor-grid${mode !== 'timeline' ? ' editor-mode-active' : ''}${
          mode !== 'timeline' && modeMonitorHidden ? ' editor-monitor-hidden' : ''
        }${
          mode === 'timeline' && editorLayout === 'shorts'
            ? ' layout-shorts'
            : edicionLayout
              ? ` layout-edicion${aiColumnCollapsed ? ' ai-column-collapsed' : ''}`
              : ''
        }`}
        style={
          {
            '--inspector-width': `${inspectorWidth}px`,
            '--layout-shorts-w': `${monitorWidth}px`,
            '--ia-width': `${aiColumnCollapsed ? 42 : iaWidth}px`,
          } as CSSProperties
        }
      >
        {/* PREVIEW PERSISTENTE · UN SOLO EDITOR: este panel es el PRIMER hijo
            del grid en todos los modos — la misma posición de reconciliación
            en timeline y en herramientas, así `<Preview/>`/`<Transport/>`
            (video, audio, decode) nunca se desmontan al cambiar de modo.
            Antes existían DOS instancias en ramas excluyentes del ternario
            y cada cambio recreaba el `<video>` y reiniciaba el audio. Su
            posición visual la fija `grid-column: 2; grid-row: 1` (CSS), no
            el orden del DOM. Los controles extra (desacoplar/dual) son del
            modo timeline; el monitor en sí es permanente. */}
        <div
          className={`preview-panel${mode === 'timeline' && previewDetached ? ' is-detached' : ''}`}
          data-tour="preview"
          style={mode === 'timeline' && previewDetached ? previewWindow.style : undefined}
        >
          {/* Captura 109: barra de título arrastrable cuando se desacopla. */}
          {mode === 'timeline' && previewDetached ? (
            <DetachedPreviewTitlebar
              onDock={() => setPreviewDetached(false)}
              dragHandlers={previewWindow.handlers}
            >
              Vista previa · {project.name}
            </DetachedPreviewTitlebar>
          ) : null}
          <Preview />
          <Transport />
          {mode === 'timeline' ? (
            <>
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
              {/* `previa_dupla` de AlaukCut: monitor en una segunda ventana
                  del SO para una segunda pantalla. */}
              <button
                type="button"
                className="fm-preview-detach-toggle fm-preview-dual-toggle"
                aria-label="Abrir monitor dual"
                title="Abrir el monitor en una segunda ventana (para otra pantalla)"
                onClick={() => {
                  void openDualMonitorWindow().catch(() => {});
                }}
              >
                <Icon name="fullscreen" size={12} />
              </button>
            </>
          ) : null}
        </div>
        {mode === 'timeline' ? (
          <>
            <Suspense fallback={<AssetsFallback />}>
              <EditorAssets
                onNavigate={onNavigate}
                onRequestInspectorTab={requestInspectorTab}
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
            <EditorSplitter
              value={splitterWidth}
              min={splitterMin}
              max={splitterMax}
              defaultValue={splitterDefault}
              label={splitterLabel}
              hint={
                shortsLayout
                  ? 'Arrastrá para cambiar el ancho del monitor'
                  : 'Arrastrá para cambiar el ancho de Detalles'
              }
              onChange={(width) => {
                if (shortsLayout) setMonitorWidth(width);
                else setInspectorWidth(width);
              }}
            />
            <Suspense fallback={<InspectorFallback />}>
              <Inspector tabRequest={inspectorTabRequest ?? undefined} />
            </Suspense>
            {edicionLayout ? (
              <>
                {/* Segundo divisor: redimensiona la columna de IA (paridad
                    `data-divisor="ia"` de AlaukCut). Ocupa toda la altura
                    porque la columna llega hasta el pie de la ventana. */}
                <EditorSplitter
                  className="editor-splitter-ia"
                  value={iaWidth}
                  min={IA_WIDTH_MIN}
                  max={IA_WIDTH_MAX}
                  defaultValue={IA_WIDTH_DEFAULT}
                  label="Cambiar el ancho de la columna de IA"
                  hint="Arrastrá para cambiar el ancho de la columna de IA"
                  onChange={setIaWidth}
                />
                <aside className="ia-coluna" aria-label="Edición con IA">
                  <div className="ia-col-topo">
                    <strong>Edición con IA</strong>
                    <button
                      type="button"
                      className={`ia-col-toggle${aiColumnCollapsed ? ' collapsed' : ' expanded'}`}
                      aria-label={aiColumnCollapsed ? 'Expandir columna de IA' : 'Plegar columna de IA'}
                      aria-expanded={!aiColumnCollapsed}
                      title={aiColumnCollapsed ? 'Mostrar edición con IA' : 'Plegar edición con IA'}
                      onClick={() => setAiColumnCollapsed((value) => !value)}
                    >
                      <Icon name="chevron" size={13} />
                    </button>
                  </div>
                  <div className="ia-col-corpo" ref={setAiColumnElement}>
                    <div className="ia-col-hint">
                      <p>
                        Pedile la edición a la IA: cortar, ordenar y subtitular
                        el video desde acá, viendo el resultado en la línea de
                        tiempo.
                      </p>
                      <button
                        type="button"
                        className="ia-col-abrir"
                        onClick={() => window.dispatchEvent(new Event('olyvia:assistant-open'))}
                      >
                        Abrir el asistente
                      </button>
                    </div>
                  </div>
                </aside>
              </>
            ) : null}
          </>
        ) : (
          /* UN SOLO EDITOR · en cualquier modo de herramienta el contenido
             del modo ocupa la columna izquierda; el monitor del video es el
             `.preview-panel` persistente de arriba (nunca se desmonta). Se
             pliega con «Monitor» vía la clase `editor-monitor-hidden` del
             grid y la timeline queda abajo siempre. */
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
                  ? 'Herramienta abierta dentro del editor · el video sigue visible'
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
                onClick={() => setModeMonitorHidden((value) => !value)}
                aria-pressed={modeMonitorHidden}
                title={modeMonitorHidden ? 'Mostrar el monitor del video' : 'Ocultar el monitor del video'}
              >
                <Icon name={modeMonitorHidden ? 'eye' : 'eye-off'} size={12} />
                {modeMonitorHidden ? 'Monitor' : 'Ocultar monitor'}
              </button>
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
            <Timeline onRequestInspectorTab={requestInspectorTab} />
          </Suspense>
        </div>
      </div>

      {/* Pie de estado AlaukCut en TODOS los modos: materiales, clips y
          estado de guardado — datos reales del store. */}
      <AlaukFooter />

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
