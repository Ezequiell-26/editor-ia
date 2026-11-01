import { describe, expect, it } from 'vitest';
import { frameRangeIsVisible, visibleFrameRange } from './visible-range';

describe('rango visible de la timeline', () => {
  it('descuenta el encabezado y el overscan al convertir píxeles a frames', () => {
    const range = visibleFrameRange({
      scrollLeft: 168 + 240,
      viewportWidth: 1_200,
      pxPerFrame: 2.4,
      headerPx: 168,
      overscanPx: 120,
    });
    // 240−120 = 120 px → frame 50; 240+1200+120 = 1560 px → frame 650.
    expect(range.start).toBe(50);
    expect(range.end).toBe(650);
  });

  it('nunca arranca antes del frame 0', () => {
    const range = visibleFrameRange({
      scrollLeft: 0,
      viewportWidth: 800,
      pxPerFrame: 2,
      headerPx: 168,
      overscanPx: 100,
    });
    expect(range.start).toBe(0);
    expect(range.end).toBe(366);
  });

  it('sin viewport medido devuelve el rango completo', () => {
    const range = visibleFrameRange({
      scrollLeft: 500,
      viewportWidth: 0,
      pxPerFrame: 2,
      headerPx: 168,
    });
    expect(range.start).toBe(0);
    expect(range.end).toBe(Number.POSITIVE_INFINITY);
  });

  it('sin zoom válido devuelve el rango completo en vez de ocultar todo', () => {
    const range = visibleFrameRange({
      scrollLeft: 0,
      viewportWidth: 800,
      pxPerFrame: 0,
      headerPx: 168,
    });
    expect(range.end).toBe(Number.POSITIVE_INFINITY);
  });

  it('considera visible el clip que empieza antes y termina dentro del rango', () => {
    const range = { start: 100, end: 200 };
    expect(frameRangeIsVisible(80, 40, range)).toBe(true);
    expect(frameRangeIsVisible(150, 10, range)).toBe(true);
    expect(frameRangeIsVisible(190, 40, range)).toBe(true);
    expect(frameRangeIsVisible(200, 10, range)).toBe(false);
    expect(frameRangeIsVisible(60, 40, range)).toBe(false);
  });
});
