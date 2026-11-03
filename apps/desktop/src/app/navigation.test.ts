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

  it('descubre AI Hub y MCP en «Más» sin duplicar las puertas de los hubs', () => {
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
    // Las superficies de IA estaban sólo en la paleta o en Ajustes.
    expect(secondary).toContain('ai-hub');
    expect(secondary).toContain('mcp');
    expect(secondary).not.toContain('script');
    expect(secondary).not.toContain('assets');
    // Lo que ya vive dentro de un hub no repite puerta en «Más».
    expect(secondary).not.toContain('factory');
    expect(secondary).not.toContain('denoise');
  });

  it('describe AI Hub y Director por lo que hacen de verdad, sin prometer LLM', () => {
    const byId = new Map(NAV_VIEWS.map((view) => [view.id, view]));
    const aiHub = byId.get('ai-hub');
    const director = byId.get('director');
    expect(aiHub?.hint).toMatch(/prompts/i);
    expect(aiHub?.hint).toMatch(/briefs/i);
    expect(aiHub?.hint).toMatch(/operador local/i);
    // El AI Hub compone prompts y ejecuta un operador determinista: no llama a
    // un modelo ni gasta tokens, así que el hint no debe sugerirlo.
    expect(aiHub?.hint).not.toMatch(/modelos locales con tokens/i);
    expect(aiHub?.hint).not.toMatch(/genera con un modelo/i);
    // Director usa heurísticas y el modelo de rostros: no es un LLM. Puede
    // aclararlo explícitamente ("sin LLM"), lo que no puede es prometer uno.
    expect(director?.hint).not.toMatch(/Director IA/i);
    expect(director?.hint).not.toMatch(/con un modelo de lenguaje/i);
    expect(director?.hint).toMatch(/heurística|análisis/i);
  });
});
