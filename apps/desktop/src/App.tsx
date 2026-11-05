import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StartScreen } from './features/start/StartScreen';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { AppShell } from './components/AppShell';
import { BrowserModeBanner } from './components/BrowserModeBanner';
import { CommandPalette } from './components/CommandPalette';
import { SettingsWindow } from './components/SettingsWindow';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { WelcomeDialog } from './components/WelcomeDialog';
import { buildCommands } from './app/commands';
import {
  MAIN_NAV_VIEWS,
  NAV_VIEWS,
  SECONDARY_NAV_VIEWS,
  type ViewId,
} from './app/navigation';
import {
  resolveViewRoute,
  type EditorModeId,
} from './app/view-routing';
import { ProjectHome } from './features/projects/ProjectHome';
import { AppearanceProvider } from './state/AppearanceProvider';
import { duplicateClip, rippleDeleteClip, totalFrames } from './state/project-actions';
import {
  createDesktopService,
  detectNativeRuntime,
  type DesktopService,
} from './services/project-service';
import { ProjectProvider, useProjectPlaying, useProjectStore } from './state/project-store';
import { McpBridgeRuntime } from './features/assistant/McpBridgeRuntime';
import { useEditorPreferences } from './state/useEditorPreferences';
import { FlowQueueProvider } from './state/FlowQueueProvider';
import {
  collectSearchDocuments,
  createGlobalSearch,
  destinationOfHit,
  searchGlobal,
  type GlobalSearchDocument,
  type GlobalSearchHit,
  type GlobalSearchIndex,
} from './state/global-search';
import { recordViewVisit } from './state/learning-progress';
import { emit, listen } from '@tauri-apps/api/event';
import {
  SHORTCUTS_CHANGED_EVENT,
  bindingMatches,
  eventToBinding,
  isActivatableTarget,
  loadShortcuts,
  normalizeBinding,
  type ShortcutId,
  type ShortcutMap,
} from './state/shortcuts';

// ── CSS no crítico por contexto de vista ───────────────────────────────────
// El launcher arranca sólo con el CSS crítico importado en `main.tsx`. La capa
// premium del editor (workspace) y la de contenido (views) — junto con sus
// hojas legacy — viven en un entry dinámico cada una: se cargan antes de montar
// la primera vista (sin FOUC) y el otro contexto se prefetcha en ocioso. Ver
// docs/CSS-PERF-NOTES.md §5.
const EDITOR_STYLE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'editor',
  'text-edit',
  'multicam',
  'mixer',
  'vfx',
  'motion',
  'visuals',
]);
const viewStyleLoaders = {
  editor: () => import('./styles/entries/editor.css'),
  content: () => import('./styles/entries/content.css'),
} as const;
type ViewStyleKind = keyof typeof viewStyleLoaders;
const viewStyleCache = new Map<ViewStyleKind, Promise<unknown>>();

function styleKindForView(view: ViewId): ViewStyleKind {
  return EDITOR_STYLE_VIEWS.has(view) ? 'editor' : 'content';
}

function ensureViewStyles(kind: ViewStyleKind): Promise<unknown> {
  let pending = viewStyleCache.get(kind);
  if (!pending) {
    pending = viewStyleLoaders[kind]().catch((error: unknown) => {
      // Un CSS que no carga no debe romper la vista: se registra y sigue con el
      // CSS crítico (peor look, nunca pantalla en blanco).
      console.error('No se pudieron cargar los estilos de las vistas', error);
    });
    viewStyleCache.set(kind, pending);
  }
  return pending;
}

// Cada vista se carga una vez y se precarga en segundo plano apenas la app
// arranca. Antes, la primera visita a cada herramienta descargaba y evaluaba su
// chunk al hacer clic, con el cartel "Cargando herramienta…" a la vista; ahora
// el chunk ya está en memoria y el cambio es inmediato.
const loadHome = () =>
  import('./features/home/HomeView').then((module) => ({ default: module.HomeView }));
