import { describe, expect, it } from 'vitest';
import {
  afterClip,
  clampPosition,
  isDifferenceMode,
  modeLabel,
  positionFromPointerX,
  positionFromPointerY,
  stepForKey,
  zoomTransform,
} from './before-after';

describe('comparador antes/después', () => {
  it('acota la posición y redondea a décimas', () => {
    expect(clampPosition(43.24)).toBe(43.2);
    expect(clampPosition(-12)).toBe(0);
    expect(clampPosition(145)).toBe(100);
    expect(clampPosition(Number.NaN)).toBe(50);
  });

  it('calcula la posición desde el puntero en el ancho real del contenedor', () => {
    const rect = {
      width: 800,
      height: 400,
      left: 100,
      top: 50,
    } as DOMRect;
    expect(positionFromPointerX(100, rect)).toBe(0);
    expect(positionFromPointerX(500, rect)).toBe(50);
    expect(positionFromPointerX(900, rect)).toBe(100);
    // Fuera de los bordes se acota, no se pasa.
    expect(positionFromPointerX(-50, rect)).toBe(0);
    expect(positionFromPointerX(2000, rect)).toBe(100);
    expect(positionFromPointerX(400, { ...rect, width: 0 })).toBe(50);
  });

  it('hace lo propio en vertical', () => {
    const rect = { width: 100, height: 200, left: 0, top: 40 } as DOMRect;
    expect(positionFromPointerY(40, rect)).toBe(0);
    expect(positionFromPointerY(240, rect)).toBe(100);
    expect(positionFromPointerY(140, rect)).toBe(50);
  });

  it('mueve con teclado: 1 %, 10 % con Shift, y saltos a los extremos', () => {
    expect(stepForKey('ArrowRight', false)).toBe(1);
    expect(stepForKey('ArrowLeft', false)).toBe(-1);
    expect(stepForKey('ArrowRight', true)).toBe(10);
    expect(stepForKey('ArrowUp', true)).toBe(10);
    expect(stepForKey('ArrowDown', false)).toBe(-1);
    expect(stepForKey('Home', false)).toBe(-Infinity);
    expect(stepForKey('End', false)).toBe(Infinity);
    expect(stepForKey('a', false)).toBeNull();
  });

  it('recorta la capa posterior en la línea', () => {
    expect(afterClip(30)).toBe('inset(0 0 0 30%)');
    expect(afterClip(0)).toBe('inset(0 0 0 0%)');
    expect(afterClip(100)).toBe('inset(0 0 0 100%)');
  });

  it('aplica zoom acotado entre 1× y 8×', () => {
    expect(zoomTransform(1)).toBe('scale(1)');
    expect(zoomTransform(2.5)).toBe('scale(2.5)');
    expect(zoomTransform(0)).toBe('scale(1)');
    expect(zoomTransform(99)).toBe('scale(8)');
  });

  it('expone los modos con su etiqueta', () => {
    expect(isDifferenceMode('slider')).toBe(false);
    expect(isDifferenceMode('difference')).toBe(true);
    expect(modeLabel('slider')).toBe('Deslizar');
    expect(modeLabel('difference')).toBe('Diferencia');
  });
});
