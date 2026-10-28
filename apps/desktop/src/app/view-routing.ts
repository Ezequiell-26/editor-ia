import type { ViewId } from './navigation';

/** Modos que viven dentro del Editor y conservan la timeline. */
export type EditorModeId =
  | 'timeline'
  | 'text-edit'
  | 'multicam'
  | 'mixer'
  | 'vfx'
  | 'motion'
  | 'visuals';

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
  upscale: { view: 'lab', tab: 'upscale' },
  compare: { view: 'lab', tab: 'compare' },
  background: { view: 'lab', tab: 'background' },
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