const loadProduction = () =>
  import('./features/production/ProductionView').then((module) => ({
    default: module.ProductionView,
  }));
const loadFactory = () =>
  import('./features/factory/FactoryView').then((module) => ({ default: module.FactoryView }));
const loadCreator = () =>
  import('./features/creator/CreatorHubView').then((module) => ({
    default: module.CreatorHubView,
  }));
const loadDirector = () =>
  import('./features/director/DirectorView').then((module) => ({ default: module.DirectorView }));
const loadAutoEdit = () =>
  import('./features/autoedit/AutoEditView').then((module) => ({
    default: module.AutoEditView,
  }));
const loadYouTube = () =>
  import('./features/youtube/YouTubeAnalyzerView').then((module) => ({
    default: module.YouTubeAnalyzerView,
  }));
const loadEditor = () =>
  import('./features/editor/EditorWorkspace').then((module) => ({
    default: module.EditorWorkspace,
  }));
const loadScript = () =>
  import('./features/script/ScriptView').then((module) => ({ default: module.ScriptView }));
const loadAssets = () =>
  import('./features/assets/AssetsPanel').then((module) => ({ default: module.AssetsPanel }));
const loadConvert = () =>
  import('./features/convert/ConvertView').then((module) => ({ default: module.ConvertView }));
const loadCompare = () =>
  import('./features/compare/CompareView').then((module) => ({ default: module.CompareView }));
const loadCompress = () =>
  import('./features/compress/CompressView').then((module) => ({ default: module.CompressView }));
const loadDenoise = () =>
  import('./features/denoise/DenoiseView').then((module) => ({ default: module.DenoiseView }));
const loadSharpen = () =>
  import('./features/sharpen/SharpenView').then((module) => ({ default: module.SharpenView }));
const loadThumbnails = () =>
  import('./features/thumbnails/ThumbnailView').then((module) => ({
    default: module.ThumbnailView,
  }));
const loadLocalization = () =>
  import('./features/localization/LocalizationView').then((module) => ({
    default: module.LocalizationView,
  }));
const loadAiHub = () =>
  import('./features/ai-hub/AiHubView').then((module) => ({ default: module.AiHubView }));
const loadMotion = () =>
  import('./features/motion/MotionView').then((module) => ({ default: module.MotionView }));
const loadVisuals = () =>
  import('./features/visuals/VisualsView').then((module) => ({ default: module.VisualsView }));
const loadBackground = () =>
  import('./features/ai/RemoveBackgroundView').then((module) => ({
    default: module.RemoveBackgroundView,
  }));
const loadUpscale = () =>
  import('./features/ai/UpscaleView').then((module) => ({ default: module.UpscaleView }));
const loadTextEdit = () =>
  import('./features/text-edit/TextEditView').then((module) => ({ default: module.TextEditView }));
const loadMulticam = () =>
  import('./features/multicam/MulticamView').then((module) => ({ default: module.MulticamView }));
const loadMixer = () =>
  import('./features/mixer/MixerView').then((module) => ({ default: module.MixerView }));
const loadVfx = () =>
  import('./features/vfx/VfxView').then((module) => ({ default: module.VfxView }));
const loadDownload = () =>
  import('./features/download/DownloadsHubView').then((module) => ({
    default: module.DownloadsHubView,
  }));
const loadLab = () =>
  import('./features/lab/MediaLabView').then((module) => ({
    default: module.MediaLabView,
  }));
const loadCompliance = () =>
  import('./features/compliance/ComplianceView').then((module) => ({
    default: module.ComplianceView,
  }));
const loadLearn = () =>
  import('./features/learn/LearnView').then((module) => ({ default: module.LearnView }));
const loadMcp = () =>
  import('./features/mcp/McpView').then((module) => ({ default: module.McpView }));
