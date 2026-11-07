import { describe, expect, it, vi } from 'vitest';
import { buildCommands, type CommandContext } from './commands';
import { NAV_VIEWS } from './navigation';
import { WORKSPACE_GROUPS } from './workspace-map';

function context(): CommandContext {
  return {
    navigate: vi.fn(),
    saveNow: vi.fn(async () => true),
    saveAs: vi.fn(async () => true),
    packageProject: vi.fn(async () => true),
    openProject: vi.fn(async () => true),
    requestExport: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    setPlaying: vi.fn(),
    playing: false,
    projectOpen: true,
    hasClips: true,
    setSelectionNone: vi.fn(),
  };
}

describe('catálogo de comandos', () => {
  it('incluye todas las vistas del registro de navegación', () => {
    const commands = buildCommands(context());
    for (const view of NAV_VIEWS) {
      expect(
        commands.find((command) => command.id === `nav.${view.id}`),
        `falta nav.${view.id}`,
      ).toBeTruthy();
    }
  });

  it('no repite vistas y conserva atajos de las principales', () => {
    const commands = buildCommands(context());
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    const editor = commands.find((command) => command.id === 'nav.editor');
    expect(editor?.shortcut).toBeTruthy();
  });

  it('ordena la navegación por los grupos del mapa y usa su categoría', () => {
    const commands = buildCommands(context());
    const navCommands = commands.filter((command) => command.id.startsWith('nav.'));

    const expected = WORKSPACE_GROUPS.flatMap((group) =>
      group.views.map((view) => ({
        id: `nav.${view}`,
        category: group.label,
        label: NAV_VIEWS.find((nav) => nav.id === view)?.label,
      })),
    );

    expect(navCommands.map((command) => command.id)).toEqual(
      expected.map((entry) => entry.id),
    );
    for (const [index, entry] of expected.entries()) {
      const command = navCommands[index];
      expect(command?.category).toBe(entry.category);
      expect(command?.label).toBe(entry.label);
    }
  });
});
