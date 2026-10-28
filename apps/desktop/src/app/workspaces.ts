import type { IconName } from '../components/Icon';
import type { ViewId } from './navigation';

export type WorkspaceId = 'downloads' | 'creator' | 'studio';

export interface Workspace {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly icon: IconName;
  readonly hint: string;
  readonly defaultView: ViewId;
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'downloads',
    label: 'Ingesta',
    icon: 'download',
    hint: 'Bajar, analizar canales y preparar material',
    defaultView: 'download',
  },
  {
    id: 'creator',
    label: 'Creador',
    icon: 'sparkles',
    hint: 'Hooks, formatos, miniaturas y contenido para redes',
    defaultView: 'creator',
  },
  {
    id: 'studio',
    label: 'Studio',
    icon: 'editor',
    hint: 'Timeline, VFX, audio, laboratorio y exportación',
    defaultView: 'editor',
  },
];

const STORAGE_KEY = 'editor-ia.workspace.v1';

const PRIMARY_WORKSPACE: Readonly<Partial<Record<ViewId, WorkspaceId>>> = {
  download: 'downloads',
  youtube: 'downloads',
  compliance: 'downloads',
  creator: 'creator',
  factory: 'creator',
  director: 'creator',
  'auto-edit': 'creator',
  thumbnails: 'creator',
  localization: 'creator',
  projects: 'studio',
  script: 'studio',
  assets: 'studio',
  production: 'studio',
  editor: 'studio',
  lab: 'studio',
  'text-edit': 'studio',
  multicam: 'studio',
  mixer: 'studio',
  vfx: 'studio',
  motion: 'studio',
  visuals: 'studio',
  convert: 'studio',
  compress: 'studio',
  denoise: 'studio',
  background: 'studio',
  upscale: 'studio',
  compare: 'studio',
  'ai-hub': 'studio',
  mcp: 'studio',
};

export function workspaceForView(view: ViewId): WorkspaceId | null {
  return PRIMARY_WORKSPACE[view] ?? null;
}

export function defaultViewFor(workspace: WorkspaceId, hasProject: boolean): ViewId {
  if (workspace === 'studio') return hasProject ? 'editor' : 'projects';
  return WORKSPACES.find((item) => item.id === workspace)?.defaultView ?? 'home';
}

export function loadWorkspace(): WorkspaceId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // «AI Hub» dejó de ser un workspace; su última selección cae en Studio.
    if (stored === 'ai') return 'studio';
    if (stored === 'downloads' || stored === 'creator' || stored === 'studio') {
      return stored;
    }
  } catch {
    // Sin almacenamiento: el espacio de trabajo queda en memoria.
  }
  return 'studio';
}

export function saveWorkspace(workspace: WorkspaceId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, workspace);
  } catch {
    // Sin almacenamiento: el espacio de trabajo queda en memoria.
  }
}
