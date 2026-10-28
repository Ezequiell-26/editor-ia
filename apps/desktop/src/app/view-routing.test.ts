import { describe, expect, it } from 'vitest';
import type { ViewId } from './navigation';
import { resolveViewRoute } from './view-routing';

describe('rutas canónicas', () => {
  it('lleva las herramientas de ingesta al hub Descargar', () => {
    expect(resolveViewRoute('youtube')).toEqual({
      view: 'download',
      hubTab: 'youtube',
    });
    expect(resolveViewRoute('compliance')).toEqual({
      view: 'download',
      hubTab: 'compliance',
    });
  });

  it('lleva la fábrica, miniaturas y localización al hub Creador', () => {
    for (const [id, tab] of [
      ['factory', 'factory'],
      ['thumbnails', 'thumbnails'],
      ['localization', 'localization'],
    ] as const) {
      expect(resolveViewRoute(id)).toEqual({ view: 'creator', hubTab: tab });
    }
  });

  it('lleva las utilidades al Laboratorio con su tab', () => {
    for (const tab of [
      'convert',
      'compress',
      'denoise',
      'upscale',
      'compare',
      'background',
    ] as const) {
      expect(resolveViewRoute(tab)).toEqual({ view: 'lab', hubTab: tab });
    }
  });

  it('lleva los modos del editor a la tab correspondiente', () => {
    for (const mode of [
      'text-edit',
      'multicam',
      'mixer',
      'vfx',
      'motion',
      'visuals',
    ] as const) {
      expect(resolveViewRoute(mode)).toEqual({ view: 'editor', editorMode: mode });
    }
  });

  it('deja intactas las superficies canónicas', () => {
    const canonical: ViewId[] = [
      'home',
      'download',
      'creator',
      'projects',
      'lab',
      'production',
      'learn',
      'settings',
      'script',
      'assets',
      'director',
      'auto-edit',
      'ai-hub',
      'mcp',
    ];
    for (const id of canonical) {
      expect(resolveViewRoute(id)).toEqual({ view: id });
    }
    expect(resolveViewRoute('editor')).toEqual({
      view: 'editor',
      editorMode: 'timeline',
    });
  });
});
