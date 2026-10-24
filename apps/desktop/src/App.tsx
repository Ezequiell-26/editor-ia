import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StartScreen } from './features/start/StartScreen';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { AppShell } from './components/AppShell';
import { CommandPalette } from './components/CommandPalette';
import { SettingsWindow } from './components/SettingsWindow';
import { WelcomeDialog } from './components/WelcomeDialog';
import { buildCommands } from './app/commands';
import { NAV_VIEWS, type ViewId } from './app/navigation';
import { ProjectHome } from './features/projects/ProjectHome';
import { AppearanceProvider } from './state/AppearanceProvider';
import { duplicateClip, rippleDeleteClip, totalFrames } from './state/project-actions';
import {
  createDesktopService,
  detectNativeRuntime,
  type DesktopService,
} from './services/project-service';
import { ProjectProvider, useProjectStore } from './state/project-store';
import { FlowQueueProvider } from './state/FlowQueueProvider';
import { ExperienceProvider, filterViewsForMode, useExperienceMode } from './state/experience';
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
import { emit } from '@tauri-apps/api/event';
import {
  SHORTCUTS_CHANGED_EVENT,
  bindingMatches,
  eventToBinding,
  loadShortcuts,
  normalizeBinding,
  type ShortcutId,
  type ShortcutMap,
} from './state/shortcuts';

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
const loadDirector = () =>
  import('./features/director/DirectorView').then((module) => ({ default: module.DirectorView }));
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
const loadDownload = () =>
  import('./features/download/DownloadView').then((module) => ({ default: module.DownloadView }));
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
const FactoryView = lazy(loadFactory);
const DirectorView = lazy(loadDirector);
const EditorWorkspace = lazy(loadEditor);
const ScriptView = lazy(loadScript);
const AssetsPanel = lazy(loadAssets);
const ConvertView = lazy(loadConvert);
const CompareView = lazy(loadCompare);
const CompressView = lazy(loadCompress);
const DenoiseView = lazy(loadDenoise);
const ThumbnailView = lazy(loadThumbnails);
const LocalizationView = lazy(loadLocalization);
const AiHubView = lazy(loadAiHub);
const MotionView = lazy(loadMotion);
const VisualsView = lazy(loadVisuals);
const RemoveBackgroundView = lazy(loadBackground);
const UpscaleView = lazy(loadUpscale);
const TextEditView = lazy(loadTextEdit);
const MulticamView = lazy(loadMulticam);
const MixerView = lazy(loadMixer);
const DownloadView = lazy(loadDownload);
const ComplianceView = lazy(loadCompliance);
const LearnView = lazy(loadLearn);
const McpView = lazy(loadMcp);
const SettingsHome = lazy(loadSettings);