const loadSettings = () =>
  import('./features/settings/SettingsHome').then((module) => ({ default: module.SettingsHome }));

const HomeView = lazy(loadHome);
const ProductionView = lazy(loadProduction);
const CreatorHubView = lazy(loadCreator);
const DirectorView = lazy(loadDirector);
const AutoEditView = lazy(loadAutoEdit);
const EditorWorkspace = lazy(loadEditor);
const ScriptView = lazy(loadScript);
const AssetsPanel = lazy(loadAssets);
const AiHubView = lazy(loadAiHub);
const DownloadsHubView = lazy(loadDownload);
const MediaLabView = lazy(loadLab);
const LearnView = lazy(loadLearn);
const McpView = lazy(loadMcp);
const SettingsHome = lazy(loadSettings);

/** Cargadores por vista: `projects` es estático y no necesita precarga. */
const VIEW_PRELOADERS: Record<Exclude<ViewId, 'projects'>, () => Promise<unknown>> = {
  home: loadHome,
  director: loadDirector,
  'auto-edit': loadAutoEdit,
  youtube: loadYouTube,
  production: loadProduction,
  factory: loadFactory,
  creator: loadCreator,
  editor: loadEditor,
  lab: loadLab,
  script: loadScript,
  assets: loadAssets,
  'text-edit': loadTextEdit,
  multicam: loadMulticam,
  mixer: loadMixer,
  vfx: loadVfx,
  download: loadDownload,
  compliance: loadCompliance,
  convert: loadConvert,
  compare: loadCompare,
  compress: loadCompress,
  denoise: loadDenoise,
  sharpen: loadSharpen,
  thumbnails: loadThumbnails,
  localization: loadLocalization,
  'ai-hub': loadAiHub,
  motion: loadMotion,
  visuals: loadVisuals,
  background: loadBackground,
  upscale: loadUpscale,
  learn: loadLearn,
  mcp: loadMcp,
  settings: loadSettings,
};

/**
 * Descarga los chunks de las vistas de uso frecuente sin bloquear el arranque.
 * Antes se precargaban las 27 vistas en los primeros segundos (≈1,5 MB de JS
 * evaluado): eso competía con la primera pintura. Las vistas secundarias se
 * cargan al abrirse; éstas cubren el recorrido habitual.
 */
const PRIMARY_PRELOADS: readonly Exclude<ViewId, 'projects'>[] = [
  'home',
  'editor',
  'assets',
  'download',
];

function preloadViews(): () => void {
  let cancelled = false;
  let timer: number | null = null;
  const ids = PRIMARY_PRELOADS;
  let index = 0;
  const step = (): void => {
    if (cancelled || index >= ids.length) return;
    const loader = VIEW_PRELOADERS[ids[index]!];
    index += 1;
    void loader()
      .catch(() => null)
      .then(() => {
        if (cancelled) return;
        timer = window.setTimeout(step, 120);
      });
  };
  const schedule = (): void => {
    timer = window.setTimeout(step, 1200);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(schedule, { timeout: 1500 });
  } else {
    schedule();
  }
  return () => {
    cancelled = true;
    if (timer !== null) window.clearTimeout(timer);
  };
}

/**
 * Reserva visual mientras un chunk termina de evaluarse. No dice nada: con la
 * precarga en ocioso esto casi nunca se ve, y cuando se ve no debe anunciar una
 * espera que el usuario no pidió.
 */
function ViewFallback() {
  return (
    <div className="view-loading" aria-hidden="true">
      <span className="view-loading-dot" />
    </div>
  );
}

