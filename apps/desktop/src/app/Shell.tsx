import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnboardingTour, SettingsHome, ShortcutsCheatSheet, ViewFallback, type ViewStyleKind, ensureViewStyles, preloadViews, styleKindForView } from './view-registry';
import { WorkspaceView } from './WorkspaceView';
import {
  destroyMainWindow,
  ensureWindowMaximized,
  onWindowCloseRequested,
} from '../platform/tauri/window';
import { AppShell } from '../components/AppShell';
import { BrowserModeBanner } from '../components/BrowserModeBanner';
import { CommandPalette } from '../components/CommandPalette';
import { SettingsWindow } from '../components/SettingsWindow';
import { ViewErrorBoundary } from '../components/ViewErrorBoundary';
import { WelcomeDialog } from '../components/WelcomeDialog';
import { buildCommands } from './commands';
import { MAIN_NAV_VIEWS, NAV_VIEWS, SECONDARY_NAV_VIEWS, type ViewId } from './navigation';
import { editorModeForView, editorToolForView, resolveViewRoute, viewForEditorMode, type EditorModeId } from './view-routing';
import { duplicateClip, fpsOf, rippleDeleteClip, totalFrames } from '../state/project-actions';
import { detectNativeRuntime } from '../services/project-service';
import { useProjectPlaying, useProjectStore } from '../state/project-store';
import { collectSearchDocuments, createGlobalSearch, destinationOfHit, searchGlobal, type GlobalSearchDocument, type GlobalSearchHit, type GlobalSearchIndex } from '../state/global-search';
import { recordViewVisit } from '../state/learning-progress';
import { SHORTCUTS_CHANGED_EVENT, bindingMatches, eventToBinding, isActivatableTarget, loadShortcuts, normalizeBinding, type ShortcutId, type ShortcutMap } from '../state/shortcuts';



export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}



export interface ShellProps {
  readonly initialView?: ViewId;
  readonly onReturnToStart?: () => void;
}



