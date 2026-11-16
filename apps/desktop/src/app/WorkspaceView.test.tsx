// @vitest-environment jsdom
import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ViewId } from './navigation';
import { EditorWorkspace } from './view-registry';
import { MinimalEditor } from '../features/editor/MinimalEditor';
import { WorkspaceView, type WorkspaceViewProps } from './WorkspaceView';
// MinimalEditor se importa sólo para el test negativo de P7: ya no se monta.

/**
 * UN SOLO MONTAJE (Etapa B1 de la unificación): `WorkspaceView` es una
 * función pura de props — el elemento que devuelve determina si React
 * conserva o destruye la instancia de `EditorWorkspace` al navegar.
 * Todas las vistas —incluida `settings`— deben compartir la MISMA raíz
 * (fragmento con `EditorWorkspace` primero). Ya no hay superficie propia
 * para Ajustes: es un panel del modo «Todo» del mismo editor.
 * Si alguna rama vuelve a devolver un tipo de raíz distinto, Preview,
 * Timeline y los motores se remontan en cada navegación.
 */

function baseProps(overrides: Partial<WorkspaceViewProps> = {}): WorkspaceViewProps {
  return {
    id: 'editor',
    toolActive: false,
    toolView: null,
    toolTab: null,
    toolRequest: 0,
    hasProject: true,
    navigate: () => {},
    editorRequest: 0,
    clearTool: () => {},
    handleModeChange: () => {},
    openTour: () => {},
    openShortcuts: () => {},
    hubTab: null,
    hubRequest: 0,
    editorMode: 'timeline',
    ...overrides,
  };
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node;
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    return Array.isArray(children) ? children : children === undefined ? [] : [children];
  }
  return [];
}

function workspaceChildren(id: ViewId, overrides: Partial<WorkspaceViewProps> = {}) {
  const node = WorkspaceView(baseProps({ id, ...overrides })) as ReactElement;
  expect(isValidElement(node)).toBe(true);
  return { node, children: childrenOf(node) };
}

describe('WorkspaceView · raíz única de editor', () => {
  it('toda vista de edición devuelve el mismo fragmento con EditorWorkspace primero', () => {
    const ids: ViewId[] = [
      'editor', 'home', 'projects', 'download', 'creator', 'lab', 'mcp', 'learn',
      'youtube', 'compliance', 'factory', 'convert', 'record',
      'script', 'assets', 'production', 'director', 'auto-edit', 'ai-hub',
      'text-edit', 'multicam', 'mixer', 'vfx', 'nodes', 'motion', 'visuals',
    ];
    for (const id of ids) {
      const { node, children } = workspaceChildren(id);
      // La raíz es un fragmento (symbol react.fragment) en TODAS las vistas
      // de edición — condición necesaria para que React no remonte.
      expect(node.type, `raíz de ${id}`).toBe(Fragment);
      const first = children[0] as ReactElement | undefined;
      expect(first && isValidElement(first) && first.type, `primer hijo de ${id}`)
        .toBe(EditorWorkspace);
      // Ninguna rama de edición puede montar un segundo editor.
      const editors = children.filter(
        (child) => isValidElement(child) && (child.type === EditorWorkspace),
      );
      expect(editors, `EditorWorkspace duplicado en ${id}`).toHaveLength(1);
    }
  });

  it('P7: MinimalEditor ya no se monta en NINGUNA condición (overlay retirado)', () => {
    // Antes existía un overlay `.minimal-editor` por encima del workspace
    // en editor+timeline+proyecto — duplicaba Timeline/Inspector/Assets y
    // dejaba un Preview oculto decodificando. P7 lo retiró: EditorWorkspace
    // ES la única superficie, con el chrome AlaukCut en modo timeline.
    const cases: [ViewId, Partial<WorkspaceViewProps>][] = [
      ['editor', {}],
      ['editor', { hasProject: false }],
      ['editor', { toolActive: true, toolView: 'download', toolTab: 'youtube' }],
      ['editor', { editorMode: 'auto-edit' }],
      ['download', {}],
    ];
    for (const [id, overrides] of cases) {
      const { children } = workspaceChildren(id, overrides);
      expect(
        children.some((child) => isValidElement(child) && child.type === MinimalEditor),
        `MinimalEditor montado en ${id} ${JSON.stringify(overrides)}`,
      ).toBe(false);
      expect(
        children.some((child) => isValidElement(child) && child.type === EditorWorkspace),
        `EditorWorkspace ausente en ${id}`,
      ).toBe(true);
    }
  });

  it('activar una herramienta no cambia la raíz ni el orden de los hijos', () => {
    const plain = workspaceChildren('editor');
    const tool = workspaceChildren('editor', {
      toolActive: true,
      toolView: 'lab',
      toolTab: 'convert',
    });
    // Misma raíz, mismo componente en la misma posición → misma instancia.
    expect(tool.node.type).toBe(plain.node.type);
    expect((tool.children[0] as ReactElement).type).toBe(
      (plain.children[0] as ReactElement).type,
    );
    // La herramienta llega como props del MISMO EditorWorkspace, no como vista nueva.
    const props = (tool.children[0] as ReactElement).props as Record<string, unknown>;
    expect(props.toolView).toBe('lab');
    expect(props.toolTab).toBe('convert');
    expect(props.initialMode).toBe('tools');
  });

  it('settings es un panel del MISMO editor (sin superficie propia)', () => {
    const { node, children } = workspaceChildren('settings');
    expect(node.type).toBe(Fragment);
    const first = children[0] as ReactElement | undefined;
    expect(first && isValidElement(first) && first.type).toBe(EditorWorkspace);
    const props = (first as ReactElement).props as Record<string, unknown>;
    expect(props.initialMode).toBe('tools');
    expect(props.toolView).toBe('settings');
  });
});
