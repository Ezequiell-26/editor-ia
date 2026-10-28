import type { ViewId } from './navigation';
import { NAV_VIEWS } from './navigation';
import { getShortcut, type ShortcutId } from '../state/shortcuts';

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

export function buildCommands(ctx: CommandContext): Command[] {
  const nav = (id: ViewId, label: string, shortcutId?: ShortcutId): Command => ({
    id: `nav.${id}`,
    label,
    category: 'Navegar',
    shortcut: shortcutId ? keys(shortcutId) : undefined,
    action: () => ctx.navigate(id),
  });

  const primaryNavigation: Command[] = [
    nav('home', 'Inicio', 'nav.home'),
    nav('editor', 'Editor de video', 'nav.editor'),
    nav('script', 'Guion y escenas', 'nav.script'),
    nav('assets', 'Biblioteca', 'nav.assets'),
    nav('production', 'Producción', 'nav.production'),
    nav('factory', 'Fábrica', 'nav.factory'),
    nav('director', 'Director', 'nav.director'),
    nav('download', 'Descargar', 'nav.download'),
    nav('settings', 'Ajustes', 'nav.settings'),
    nav('compliance', 'Cumplimiento'),
    nav('convert', 'Conversión'),
    nav('learn', 'Aprender'),
    nav('mcp', 'Servidores MCP'),
    nav('projects', 'Proyectos'),
  ];
  // La paleta es la vía rápida para llegar a cualquier vista; se genera desde
  // el registro de navegación para que ninguna herramienta quede afuera al
  // agregar una vista nueva.
  const listedViews = new Set(
    primaryNavigation.map((command) => command.id.replace(/^nav\./, '')),
  );
  const extraNavigation = NAV_VIEWS.filter((view) => !listedViews.has(view.id)).map(
    (view) => nav(view.id, view.label),
  );

  return [
    ...primaryNavigation,
    ...extraNavigation,

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
