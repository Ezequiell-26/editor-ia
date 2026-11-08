import { lazy } from 'react';
import type { ViewId } from './navigation';


// Ayudas bajo demanda: no pertenecen al arranque (antes ni se montaban).
export const OnboardingTour = lazy(() =>
  import('../components/OnboardingTour').then((module) => ({ default: module.OnboardingTour })),
);

export const ShortcutsCheatSheet = lazy(() =>
  import('../components/ShortcutsCheatSheet').then((module) => ({
    default: module.ShortcutsCheatSheet,
  })),
);



// â”€â”€ CSS no crÃ­tico por contexto de vista â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// El launcher arranca sÃ³lo con el CSS crÃ­tico importado en `main.tsx`. La capa
// premium del editor (workspace) y la de contenido (views) â€” junto con sus
// hojas legacy â€” viven en un entry dinÃ¡mico cada una: se cargan antes de montar
// la primera vista (sin FOUC) y el otro contexto se prefetcha en ocioso. Ver
// docs/CSS-PERF-NOTES.md Â§5.
export const EDITOR_STYLE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'editor',
  'text-edit',
  'multicam',
  'mixer',
  'vfx',
  'motion',
  'visuals',
]);

export const loadEditorStyles = () => import('../styles/entries/editor.css');

export const loadContentStyles = () => import('../styles/entries/content.css');

export const viewStyleLoaders = {
  editor: loadEditorStyles,
  content: loadContentStyles,
  // F2: una vista de flujo embebida necesita AMBAS capas: la del workspace
  // (.editor-grid / .editor-mode-panel) y la de contenido (.view de la vista).
  // Vite deduplica los mÃ³dulos ya evaluados, asÃ­ que no hay costo de red extra.
  both: () => Promise.all([loadEditorStyles(), loadContentStyles()]),
} as const;

export type ViewStyleKind = keyof typeof viewStyleLoaders;

export const viewStyleCache = new Map<ViewStyleKind, Promise<unknown>>();


export function styleKindForView(view: ViewId, embedded = false): ViewStyleKind {
  if (embedded) return 'both';
  return EDITOR_STYLE_VIEWS.has(view) ? 'editor' : 'content';
}


export function ensureViewStyles(kind: ViewStyleKind): Promise<unknown> {
  let pending = viewStyleCache.get(kind);
  if (!pending) {
    pending = viewStyleLoaders[kind]().catch((error: unknown) => {
      // Un CSS que no carga no debe romper la vista: se registra y sigue con el
      // CSS crÃ­tico (peor look, nunca pantalla en blanco).
      console.error('No se pudieron cargar los estilos de las vistas', error);
    });
    viewStyleCache.set(kind, pending);
  }
  return pending;
}


// Cada superficie CANÃ“NICA se carga una vez. Los 18 `ViewId` que
// `resolveViewRoute` normaliza a un hub o a un modo del editor NO tienen
// loader acÃ¡: sus componentes los importa el hub/editor que los contiene.
// Antes habÃ­a un loader por cada ViewId y 18 quedaban muertos en el arranque.
export const loadHome = () =>
  import('../features/home/HomeView').then((module) => ({ default: module.HomeView }));

export const loadProduction = () =>
  import('../features/production/ProductionView').then((module) => ({
    default: module.ProductionView,
  }));

export const loadCreator = () =>
  import('../features/creator/CreatorHubView').then((module) => ({
    default: module.CreatorHubView,
  }));

export const loadDirector = () =>
  import('../features/director/DirectorView').then((module) => ({ default: module.DirectorView }));

export const loadAutoEdit = () =>
  import('../features/autoedit/AutoEditView').then((module) => ({
    default: module.AutoEditView,
  }));

export const loadEditor = () =>
  import('../features/editor/EditorWorkspace').then((module) => ({
    default: module.EditorWorkspace,
  }));

export const loadScript = () =>
  import('../features/script/ScriptView').then((module) => ({ default: module.ScriptView }));

export const loadAssets = () =>
  import('../features/assets/AssetsPanel').then((module) => ({ default: module.AssetsPanel }));

export const loadAiHub = () =>
  import('../features/ai-hub/AiHubView').then((module) => ({ default: module.AiHubView }));

export const loadDownload = () =>
  import('../features/download/DownloadsHubView').then((module) => ({
    default: module.DownloadsHubView,
  }));

export const loadLab = () =>
  import('../features/lab/MediaLabView').then((module) => ({
    default: module.MediaLabView,
  }));

export const loadLearn = () =>
  import('../features/learn/LearnView').then((module) => ({ default: module.LearnView }));

export const loadMcp = () =>
  import('../features/mcp/McpView').then((module) => ({ default: module.McpView }));

export const loadSettings = () =>
  import('../features/settings/SettingsHome').then((module) => ({ default: module.SettingsHome }));

export const loadNodes = () =>
  import('../features/nodes/NodeGraphView').then((module) => ({ default: module.NodeGraphView }));


export const HomeView = lazy(loadHome);

export const ProductionView = lazy(loadProduction);

export const CreatorHubView = lazy(loadCreator);

export const DirectorView = lazy(loadDirector);

export const AutoEditView = lazy(loadAutoEdit);

export const EditorWorkspace = lazy(loadEditor);

export const ScriptView = lazy(loadScript);

export const AssetsPanel = lazy(loadAssets);

export const AiHubView = lazy(loadAiHub);

export const DownloadsHubView = lazy(loadDownload);

export const MediaLabView = lazy(loadLab);

export const LearnView = lazy(loadLearn);

export const McpView = lazy(loadMcp);

export const NodeGraphView = lazy(loadNodes);

export const SettingsHome = lazy(loadSettings);


/** Precargadores SOLO de superficies canÃ³nicas (las que tiene `renderView`). */
export const VIEW_PRELOADERS: Partial<Record<ViewId, () => Promise<unknown>>> = {
  home: loadHome,
  director: loadDirector,
  'auto-edit': loadAutoEdit,
  production: loadProduction,
  creator: loadCreator,
  editor: loadEditor,
  lab: loadLab,
  script: loadScript,
  assets: loadAssets,
  download: loadDownload,
  'ai-hub': loadAiHub,
  learn: loadLearn,
  mcp: loadMcp,
  nodes: loadNodes,
  settings: loadSettings,
};


/**
 * Descarga los chunks de las vistas de uso frecuente sin bloquear el arranque.
 * Antes se precargaban las 27 vistas en los primeros segundos (â‰ˆ1,5 MB de JS
 * evaluado): eso competÃ­a con la primera pintura. Las vistas secundarias se
 * cargan al abrirse; Ã©stas cubren el recorrido habitual.
 */
export const PRIMARY_PRELOADS: readonly Exclude<ViewId, 'projects'>[] = [
  'home',
  'editor',
  'assets',
  'download',
];


export function preloadViews(): () => void {
  let cancelled = false;
  let timer: number | null = null;
  const ids = PRIMARY_PRELOADS;
  let index = 0;
  const step = (): void => {
    if (cancelled || index >= ids.length) return;
    const loader = VIEW_PRELOADERS[ids[index]!];
    index += 1;
    if (!loader) {
      step();
      return;
    }
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
 * espera que el usuario no pidiÃ³.
 */
export function ViewFallback() {
  return (
    <div className="view-loading" aria-hidden="true">
      <span className="view-loading-dot" />
    </div>
  );
}

