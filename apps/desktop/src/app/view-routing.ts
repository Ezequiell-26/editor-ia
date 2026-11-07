import type { ViewId } from './navigation';

/** Modos que viven dentro del Editor y conservan la timeline. */
export type EditorModeId =
  | 'timeline'
  | 'brain'
  | 'text-edit'
  | 'multicam'
  | 'mixer'
  | 'vfx'
  | 'motion'
  | 'visuals'
  | 'guide'
  // T2: mapa único de TODAS las herramientas dentro del editor.
  | 'tools'
  // F2: vistas de flujo que, con proyecto abierto, viven DENTRO del editor.
  | 'script'
  | 'assets'
  | 'production'
  | 'director'
  | 'auto-edit'
  | 'ai-hub';

export interface ResolvedViewRoute {
  readonly view: ViewId;
  readonly hubTab?: string;
  readonly editorMode?: EditorModeId;
}

const HUB_ALIASES: Readonly<
  Partial<Record<ViewId, { readonly view: ViewId; readonly tab: string }>>
> = {
  youtube: { view: 'download', tab: 'youtube' },
  compliance: { view: 'download', tab: 'compliance' },
  factory: { view: 'creator', tab: 'factory' },
  thumbnails: { view: 'creator', tab: 'thumbnails' },
  localization: { view: 'creator', tab: 'localization' },
  convert: { view: 'lab', tab: 'convert' },
  compress: { view: 'lab', tab: 'compress' },
  denoise: { view: 'lab', tab: 'denoise' },
  sharpen: { view: 'lab', tab: 'sharpen' },
  upscale: { view: 'lab', tab: 'upscale' },
  compare: { view: 'lab', tab: 'compare' },
  background: { view: 'lab', tab: 'background' },
  record: { view: 'lab', tab: 'record' },
};

const EDITOR_MODE_ALIASES: Readonly<Partial<Record<ViewId, EditorModeId>>> = {
  'text-edit': 'text-edit',
  multicam: 'multicam',
  mixer: 'mixer',
  vfx: 'vfx',
  motion: 'motion',
  visuals: 'visuals',
};

/**
 * Normaliza cualquier vista a su superficie canónica. Las rutas antiguas se
 * conservan para deep links y la paleta, pero ya no renderizan una pantalla
 * duplicada: abren el hub o el modo del editor que les corresponde.
 */
export function resolveViewRoute(id: ViewId): ResolvedViewRoute {
  const hub = HUB_ALIASES[id];
  if (hub) return { view: hub.view, hubTab: hub.tab };
  if (id === 'editor') return { view: 'editor', editorMode: 'timeline' };
  const editorMode = EDITOR_MODE_ALIASES[id];
  if (editorMode) return { view: 'editor', editorMode };
  return { view: id };
}

/**
 * F2 · ÚNICA fuente de verdad del mapa «vista de flujo → modo del editor».
 *
 * `resolveViewRoute` se deja intacto a propósito: es el contrato de los deep
 * links, de `workspace-map.ts` y de sus tests. La decisión de montar una vista
 * dentro del editor depende de si HAY proyecto abierto, y eso sólo lo sabe
 * `App.tsx`. Sin proyecto se conserva la pantalla standalone con su
 * empty-state real (no hay timeline que preservar).
 */
export const EDITOR_EMBEDDED_VIEWS: Readonly<
  Partial<Record<ViewId, EditorModeId>>
> = {
  script: 'script',
  assets: 'assets',
  production: 'production',
  director: 'director',
  'auto-edit': 'auto-edit',
  'ai-hub': 'ai-hub',
};

/** Modo del editor que corresponde a una vista de flujo, si existe. */
export function editorModeForView(id: ViewId): EditorModeId | undefined {
  return EDITOR_EMBEDDED_VIEWS[id];
}

/** Inversa: permite que el rail siga marcando la herramienta activa. */
export function viewForEditorMode(mode: EditorModeId): ViewId | undefined {
  return (Object.keys(EDITOR_EMBEDDED_VIEWS) as ViewId[]).find(
    (id) => EDITOR_EMBEDDED_VIEWS[id] === mode,
  );
}

/**
 * T1 · Hosts de herramientas que, con proyecto abierto, se montan como PANEL
 * del editor (modo `tools`). Son las 7 superficies canónicas que no son el
 * editor, ni Ajustes (ventana flotante del sistema), ni las 6 de F2, ni los
 * 6 alias a modos. Los 12 alias a hubs NO se listan acá: se derivan de
 * `HUB_ALIASES` vía `resolveViewRoute`, así no hay una segunda lista que
 * mantener. Una sola fuente de verdad, 33 ViewId cubiertos.
 */
export const EDITOR_TOOL_HOSTS: ReadonlySet<ViewId> = new Set<ViewId>([
  'home',
  'projects',
  'download',
  'creator',
  'lab',
  'mcp',
  'learn',
]);

export interface EditorToolRoute {
  /** Host canónico que se monta dentro del editor. */
  readonly view: ViewId;
  /** Pestaña inicial cuando la herramienta original era un alias de hub. */
  readonly hubTab?: string;
}

/**
 * Resuelve CUALQUIER `ViewId` a un panel de herramientas del editor.
 * `youtube` -> { view:'download', hubTab:'youtube' }; `lab` -> { view:'lab' };
 * `editor`, `settings`, `mixer`, `script` -> undefined (los atienden otras
 * ramas de App.tsx). No modifica `resolveViewRoute`.
 */
export function editorToolForView(id: ViewId): EditorToolRoute | undefined {
  const route = resolveViewRoute(id);
  if (!EDITOR_TOOL_HOSTS.has(route.view)) return undefined;
  return route.hubTab
    ? { view: route.view, hubTab: route.hubTab }
    : { view: route.view };
}

/** ¿La vista ES una superficie del editor (no una herramienta que se embebe)? */
export function isEditorHost(id: ViewId): boolean {
  return id === 'editor';
}
