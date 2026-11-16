import { describe, expect, it } from 'vitest';
import {
  MASK_POLYGON_PRESETS,
  heartMaskPoints,
  starMaskPoints,
} from './mask-presets';

describe('mask polygon presets (paridad mascara_desenho.js)', () => {
  it('la estrella tiene 10 puntos alternando radio externo e interno', () => {
    const points = starMaskPoints(0.5, 0.5, 0.32);
    expect(points).toHaveLength(10);
    const center = { x: 0.5, y: 0.5 };
    const radii = points.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    // 5 puntas externas (~0.32) y 5 internas (~0.128).
    expect(Math.max(...radii)).toBeCloseTo(0.32, 2);
    expect(Math.min(...radii)).toBeCloseTo(0.128, 2);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('el corazón tiene 12 puntos dentro del cuadro y forma de corazón', () => {
    const points = heartMaskPoints();
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.length).toBeLessThanOrEqual(16);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    // La base del corazón está abajo (y mayor) y la hendidura arriba.
    const ys = points.map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(0.8);
    expect(Math.min(...ys)).toBeLessThan(0.3);
    // El centro inferior tiene puntos (punta del corazón).
    const tip = points.reduce((best, p) => (p.y > best.y ? p : best));
    expect(tip.y).toBeGreaterThan(0.8);
    expect(Math.abs(tip.x - 0.5)).toBeLessThan(0.05);
  });

  it('la mitad diagonal es un triángulo que cubre x >= y', () => {
    const points = MASK_POLYGON_PRESETS.half();
    expect(points).toHaveLength(3);
    // Vértices (0,0), (1,0), (1,1): la región x>=y del cuadro.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: 1, y: 0 });
    expect(points[2]).toEqual({ x: 1, y: 1 });
  });

  it('la tira de cine tiene muescas de perforación arriba y abajo', () => {
    const points = MASK_POLYGON_PRESETS.film();
    expect(points).toHaveLength(12);
    // Borde exterior: x entre 0.18 y 0.82, y entre 0.32 y 0.68.
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0.18, 5);
    expect(Math.max(...xs)).toBeCloseTo(0.82, 5);
    expect(Math.min(...ys)).toBeCloseTo(0.32, 5);
    expect(Math.max(...ys)).toBeCloseTo(0.68, 5);
    // Hay puntos interiores (fondo de las muescas) separados del borde.
    const interior = points.filter((p) => p.y > 0.33 && p.y < 0.67);
    expect(interior.length).toBeGreaterThanOrEqual(4);
  });

  it('todos los presets respetan el tope de 16 puntos del schema', () => {
    for (const build of Object.values(MASK_POLYGON_PRESETS)) {
      const points = build();
      expect(points.length).toBeGreaterThanOrEqual(3);
      expect(points.length).toBeLessThanOrEqual(16);
    }
  });
});
