import { describe, expect, it } from 'vitest';
import { APP_CURSOR_OPTIONS, appCursorCss } from './app-cursor';

describe('appCursorCss', () => {
  it('system devuelve el cursor heredado', () => {
    expect(appCursorCss('system')).toBe('auto');
  });

  it('cada estilo propio emite un data-URI SVG con hotspot y fallback', () => {
    for (const style of ['classico', 'cheia', '3d'] as const) {
      const css = appCursorCss(style);
      expect(css).toMatch(/^url\("data:image\/svg\+xml;utf8,/);
      expect(css).toContain('") 6 4, auto');
      expect(css).toContain(encodeURIComponent('<svg'));
    }
  });

  it('los tres estilos producen imágenes distintas', () => {
    const images = new Set(
      (['classico', 'cheia', '3d'] as const).map((style) => appCursorCss(style)),
    );
    expect(images.size).toBe(3);
  });

  it('las opciones de Ajustes cubren los cuatro estilos', () => {
    expect(APP_CURSOR_OPTIONS.map((option) => option.value)).toEqual([
      'system',
      'classico',
      'cheia',
      '3d',
    ]);
  });
});
