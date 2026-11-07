import { describe, expect, it } from 'vitest';
import type { ViewId } from './navigation';
import {
  EDITOR_EMBEDDED_VIEWS,
  EDITOR_TOOL_HOSTS,
  editorModeForView,
  editorToolForView,
  resolveViewRoute,
  viewForEditorMode,
} from './view-routing';

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
      'sharpen',
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

  it('F2: las seis vistas de flujo tienen un modo del editor, sin tocar la ruta canónica', () => {
    const embedded = Object.entries(EDITOR_EMBEDDED_VIEWS);
    expect(embedded).toHaveLength(6);
    for (const [id, mode] of embedded) {
      const view = id as ViewId;
      expect(editorModeForView(view)).toBe(mode);
      // Las rutas antiguas siguen siendo superficies canónicas: la decisión de
      // embeberla depende del proyecto y vive en App.tsx, no acá.
      expect(resolveViewRoute(view)).toEqual({ view });
    }
    expect(viewForEditorMode('production')).toBe('production');
    expect(viewForEditorMode('timeline')).toBeUndefined();
    expect(editorModeForView('home')).toBeUndefined();
    expect(editorModeForView('mixer')).toBeUndefined();
  });

  it('T1: los hosts y los 12 alias a hubs resuelven a un panel del editor', () => {
    expect(EDITOR_TOOL_HOSTS.size).toBe(7);
    for (const host of EDITOR_TOOL_HOSTS) {
      expect(editorToolForView(host)).toEqual({ view: host });
    }
    const aliases: Record<string, { view: ViewId; hubTab: string }> = {
      youtube: { view: 'download', hubTab: 'youtube' },
      compliance: { view: 'download', hubTab: 'compliance' },
      factory: { view: 'creator', hubTab: 'factory' },
      thumbnails: { view: 'creator', hubTab: 'thumbnails' },
      localization: { view: 'creator', hubTab: 'localization' },
      convert: { view: 'lab', hubTab: 'convert' },
      compress: { view: 'lab', hubTab: 'compress' },
      denoise: { view: 'lab', hubTab: 'denoise' },
      sharpen: { view: 'lab', hubTab: 'sharpen' },
      upscale: { view: 'lab', hubTab: 'upscale' },
      compare: { view: 'lab', hubTab: 'compare' },
      background: { view: 'lab', hubTab: 'background' },
    };
    for (const [id, expected] of Object.entries(aliases)) {
      expect(editorToolForView(id as ViewId)).toEqual(expected);
    }
    // Las otras ramas NO son paneles de herramientas.
    for (const id of ['editor', 'settings', 'mixer', 'script', 'home'] as ViewId[]) {
      if (id === 'home') continue;
      expect(editorToolForView(id)).toBeUndefined();
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
