import type { ViewId } from './navigation';
import { NAV_VIEWS } from './navigation';
import { getShortcut, type ShortcutId } from '../state/shortcuts';
import { WORKSPACE_GROUPS } from './workspace-map';

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly shortcut?: string | undefined;
  readonly action: () => void;
  readonly disabled?: boolean;
}

export type CommandContext = {
  navigate: (id: ViewId) => void;
  saveNow: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  packageProject: () => Promise<boolean>;
  openProject: () => Promise<boolean | undefined>;
  requestExport: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setPlaying: (playing: boolean) => void;
  playing: boolean;
  projectOpen: boolean;
  hasClips: boolean;
  setSelectionNone: () => void;
};

/** Atajo activo para un id (lee el registro personalizable). */
function keys(id: ShortcutId): string | undefined {
  return getShortcut(id);
}

const NAV_BY_ID = new Map(NAV_VIEWS.map((view) => [view.id, view]));

/** Atajos de navegación que ya existen en el registro personalizable. */
const NAV_SHORTCUTS: Partial<Record<ViewId, ShortcutId>> = {
  home: 'nav.home',
  editor: 'nav.editor',
  script: 'nav.script',
  assets: 'nav.assets',
  production: 'nav.production',
  factory: 'nav.factory',
  director: 'nav.director',
  download: 'nav.download',
  settings: 'nav.settings',
};

export function buildCommands(ctx: CommandContext): Command[] {
  // La paleta es la vía rápida para llegar a cualquier vista. Los comandos
  // nav.* se generan desde WORKSPACE_GROUPS (la única fuente del mapa): el
  // orden sigue los 4 grupos del estudio y la categoría es la del grupo, así
  // buscar «editar» o «preparar» encuentra las herramientas del recorrido.
  // Las etiquetas salen de NAV_VIEWS, nunca de una lista paralela.
  const navCommands: Command[] = WORKSPACE_GROUPS.flatMap((group) =>
    group.views.map((view) => {
      const shortcutId = NAV_SHORTCUTS[view];
      return {
        id: `nav.${view}`,
        label: NAV_BY_ID.get(view)?.label ?? view,
        category: group.label,
        shortcut: shortcutId ? keys(shortcutId) : undefined,
        action: () => ctx.navigate(view),
      };
    }),
  );

  return [
    ...navCommands,

    {
      id: 'file.save',
      label: 'Guardar proyecto',
      category: 'Archivo',
      shortcut: keys('file.save'),
      action: () => void ctx.saveNow(),
      disabled: !ctx.projectOpen,
    },
    {
      id: 'file.saveAs',
      label: 'Guardar como…',
      category: 'Archivo',
      shortcut: keys('file.saveAs'),
      action: () => void ctx.saveAs(),
      disabled: !ctx.projectOpen,
    },
    {
      id: 'file.package',
      label: 'Empaquetar proyecto (.zip)…',
      category: 'Archivo',
      action: () => void ctx.packageProject(),
      disabled: !ctx.projectOpen,
    },
    {
      id: 'file.open',
      label: 'Abrir proyecto…',
      category: 'Archivo',
      shortcut: keys('file.open'),
      action: () =>
        void ctx.openProject().then((ok) => {
          if (ok) ctx.navigate('editor');
        }),
    },
    {
      id: 'file.export',
      label: 'Exportar video',
      category: 'Archivo',
      shortcut: keys('file.export'),
      action: () => ctx.requestExport(),
      disabled: !ctx.hasClips,
    },

    {
      id: 'edit.undo',
      label: 'Deshacer',
      category: 'Editar',
      shortcut: keys('edit.undo'),
      action: () => ctx.undo(),
      disabled: !ctx.canUndo,
    },
    {
      id: 'edit.redo',
      label: 'Rehacer',
      category: 'Editar',
      shortcut: keys('edit.redo'),
      action: () => ctx.redo(),
      disabled: !ctx.canRedo,
    },
    {
      id: 'edit.deselect',
      label: 'Deseleccionar todo',
      category: 'Editar',
      shortcut: keys('edit.deselect'),
      action: () => ctx.setSelectionNone(),
    },

    {
      id: 'playback.playPause',
      label: ctx.playing ? 'Pausar' : 'Reproducir',
      category: 'Reproducción',
      shortcut: keys('playback.playPause'),
      action: () => ctx.setPlaying(!ctx.playing),
      disabled: !ctx.projectOpen,
    },
  ];
}

/** Fuzzy match simple: cada carácter de la query debe aparecer en orden en el texto. */
/** Minúsculas y sin tildes: "fabrica" tiene que encontrar "Fábrica". */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = foldText(query);
  const t = foldText(text);
  let i = 0;
  for (const char of t) {
    if (i < q.length && char === q[i]) i++;
  }
  return i === q.length;
}
