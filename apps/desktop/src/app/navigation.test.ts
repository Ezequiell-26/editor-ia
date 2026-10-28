import { describe, expect, it } from 'vitest';
import {
  MAIN_NAV_VIEWS,
  NAV_VIEWS,
  SECONDARY_NAV_VIEWS,
  type ViewId,
} from './navigation';

describe('registro de navegación', () => {
  it('expone las superficies principales en el orden del flujo de trabajo', () => {
    expect(MAIN_NAV_VIEWS.map((view) => view.id)).toEqual([
      'home',
      'projects',
      'script',
      'assets',
      'production',
      'editor',
      'download',
      'creator',
      'lab',
      'learn',
      'settings',
    ]);
  });

  it('agrupa el rail en inicio, ruta, herramientas y ayuda, sin mezclar grupos', () => {
    const groups = MAIN_NAV_VIEWS.map((view) => view.group);
    const collapsed = groups.filter((group, index) => group !== groups[index - 1]);
    expect(collapsed).toEqual(['inicio', 'ruta', 'herramientas', 'ayuda']);
  });

  it('numera los cinco pasos de la ruta en orden', () => {
    const steps = MAIN_NAV_VIEWS.filter((view) => view.group === 'ruta').map((view) =>
      /^Paso (\d)/.exec(view.hint)?.[1],
    );
    expect(steps).toEqual(['1', '2', '3', '4', '5']);
  });

  it('no repite etiquetas en el rail', () => {
    const labels = MAIN_NAV_VIEWS.map((view) => view.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('mantiene todas las vistas existentes y excluye IA/MCP del legado', () => {
    const all = new Set<ViewId>(NAV_VIEWS.map((view) => view.id));
    for (const id of [
      'youtube',
      'compliance',
      'factory',
      'convert',
      'lab',
      'ai-hub',
      'mcp',
    ]) {
      expect(all.has(id as ViewId)).toBe(true);
    }
    const secondary = SECONDARY_NAV_VIEWS.map((view) => view.id);
    expect(secondary).toContain('director');
    expect(secondary).toContain('motion');
    expect(secondary).not.toContain('script');
    expect(secondary).not.toContain('assets');
    expect(secondary).not.toContain('factory');
    expect(secondary).not.toContain('denoise');
    expect(secondary).not.toContain('ai-hub');
    expect(secondary).not.toContain('mcp');
  });
});