export function Shell({ initialView = 'home', onReturnToStart }: ShellProps) {
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
  // T1: panel de herramientas activo DENTRO del editor. `toolView` es el host
  // canÃ³nico (download/creator/lab/...), `toolTab` la pestaÃ±a si venÃ­a de un
  // alias (youtube/convert/...). Sin proyecto estos estados no se usan.
  const [toolView, setToolView] = useState<ViewId | null>(null);
  const [toolTab, setToolTab] = useState<string | null>(null);
  const [toolRequest, setToolRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(initialView === 'settings');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Una sola instancia de cada ayuda, disponible desde CUALQUIER superficie,
  // incluido el editor. Antes estos dos componentes nunca se montaban.
  const [tourOpen, setTourOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openTour = useCallback(() => setTourOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const store = useProjectStore();
  const project = store.state.project;
  const hasProject = project !== null;
  // F2: con proyecto abierto, seis vistas de flujo se montan DENTRO del editor.
  // `activeId` sigue siendo el ViewId lÃ³gico para que el rail marque la
  // herramienta real; `editorSurface` indica que el shell es el del editor.
  const embeddedMode = hasProject ? editorModeForView(activeId) : undefined;
  const toolActive = hasProject && toolView !== null;
  const editorSurface = activeId === 'editor' || embeddedMode !== undefined || toolActive;
  const needsBothStyles = embeddedMode !== undefined || toolActive;
  // `playing` vive en su propio contexto: cambia sÃ³lo al play/pausa, asÃ­ que
  // la lista de comandos no se recalcula en cada frame del playhead.
  const playing = useProjectPlaying();
  // El rail es la lista corta de superficies; las herramientas avanzadas
  // quedan detrÃ¡s de Â«MÃ¡sÂ». El menÃº Ver sigue listando el rail visible.
  const railViews = MAIN_NAV_VIEWS;
  // Sin runtime nativo la app no tiene acceso al sistema de archivos: el aviso
  // persistente explica el modo antes de que el usuario choque con un error.
  const browserMode = !store.service.available;

  // Precarga de todos los chunks de vista en tiempo ocioso: cuando el usuario
  // hace clic, el mÃ³dulo ya estÃ¡ evaluado y el cambio no espera nada.
  useEffect(() => preloadViews(), []);

  // Estilo de la vista activa: se pide antes de renderizarla para que el primer
  // frame de esa vista ya salga con la capa premium aplicada (sin FOUC). El
  // contexto opuesto se prefetcha en ocioso para que la prÃ³xima navegaciÃ³n no
  // espere. En tests no hay fetch real: arranca resuelto para no cambiar el
  // render sÃ­ncrono de los casos existentes.
  const firstStyleKind = styleKindForView(activeId, needsBothStyles);
  const [styledKind, setStyledKind] = useState<ViewStyleKind | null>(() =>
    import.meta.env.MODE === 'test' ? styleKindForView(initialView) : null,
  );

  useEffect(() => {
    const kind = styleKindForView(activeId, needsBothStyles);
    if (import.meta.env.MODE === 'test') {
      setStyledKind(kind);
      return;
    }
    let active = true;
    void ensureViewStyles(kind).then(() => {
      if (active) setStyledKind(kind);
    });
    // Con 'both' ya estÃ¡n las dos capas; no hace falta prefetch del opuesto.
    if (kind !== 'both') {
      const other: ViewStyleKind = kind === 'editor' ? 'content' : 'editor';
      const timer = window.setTimeout(() => {
        void ensureViewStyles(other);
      }, 1_200);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    return () => {
      active = false;
    };
  }, [activeId, embeddedMode, toolActive, needsBothStyles]);

  // Al cambiar de modo dentro del editor el rail debe seguir marcando la
  // herramienta activa. No se incrementa `editorRequest`: el cambio se originÃ³
  // en EditorWorkspace, que ya tiene ese modo en su estado local.
  const handleModeChange = useCallback((mode: EditorModeId) => {
    setEditorMode(mode);
    setActiveId(viewForEditorMode(mode) ?? 'editor');
    // Cambiar de tab dentro del editor SIEMPRE abandona el panel de
    // herramientas: Ã©ste sÃ³lo existe en el modo Â«TodoÂ». AsÃ­ el mapa no queda
    // Â«pegadoÂ» al cambiar a Mezcla, Guion o EdiciÃ³n.
    setToolView(null);
    setToolTab(null);
  }, []);

  /** Vuelta al mapa desde el breadcrumb de una herramienta embebida. */
  const clearTool = useCallback(() => {
    setToolView(null);
    setToolTab(null);
    // Sin esto activeId quedaba en el host de la herramienta ('creator',
    // 'lab'â€¦) y renderView montaba su pantalla standalone, sacando al usuario
    // del editor. El mapa es un modo del editor: activeId vuelve a 'editor',
    // igual que en openToolMap.
    setActiveId('editor');
    setEditorMode('tools');
    setEditorRequest((request) => request + 1);
  }, []);

  /** Puerta Ãºnica Â«HerramientasÂ»: abre el mapa desde cualquier superficie. */
  const openToolMap = useCallback(() => {
    setToolView(null);
    setToolTab(null);
    setActiveId('editor');
    setEditorMode('tools');
    setEditorRequest((request) => request + 1);
  }, []);

  // Si el proyecto se abre estando ya en una herramienta (deep link, sesiÃ³n
  // recuperada), esa herramienta pasa a vivir dentro del editor. Sin proyecto
  // se limpia para que vuelva a ser una pantalla standalone con empty-state.
  useEffect(() => {
    if (!hasProject) {
      setToolView(null);
      setToolTab(null);
      return;
    }
    const tool = editorToolForView(activeId);
    if (!tool) return;
    setToolView(tool.view);
    setToolTab(tool.hubTab ?? null);
    setToolRequest((request) => request + 1);
    setEditorMode('tools');
  }, [hasProject]);

  const viewStylesReady =
    import.meta.env.MODE === 'test' || styledKind === firstStyleKind;

  useEffect(() => {
    try {
      recordViewVisit(activeId);
    } catch {
      // El progreso de aprendizaje es telemetrÃ­a local: si el almacenamiento
      // falla, la navegaciÃ³n no debe romperse.
    }
  }, [activeId]);

  const storeRef = useRef(store);
  storeRef.current = store;
  const saveNow = store.saveNow;

  useEffect(() => {
    // Salir del editor detiene la reproducciÃ³n: una vista oculta no debe seguir
    // sonando ni consumiendo cuadros. Las vistas embebidas SIGUEN siendo el
    // editor, asÃ­ que no cortan la reproducciÃ³n.
    if (!editorSurface && storeRef.current.getPlaying()) {
      storeRef.current.setPlaying(false);
    }
  }, [editorSurface]);

  // Al abrir el editor o un proyecto, la ventana pasa a pantalla completa.
  // DependÃ­a del objeto `project`: cada ediciÃ³n (incluso arrastrar un slider)
  // cambiaba su identidad y disparaba un `isMaximized()` por IPC. SÃ³lo hacen
  // falta dos primitivos estables: si hay proyecto y si el editor estÃ¡ activo.
  const editorVisible = editorSurface;
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    ensureWindowMaximized();
  }, [editorVisible, hasProject]);

  // Atajos personalizables: el ref se actualiza en vivo cuando el usuario
  // reasigna desde Ajustes â†’ Atajos (evento SHORTCUTS_CHANGED_EVENT). La
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
    // T1/F2: con proyecto, TODA herramienta se monta dentro del editor. F2
    // usa un modo propio; el resto usa el panel `tools` con su host y su tab.
    // El rail sigue marcando la vista lÃ³gica (activeId).
    const embeddedMode = hasProject ? editorModeForView(route.view) : undefined;
    const tool = hasProject ? editorToolForView(id) : undefined;
    setActiveId(route.view);
    setHubTab(route.hubTab ?? null);
    setHubRequest((request) => request + 1);
    if (tool) {
      setToolView(tool.view);
      setToolTab(tool.hubTab ?? null);
      setToolRequest((request) => request + 1);
      setEditorMode('tools');
      setEditorRequest((request) => request + 1);
      return;
    }
    setToolView(null);
    setToolTab(null);
    if (route.view === 'editor' || embeddedMode) {
      setEditorMode(embeddedMode ?? route.editorMode ?? 'timeline');
      setEditorRequest((request) => request + 1);
    }
  }, [hasProject]);

  useEffect(() => {
    const onMcpNavigate = (event: Event) => {
      const view = (event as CustomEvent<unknown>).detail;
      if (typeof view === 'string' && NAV_VIEWS.some((item) => item.id === view)) navigate(view as ViewId);
    };
    window.addEventListener('olyvia:mcp:navigate', onMcpNavigate);
    return () => window.removeEventListener('olyvia:mcp:navigate', onMcpNavigate);
  }, [navigate]);
  // Precalienta el motor de bÃºsqueda en un momento ocioso: el chunk ya estÃ¡
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

  // El Ã­ndice se arma al abrir la paleta, no en cada ediciÃ³n: la bÃºsqueda es
  // una acciÃ³n puntual y no debe encarecer el camino de escritura del proyecto.
  // MiniSearch llega por import() dinÃ¡mico, asÃ­ que el armado es asÃ­ncrono.
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

  // El tÃ­tulo depende del nombre, no del documento completo: antes cada
  // ediciÃ³n reescribÃ­a el tÃ­tulo de la ventana aunque no hubiera cambiado.
  const projectName = project?.name;
  useEffect(() => {
    document.title = projectName ? `${projectName} â€” Olyvia` : 'Olyvia';
  }, [projectName]);

  useEffect(() => {
    if (!detectNativeRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onWindowCloseRequested(async (event) => {
      const snapshot = storeRef.current.state;
      if (!snapshot.project) {
        return;
      }
      if (snapshot.phase !== 'dirty' && snapshot.phase !== 'failed') {
        if (snapshot.phase === 'saving') {
          event.preventDefault();
          storeRef.current.setNotice('El proyecto se estÃ¡ guardando; esperÃ¡ un instante y cerrÃ¡ de nuevo.');
        }
        return;
      }
      event.preventDefault();
      const saved = await saveNow();
      if (saved && !disposed) {
        await destroyMainWindow();
      }
    }).then((off) => {
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
      // El store cambia de identidad en cada frame de reproducciÃ³n. Leerlo
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
            store.setNotice('Clip eliminado; el hueco se cerrÃ³.');
          }
          return;
        }
        case 'edit.deselect':
          store.setSelection({ kind: 'none' });
          return;
        case 'playback.playPause':
          if (!store.state.project) return;
          // Fase 2 de accesibilidad (H16): si el foco estÃ¡ sobre un control
          // que se activa con Space (botÃ³n, Ã­tem de menÃº, clip de la
          // timelineâ€¦), dejar pasar el evento: el click de activaciÃ³n ocurre
          // en keyup y no se dispara si este keydown se previene.
          if (isActivatableTarget(event.target)) return;
          event.preventDefault();
          store.setPlaying(!store.getPlaying());
          return;
        case 'playback.shuttleForward':
        case 'playback.shuttleReverse': {
          if (!store.state.project) return;
          event.preventDefault();
          store.shuttlePress(matched === 'playback.shuttleForward' ? 1 : -1);
          return;
        }
        case 'playback.shuttlePause':
          if (!store.state.project) return;
          event.preventDefault();
          store.setPlaying(false);
          return;
        case 'playback.framePrev':
        case 'playback.frameNext':
        case 'playback.goToStart':
        case 'playback.goToEnd': {
          const current = store.state.project;
          if (!current) return;
          event.preventDefault();
          const fps = fpsOf(current);
          const duration = totalFrames(current);
          const frame = store.getPlayhead();
          const next =
            matched === 'playback.framePrev'
              ? Math.max(0, frame - 1)
              : matched === 'playback.frameNext'
                ? Math.min(duration, frame + 1)
                : matched === 'playback.goToStart'
                  ? 0
                  : duration;
          store.setPlaying(false);
          store.setPlayhead(next);
          return;
        }
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

  // Una sola vista activa: el cambio es inmediato porque el chunk ya estÃ¡
  // precargado en memoria, y asÃ­ ninguna vista oculta conserva estado, timers
  // ni audio. El fallback no muestra texto de carga. Si el CSS de esa vista aÃºn
  // no estÃ¡ aplicado se muestra el mismo fallback: nunca un frame sin estilos.
  const content = viewStylesReady ? (
    <ViewErrorBoundary
      resetKey={activeId}
      onHome={() => navigate('home')}
      onSettings={() => navigate('settings')}
    >
      <Suspense fallback={<ViewFallback />}>
          <WorkspaceView
            id={activeId}
            toolActive={toolActive}
            toolView={toolView}
            toolTab={toolTab}
            toolRequest={toolRequest}
            hasProject={hasProject}
            navigate={navigate}
            editorRequest={editorRequest}
            clearTool={clearTool}
            handleModeChange={handleModeChange}
            openTour={openTour}
            openShortcuts={openShortcuts}
            hubTab={hubTab}
            hubRequest={hubRequest}
            editorMode={editorMode}
          />
        </Suspense>
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
        onOpenTour={openTour}
        onOpenShortcuts={openShortcuts}
        onOpenToolMap={openToolMap}
        editorSurface={editorSurface}
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
          editorSurface ||
          activeId === 'script' ||
          activeId === 'assets' ||
          activeId === 'production' ||
          activeId === 'director' ||
          activeId === 'auto-edit' ||
          activeId === 'ai-hub' ||
          activeId === 'mcp'
        }
      />
      <WelcomeDialog onNavigate={navigate} onOpenTour={openTour} />
      {tourOpen ? (
        <Suspense fallback={null}>
          <OnboardingTour
            open
            onClose={() => setTourOpen(false)}
            onNavigate={navigate}
            currentView={activeId}
          />
        </Suspense>
      ) : null}
      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutsCheatSheet
            open
            onClose={() => setShortcutsOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </Suspense>
      ) : null}
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