/** Cargadores por vista: `projects` es estático y no necesita precarga. */
const VIEW_PRELOADERS: Record<Exclude<ViewId, 'projects'>, () => Promise<unknown>> = {
  home: loadHome,
  director: loadDirector,
  production: loadProduction,
  factory: loadFactory,
  editor: loadEditor,
  script: loadScript,
  assets: loadAssets,
  'text-edit': loadTextEdit,
  multicam: loadMulticam,
  mixer: loadMixer,
  download: loadDownload,
  compliance: loadCompliance,
  convert: loadConvert,
  compare: loadCompare,
  compress: loadCompress,
  denoise: loadDenoise,
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
 * Descarga los chunks de todas las vistas sin bloquear el arranque: uno por
 * turno ocioso, con una pausa corta entre cada uno para no competir con la
 * primera pintura ni con el trabajo del usuario.
 */
function preloadViews(): () => void {
  let cancelled = false;
  let timer: number | null = null;
  const ids = Object.keys(VIEW_PRELOADERS) as (keyof typeof VIEW_PRELOADERS)[];
  let index = 0;
  const step = (): void => {
    if (cancelled || index >= ids.length) return;
    const loader = VIEW_PRELOADERS[ids[index]!];
    index += 1;
    void loader()
      .catch(() => null)
      .then(() => {
        if (cancelled) return;
        timer = window.setTimeout(step, 90);
      });
  };
  const schedule = (): void => {
    timer = window.setTimeout(step, 350);
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
  // Ajustes es una ventana flotante, no una vista: si se entra directo a ella
  // desde el inicio, el fondo muestra Inicio y la ventana aparece encima.
  const [activeId, setActiveId] = useState<ViewId>(
    initialView === 'settings' ? 'home' : initialView,
  );
  const [settingsOpen, setSettingsOpen] = useState(initialView === 'settings');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const store = useProjectStore();
  const { mode: experienceMode } = useExperienceMode();
  // El rail se ordena y filtra según el modo: pro muestra todo, guiado deja el
  // camino de trabajo. El menú Ver sigue listando todas las vistas.
  const railViews = useMemo(
    () => filterViewsForMode(NAV_VIEWS, experienceMode),
    [experienceMode],
  );

  // Precarga de todos los chunks de vista en tiempo ocioso: cuando el usuario
  // hace clic, el módulo ya está evaluado y el cambio no espera nada.
  useEffect(() => preloadViews(), []);

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
    if (activeId !== 'editor' && storeRef.current.state.playing) {
      storeRef.current.setPlaying(false);
    }
  }, [activeId]);

  // Al abrir el editor o un proyecto, la ventana pasa a pantalla completa
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
  }, [project]);

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
    if (id === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setActiveId(id);
  }, []);

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
        playing: store.state.playing,
        projectOpen: !!project,
        hasClips: !!project && project.timeline.clips.length > 0,
        setSelectionNone: () => store.setSelection({ kind: 'none' }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, store.canUndo, store.canRedo, store.state.playing, project, shortcutsVersion, packageProject],
  );

  useEffect(() => {
    document.title = project ? `${project.name} — Olyvia` : 'Olyvia';
  }, [project]);

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
      'nav.director': 'director',
      'nav.download': 'download',
      'nav.settings': 'settings',
    };
    const onKeyDown = (event: KeyboardEvent) => {
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
            if (ok) setActiveId('editor');
          });
          return;
        case 'file.export': {
          if (!project?.timeline.clips.length) return;
          event.preventDefault();
          setActiveId('editor');
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
            store.setPlayhead(Math.min(store.state.playheadFrame, totalFrames(copy.project)));
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
              Math.min(store.state.playheadFrame, totalFrames(current)),
            );
            store.setNotice('Clip eliminado; el hueco se cerró.');
          }
          return;
        }
        case 'edit.deselect':
          store.setSelection({ kind: 'none' });
          return;
        case 'playback.playPause':
          if (!project) return;
          event.preventDefault();
          store.setPlaying(!store.state.playing);
          return;
        default: {
          const target = NAV_TARGET[matched];
          if (target) {
            event.preventDefault();
            setActiveId(target);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store]);

  const renderView = useCallback(
    (id: ViewId) => {
      switch (id) {
        case 'home':
          return <HomeView onNavigate={navigate} />;
        case 'projects':
          return <ProjectHome onNavigate={navigate} />;
        case 'director':
          return <DirectorView onNavigate={navigate} />;
        case 'production':
          return <ProductionView onNavigate={navigate} />;
        case 'factory':
          return <FactoryView onNavigate={navigate} />;
        case 'editor':
          return <EditorWorkspace onNavigate={navigate} />;
        case 'script':
          return <ScriptView onNavigate={navigate} />;
        case 'assets':
          return <AssetsPanel onNavigate={navigate} />;
        case 'text-edit':
          return <TextEditView onNavigate={navigate} />;
        case 'multicam':
          return <MulticamView onNavigate={navigate} />;
        case 'mixer':
          return <MixerView onNavigate={navigate} />;
        case 'download':
          return <DownloadView onNavigate={navigate} />;
        case 'compliance':
          return <ComplianceView onNavigate={navigate} />;
        case 'convert':
          return <ConvertView onNavigate={navigate} />;
        case 'compare':
          return <CompareView onNavigate={navigate} />;
        case 'compress':
          return <CompressView onNavigate={navigate} />;
        case 'denoise':
          return <DenoiseView onNavigate={navigate} />;
        case 'thumbnails':
          return <ThumbnailView onNavigate={navigate} />;
        case 'localization':
          return <LocalizationView onNavigate={navigate} />;
        case 'ai-hub':
          return <AiHubView onNavigate={navigate} />;
        case 'motion':
          return <MotionView onNavigate={navigate} />;
        case 'visuals':
          return <VisualsView onNavigate={navigate} />;
        case 'background':
          return <RemoveBackgroundView onNavigate={navigate} />;
        case 'upscale':
          return <UpscaleView onNavigate={navigate} />;
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
    [navigate],
  );

  // Una sola vista activa: el cambio es inmediato porque el chunk ya está
  // precargado en memoria, y así ninguna vista oculta conserva estado, timers
  // ni audio. El fallback no muestra texto de carga.
  const content = (
    <Suspense fallback={<ViewFallback />}>{renderView(activeId)}</Suspense>
  );

  return (
    <>
      <AppShell
        activeId={activeId}
        onSelect={navigate}
        {...(onReturnToStart ? { onReturnToStart } : {})}
        content={content}
        flush={
          activeId === 'editor' ||
          activeId === 'script' ||
          activeId === 'assets' ||
          activeId === 'production' ||
          activeId === 'factory' ||
          activeId === 'director' ||
          activeId === 'convert' ||
          activeId === 'compare' ||
          activeId === 'compress' ||
          activeId === 'denoise' ||
          activeId === 'thumbnails' ||
          activeId === 'localization' ||
          activeId === 'ai-hub' ||
          activeId === 'motion' ||
          activeId === 'visuals' ||
          activeId === 'background' ||
          activeId === 'upscale' ||
          activeId === 'mcp'
        }
      />
      <WelcomeDialog onNavigate={navigate} />
      {settingsOpen && (
        <SettingsWindow onClose={() => setSettingsOpen(false)}>
          <SettingsHome />
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

export function App({ service = createDesktopService(), initialShowStart }: AppProps) {
  const [showStart, setShowStart] = useState(() => {
    if (typeof initialShowStart === 'boolean') return initialShowStart;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return false;
    }
    return true;
  });
  const [initialView, setInitialView] = useState<ViewId>('home');

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
          <ExperienceProvider>
            {showStart ? (
              <StartScreen onEnterApp={handleEnterApp} />
            ) : (
              <Shell initialView={initialView} onReturnToStart={handleReturnToStart} />
            )}
          </ExperienceProvider>
        </FlowQueueProvider>
      </ProjectProvider>
    </AppearanceProvider>
  );
}