interface AppProps {
  readonly service?: DesktopService;
  readonly initialShowStart?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

interface ShellProps {
  readonly initialView?: ViewId;
  readonly onReturnToStart?: () => void;
}

function Shell({ initialView = 'home', onReturnToStart }: ShellProps) {
  const initialRoute = resolveViewRoute(initialView);
  // Ajustes es una ventana flotante, no una vista: si se entra directo a ella
  // desde el inicio, el fondo muestra Inicio y la ventana aparece encima.
  const [activeId, setActiveId] = useState<ViewId>(
    initialRoute.view === 'settings' ? 'home' : initialRoute.view,
  );
  const [hubTab, setHubTab] = useState<string | null>(initialRoute.hubTab ?? null);
  const [editorMode, setEditorMode] = useState<EditorModeId>(
    initialRoute.editorMode ?? 'timeline',
  );
  const [hubRequest, setHubRequest] = useState(0);
  const [editorRequest, setEditorRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(initialView === 'settings');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const store = useProjectStore();
  // `playing` vive en su propio contexto: cambia sólo al play/pausa, así que
  // la lista de comandos no se recalcula en cada frame del playhead.
  const playing = useProjectPlaying();
  // El rail es la lista corta de superficies; las herramientas avanzadas
  // quedan detrás de «Más». El menú Ver sigue listando el rail visible.
  const railViews = MAIN_NAV_VIEWS;
  // Sin runtime nativo la app no tiene acceso al sistema de archivos: el aviso
  // persistente explica el modo antes de que el usuario choque con un error.
  const browserMode = !store.service.available;

  // Precarga de todos los chunks de vista en tiempo ocioso: cuando el usuario
  // hace clic, el módulo ya está evaluado y el cambio no espera nada.
  useEffect(() => preloadViews(), []);

  // Estilo de la vista activa: se pide antes de renderizarla para que el primer
  // frame de esa vista ya salga con la capa premium aplicada (sin FOUC). El
  // contexto opuesto se prefetcha en ocioso para que la próxima navegación no
  // espere. En tests no hay fetch real: arranca resuelto para no cambiar el
  // render síncrono de los casos existentes.
  const firstStyleKind = styleKindForView(activeId);
  const [styledKind, setStyledKind] = useState<ViewStyleKind | null>(() =>
    import.meta.env.MODE === 'test' ? styleKindForView(initialView) : null,
  );

  useEffect(() => {
    const kind = styleKindForView(activeId);
    if (import.meta.env.MODE === 'test') {
      setStyledKind(kind);
      return;
    }
    let active = true;
    void ensureViewStyles(kind).then(() => {
      if (active) setStyledKind(kind);
    });
    const other: ViewStyleKind = kind === 'editor' ? 'content' : 'editor';
    const timer = window.setTimeout(() => {
      void ensureViewStyles(other);
    }, 1_200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeId]);

  const viewStylesReady =
    import.meta.env.MODE === 'test' || styledKind === firstStyleKind;

  useEffect(() => {
    try {
      recordViewVisit(activeId);
    } catch {
      // El progreso de aprendizaje es telemetría local: si el almacenamiento
      // falla, la navegación no debe romperse.
    }
  }, [activeId]);

  const project = store.state.project;
  const storeRef = useRef(store);
  storeRef.current = store;
  const saveNow = store.saveNow;

  useEffect(() => {
    // Salir del editor detiene la reproducción: una vista oculta no debe seguir
    // sonando ni consumiendo cuadros.
    if (activeId !== 'editor' && storeRef.current.getPlaying()) {
      storeRef.current.setPlaying(false);
    }
  }, [activeId]);

  // Al abrir el editor o un proyecto, la ventana pasa a pantalla completa.
  // Dependía del objeto `project`: cada edición (incluso arrastrar un slider)
  // cambiaba su identidad y disparaba un `isMaximized()` por IPC. Sólo hacen
  // falta dos primitivos estables: si hay proyecto y si el editor está activo.
  const editorVisible = activeId === 'editor';
  const hasProject = project !== null;
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then((maximized) => {
      if (!maximized) {
        void appWindow.maximize().catch(() => {
          void appWindow.toggleMaximize().catch(() => {});
        });
      }
    }).catch(() => {
      void appWindow.maximize().catch(() => {});
    });
  }, [editorVisible, hasProject]);

  // Atajos personalizables: el ref se actualiza en vivo cuando el usuario
  // reasigna desde Ajustes → Atajos (evento SHORTCUTS_CHANGED_EVENT). La
  // `version` fuerza a la paleta a releer los atajos al reabrirse.
  const [shortcutsVersion, setShortcutsVersion] = useState(0);
  const shortcutsRef = useRef<ShortcutMap>(loadShortcuts());
  useEffect(() => {
    const refresh = () => {
      shortcutsRef.current = loadShortcuts();
      setShortcutsVersion((version) => version + 1);
    };
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SHORTCUTS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const navigate = useCallback((id: ViewId) => {
    const route = resolveViewRoute(id);
    if (route.view === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setActiveId(route.view);
    setHubTab(route.hubTab ?? null);
    setHubRequest((request) => request + 1);
    if (route.view === 'editor') {
      setEditorMode(route.editorMode ?? 'timeline');
      setEditorRequest((request) => request + 1);
    }
  }, []);

  useEffect(() => {
    const onMcpNavigate = (event: Event) => {
      const view = (event as CustomEvent<unknown>).detail;
      if (typeof view === 'string' && NAV_VIEWS.some((item) => item.id === view)) navigate(view as ViewId);
    };
    window.addEventListener('olyvia:mcp:navigate', onMcpNavigate);
    return () => window.removeEventListener('olyvia:mcp:navigate', onMcpNavigate);
  }, [navigate]);
  // Precalienta el motor de búsqueda en un momento ocioso: el chunk ya está
  // listo cuando el usuario abre la paleta, sin retrasar el arranque.
  useEffect(() => {
    const warm = () => {
      void import('minisearch');
    };
    const idle = window.requestIdleCallback;
    if (typeof idle !== 'function') {
      const timer = window.setTimeout(warm, 3_000);
      return () => window.clearTimeout(timer);
    }
    const handle = idle(warm, { timeout: 5_000 });
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  // El índice se arma al abrir la paleta, no en cada edición: la búsqueda es
  // una acción puntual y no debe encarecer el camino de escritura del proyecto.
  // MiniSearch llega por import() dinámico, así que el armado es asíncrono.
  const [paletteSearch, setPaletteSearch] = useState<{
    documents: readonly GlobalSearchDocument[];
    index: GlobalSearchIndex;
  } | null>(null);

  useEffect(() => {
    if (!paletteOpen || !project) {
      setPaletteSearch(null);
      return;
    }
    let cancelled = false;
    const documents = collectSearchDocuments(project);
    void createGlobalSearch(documents).then((index) => {
      if (!cancelled) setPaletteSearch({ documents, index });
    });
    return () => {
      cancelled = true;
    };
  }, [paletteOpen, project]);

  const searchInProject = useCallback(
    async (query: string): Promise<readonly GlobalSearchHit[]> =>
      paletteSearch
        ? searchGlobal(paletteSearch.index, paletteSearch.documents, query, 8)
        : [],
    [paletteSearch],
  );

  const pickSearchHit = useCallback(
    (hit: GlobalSearchHit) => {
      const current = storeRef.current;
      const destination = destinationOfHit(hit);
      navigate(destination.view);
      current.setSelection(destination.selection);
      if (destination.frame !== null) current.setPlayhead(destination.frame);
    },
    [navigate],
  );

  const packageProject = store.packageProject;

  const commandList = useMemo(
    () =>
      buildCommands({
        navigate,
        saveNow: store.saveNow,
        saveAs: store.saveAs,
        packageProject,
        openProject: store.openProject,
        requestExport: store.requestExport,
        undo: store.undo,
        redo: store.redo,
        canUndo: store.canUndo,
        canRedo: store.canRedo,
        setPlaying: store.setPlaying,
        playing,
        projectOpen: !!project,
        hasClips: !!project && project.timeline.clips.length > 0,
        setSelectionNone: () => store.setSelection({ kind: 'none' }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, store.canUndo, store.canRedo, playing, project, shortcutsVersion, packageProject],
  );

  // El título depende del nombre, no del documento completo: antes cada
  // edición reescribía el título de la ventana aunque no hubiera cambiado.
  const projectName = project?.name;
  useEffect(() => {
    document.title = projectName ? `${projectName} — Olyvia` : 'Olyvia';
  }, [projectName]);

  useEffect(() => {
    if (!detectNativeRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const appWindow = getCurrentWindow();
    void appWindow
      .onCloseRequested(async (event) => {
        const snapshot = storeRef.current.state;
        if (!snapshot.project) {
          return;
        }
        if (snapshot.phase !== 'dirty' && snapshot.phase !== 'failed') {
          if (snapshot.phase === 'saving') {
            event.preventDefault();
            storeRef.current.setNotice('El proyecto se está guardando; esperá un instante y cerrá de nuevo.');
          }
          return;
        }
        event.preventDefault();
        const saved = await saveNow();
        if (saved && !disposed) {
          await appWindow.destroy();
        }
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [saveNow]);

  useEffect(() => {
    const NAV_TARGET: Record<string, ViewId> = {
      'nav.home': 'home',
      'nav.editor': 'editor',
      'nav.script': 'script',
      'nav.assets': 'assets',
      'nav.production': 'production',
      'nav.factory': 'factory',
      'nav.creator': 'creator',
      'nav.director': 'director',
      'nav.download': 'download',
      'nav.settings': 'settings',
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // El store cambia de identidad en cada frame de reproducción. Leerlo
      // desde el ref permite registrar el listener una sola vez en lugar de
      // quitarlo y volverlo a poner ~30 veces por segundo.
      const store = storeRef.current;
      const map = shortcutsRef.current;
      // La paleta se abre incluso mientras se escribe en un input.
      if (bindingMatches(event, map['palette.toggle'])) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      const combo = eventToBinding(event);
      let matched: ShortcutId | null = null;
      for (const [id, binding] of Object.entries(map) as [ShortcutId, string][]) {
        if (id === 'palette.toggle') continue;
        if (binding && normalizeBinding(binding) === combo) {
          matched = id;
          break;
        }
      }
      if (!matched) return;
      switch (matched) {
        case 'file.save':
          event.preventDefault();
          void store.saveNow();
          return;
        case 'file.saveAs':
          event.preventDefault();
          void store.saveAs();
          return;
        case 'file.open':
          event.preventDefault();
          void store.openProject().then((ok) => {
            if (ok) navigate('editor');
          });
          return;
        case 'file.export': {
          if (!store.state.project?.timeline.clips.length) return;
          event.preventDefault();
          navigate('editor');
          store.requestExport();
          return;
        }
        case 'edit.undo':
          event.preventDefault();
          store.undo();
          return;
        case 'edit.redo':
          event.preventDefault();
          store.redo();
          return;
        case 'edit.duplicateClip': {
          const selection = store.state.selection;
          if (selection.kind !== 'clip') return;
          event.preventDefault();
          const copy = store.mutate((current) => {
            const result = duplicateClip(current, selection.id);
            if (!result) throw new Error('no se pudo duplicar el clip');
            return result;
          });
          if (copy) {
            store.setSelection({ kind: 'clip', id: copy.clipId });
            store.setPlayhead(Math.min(store.getPlayhead(), totalFrames(copy.project)));
          }
          return;
        }
        case 'edit.rippleDelete': {
          const selection = store.state.selection;
          const current = store.state.project;
          if (selection.kind !== 'clip' || !current) return;
          event.preventDefault();
          const applied = store.update((doc) => rippleDeleteClip(doc, selection.id));
          if (applied) {
            store.setSelection({ kind: 'none' });
            store.setPlayhead(
              Math.min(store.getPlayhead(), totalFrames(current)),
            );
            store.setNotice('Clip eliminado; el hueco se cerró.');
          }
          return;
        }
        case 'edit.deselect':
          store.setSelection({ kind: 'none' });
          return;
        case 'playback.playPause':
          if (!store.state.project) return;
          // Fase 2 de accesibilidad (H16): si el foco está sobre un control
          // que se activa con Space (botón, ítem de menú, clip de la
          // timeline…), dejar pasar el evento: el click de activación ocurre
          // en keyup y no se dispara si este keydown se previene.
          if (isActivatableTarget(event.target)) return;
          event.preventDefault();
          store.setPlaying(!store.getPlaying());
          return;
        default: {
          const target = NAV_TARGET[matched];
          if (target) {
            event.preventDefault();
            navigate(target);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const renderView = useCallback(
    (id: ViewId) => {
      switch (id) {
        case 'home':
          return <HomeView onNavigate={navigate} />;
        case 'projects':
          return <ProjectHome onNavigate={navigate} />;
        case 'director':
          return <DirectorView onNavigate={navigate} />;
        case 'auto-edit':
          return <AutoEditView onNavigate={navigate} />;
        case 'production':
          return <ProductionView onNavigate={navigate} />;
        case 'creator':
          return (
            <CreatorHubView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'editor':
          return (
            <EditorWorkspace
              onNavigate={navigate}
              initialMode={editorMode}
              modeRequest={editorRequest}
            />
          );
        case 'lab':
          return (
            <MediaLabView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'script':
          return <ScriptView onNavigate={navigate} />;
        case 'assets':
          return <AssetsPanel onNavigate={navigate} />;
        case 'download':
          return (
            <DownloadsHubView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'ai-hub':
          return <AiHubView onNavigate={navigate} />;
        case 'learn':
          return <LearnView onNavigate={navigate} />;
        case 'mcp':
          return <McpView />;
        case 'settings':
          return <SettingsHome />;
        default:
          return null;
      }
    },
    [navigate, hubTab, hubRequest, editorMode, editorRequest],
  );

  // Una sola vista activa: el cambio es inmediato porque el chunk ya está
  // precargado en memoria, y así ninguna vista oculta conserva estado, timers
  // ni audio. El fallback no muestra texto de carga. Si el CSS de esa vista aún
  // no está aplicado se muestra el mismo fallback: nunca un frame sin estilos.
  const content = viewStylesReady ? (
    <ViewErrorBoundary
      resetKey={activeId}
      onHome={() => navigate('home')}
      onSettings={() => navigate('settings')}
    >
      <Suspense fallback={<ViewFallback />}>{renderView(activeId)}</Suspense>
    </ViewErrorBoundary>
  ) : (
    <ViewFallback />
  );

  return (
    <>
      <AppShell
        activeId={activeId}
        views={railViews}
        moreViews={SECONDARY_NAV_VIEWS}
        onSelect={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        {...(onReturnToStart ? { onReturnToStart } : {})}
        banner={
          browserMode ? (
            <BrowserModeBanner
              reason={store.service.unavailableReason}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : null
        }
        content={content}
        flush={
          activeId === 'editor' ||
          activeId === 'script' ||
          activeId === 'assets' ||
          activeId === 'production' ||
          activeId === 'director' ||
          activeId === 'ai-hub' ||
          activeId === 'mcp'
        }
      />
      <WelcomeDialog onNavigate={navigate} />
      {settingsOpen && (
        <SettingsWindow onClose={() => setSettingsOpen(false)}>
          <SettingsHome
            onNavigate={(id) => {
              setSettingsOpen(false);
              navigate(id);
            }}
          />
        </SettingsWindow>
      )}
      {paletteOpen && (
        <CommandPalette
          commands={commandList}
          onClose={() => setPaletteOpen(false)}
          search={searchInProject}
          onPickHit={pickSearchHit}
        />
      )}
    </>
  );
}

export function App({ service: suppliedService, initialShowStart }: AppProps) {
  const [service] = useState<DesktopService>(() => suppliedService ?? createDesktopService());
  const editorPreferences = useEditorPreferences();
  const deepView = (() => {
    if (typeof window === 'undefined') return null;
    const requested = new URLSearchParams(window.location.search).get('view');
    return requested && NAV_VIEWS.some((view) => view.id === requested)
      ? (requested as ViewId)
      : null;
  })();
  const [showStart, setShowStart] = useState(() => {
    if (typeof initialShowStart === 'boolean') return initialShowStart;
    if (deepView) return false;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return false;
    }
    return true;
  });
  const [initialView, setInitialView] = useState<ViewId>(deepView ?? 'home');
  const [backgroundMode, setBackgroundMode] = useState(false);

  // El modo background arranca MCP sin renderizar StartScreen ni Editor.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    void invoke<boolean>('background_start_mode')
      .then((background) => {
        if (!active || !background) return;
        setBackgroundMode(true);
        setShowStart(false);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // La bandeja puede volver a mostrar la UI sin reiniciar el servidor MCP.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void listen('app-show-requested', () => {
      setBackgroundMode(false);
      setShowStart(false);
    }).then((off) => {
      if (active) unlisten = off;
      else off();
    }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, []);

  // Conserva una navegacion MCP solicitada mientras la ventana esta oculta.
  useEffect(() => {
    const onMcpNavigate = (event: Event) => {
      const view = (event as CustomEvent<unknown>).detail;
      if (typeof view === 'string' && NAV_VIEWS.some((item) => item.id === view)) setInitialView(view as ViewId);
    };
    window.addEventListener('olyvia:mcp:navigate', onMcpNavigate);
    return () => window.removeEventListener('olyvia:mcp:navigate', onMcpNavigate);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.emojiStyle = editorPreferences.emojiStyle;
  }, [editorPreferences.emojiStyle]);

  // Aviso al backend que la interfaz ya montó: es la señal para cerrar el
  // splash y mostrar la ventana principal.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    void emit('app-ready').catch(() => {
      // sin splash esperando: no hay nada que hacer
    });
  }, []);

  const handleEnterApp = useCallback((view: ViewId) => {
    setInitialView(view);
    setShowStart(false);
    if (detectNativeRuntime()) {
      const appWindow = getCurrentWindow();
      void appWindow
        .setResizable(true)
        .catch(() => {})
        .then(() => appWindow.setMaximizable(true).catch(() => {}))
        .then(() => appWindow.maximize())
        .catch(() => {
          void appWindow.toggleMaximize().catch(() => {});
        });
    }
  }, []);

  const handleReturnToStart = useCallback(() => {
    setShowStart(true);
    if (detectNativeRuntime()) {
      const appWindow = getCurrentWindow();
      void appWindow
        .unmaximize()
        .then(() => appWindow.setResizable(false))
        .then(() => appWindow.setMaximizable(false))
        .then(() => appWindow.setSize(new LogicalSize(900, 580)))
        .then(() => appWindow.center())
        .catch(() => {});
    }
  }, []);

  return (
    <AppearanceProvider>
      <ProjectProvider service={service}>
        {/* La cola de Flow vive por encima de las vistas: una corrida larga no
            debe cortarse al cambiar de pantalla. */}
        <FlowQueueProvider>
          <McpBridgeRuntime />
          {backgroundMode ? null : showStart ? (
            <StartScreen
              onEnterApp={handleEnterApp}
              banner={
                !service.available ? (
                  <BrowserModeBanner reason={service.unavailableReason} />
                ) : null
              }
            />
          ) : (
            <Shell initialView={initialView} onReturnToStart={handleReturnToStart} />
          )}
        </FlowQueueProvider>
      </ProjectProvider>
    </AppearanceProvider>
  );
}

