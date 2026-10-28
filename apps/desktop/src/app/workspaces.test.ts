// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSPACES,
  defaultViewFor,
  loadWorkspace,
  saveWorkspace,
  workspaceForView,
} from './workspaces';

afterEach(() => {
  window.localStorage.clear();
});

describe('espacios de trabajo', () => {
  it('define los tres espacios comerciales con su vista por defecto', () => {
    expect(WORKSPACES.map((workspace) => workspace.id)).toEqual([
      'downloads',
      'creator',
      'studio',
    ]);
    expect(WORKSPACES.map((workspace) => workspace.label)).toEqual([
      'Ingesta',
      'Creador',
      'Studio',
    ]);
    expect(defaultViewFor('downloads', false)).toBe('download');
    expect(defaultViewFor('creator', true)).toBe('creator');
    expect(defaultViewFor('studio', false)).toBe('projects');
    expect(defaultViewFor('studio', true)).toBe('editor');
  });

  it('mapea cada vista a una píldora primaria coherente', () => {
    expect(workspaceForView('download')).toBe('downloads');
    expect(workspaceForView('creator')).toBe('creator');
    expect(workspaceForView('editor')).toBe('studio');
    expect(workspaceForView('lab')).toBe('studio');
    expect(workspaceForView('youtube')).toBe('downloads');
    expect(workspaceForView('factory')).toBe('creator');
    expect(workspaceForView('ai-hub')).toBe('studio');
    expect(workspaceForView('mcp')).toBe('studio');
    expect(workspaceForView('home')).toBeNull();
    expect(workspaceForView('settings')).toBeNull();
  });

  it('persiste y restaura el espacio, ignorando valores inválidos', () => {
    expect(loadWorkspace()).toBe('studio');
    saveWorkspace('creator');
    expect(window.localStorage.getItem('editor-ia.workspace.v1')).toBe('creator');
    expect(loadWorkspace()).toBe('creator');
    window.localStorage.setItem('editor-ia.workspace.v1', 'inventado');
    expect(loadWorkspace()).toBe('studio');
  });

  it('migra el desaparecido workspace de IA a Studio', () => {
    window.localStorage.setItem('editor-ia.workspace.v1', 'ai');
    expect(loadWorkspace()).toBe('studio');
  });
});
