import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SLIDER_MAX,
  sliderFromZoom,
  zoomFromSlider,
} from './timeline-zoom';

describe('zoom de timeline · escala logarítmica', () => {
  it('los extremos del slider coinciden con los límites reales', () => {
    expect(zoomFromSlider(0)).toBeCloseTo(ZOOM_MIN, 6);
    expect(zoomFromSlider(ZOOM_SLIDER_MAX)).toBeCloseTo(ZOOM_MAX, 6);
  });

  it('es monótono creciente en todo el rango', () => {
    let previous = 0;
    for (let position = 0; position <= ZOOM_SLIDER_MAX; position += 1) {
      const value = zoomFromSlider(position);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('cada tramo de 10 posiciones multiplica por el mismo factor', () => {
    const factors: number[] = [];
    for (let position = 0; position < ZOOM_SLIDER_MAX; position += 10) {
      factors.push(zoomFromSlider(position + 10) / zoomFromSlider(position));
    }
    const first = factors[0]!;
    for (const factor of factors) expect(factor).toBeCloseTo(first, 8);
  });

  it('la inversa recupera el zoom dentro de la cuantización del slider', () => {
    // El slider es entero (step=1 sobre 100 posiciones): en escala logarítmica
    // cada paso vale ~4,25 % y el redondeo introduce como máximo ~2,1 %.
    for (const zoom of [0.2, 0.5, 1, 2.4, 6, 14]) {
      const restored = zoomFromSlider(sliderFromZoom(zoom));
      expect(Math.abs(restored - zoom) / zoom).toBeLessThan(0.025);
    }
  });

  it('acota entradas fuera de rango y valores no finitos', () => {
    expect(zoomFromSlider(-50)).toBeCloseTo(ZOOM_MIN, 6);
    expect(zoomFromSlider(9999)).toBeCloseTo(ZOOM_MAX, 6);
    expect(zoomFromSlider(Number.NaN)).toBeCloseTo(ZOOM_MIN, 6);
    expect(sliderFromZoom(0.01)).toBe(0);
    expect(sliderFromZoom(1000)).toBe(ZOOM_SLIDER_MAX);
  });
});
