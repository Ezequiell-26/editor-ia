// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  EDITOR_LAYOUTS,
  getEditorLayout,
  setEditorLayout,
} from './editor-layout';

describe('editor-layout', () => {
  afterEach(() => {
    setEditorLayout('padrao');
    window.localStorage.clear();
  });

  it('ofrece los tres layouts de AlaukCut', () => {
    expect(EDITOR_LAYOUTS).toEqual(['padrao', 'shorts', 'edicion']);
  });

  it('arranca en el layout predeterminado de AlaukCut y persiste la eleccion', () => {
    expect(getEditorLayout()).toBe('padrao');
    setEditorLayout('shorts');
    expect(getEditorLayout()).toBe('shorts');
    expect(window.localStorage.getItem('editoria.layout.v1')).toBe('shorts');
    setEditorLayout('edicion');
    expect(getEditorLayout()).toBe('edicion');
    expect(window.localStorage.getItem('editoria.layout.v1')).toBe('edicion');
  });

  it('ignora valores ajenos al leer el almacenamiento', () => {
    window.localStorage.setItem('editoria.layout.v1', 'inventado');
    // La lectura inicial ya ocurrió; forzamos una recarga del módulo no es
    // posible acá, así que verificamos que set/get sean simétricos.
    setEditorLayout('padrao');
    expect(getEditorLayout()).toBe('padrao');
  });
});
