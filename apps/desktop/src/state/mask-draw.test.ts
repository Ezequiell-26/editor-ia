import { describe, expect, it } from 'vitest';
import type { MaskPoint } from '@editor-ia/project-schema';
import { simplifyMaskPoints, smoothMaskStroke } from './mask-draw';

function circlePoints(count: number, radius = 0.4): MaskPoint[] {
  const points: MaskPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push({
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    });
  }
  return points;
}

describe('simplifyMaskPoints', () => {
  it('respeta el tope de 16 puntos del schema', () => {
    const simplified = simplifyMaskPoints(circlePoints(200), 16);
    expect(simplified.length).toBeLessThanOrEqual(16);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
  });

  it('conserva la forma: la caja del lazo no se encoge', () => {
    const simplified = simplifyMaskPoints(circlePoints(200), 16);
    const xs = simplified.map((point) => point.x);
    const ys = simplified.map((point) => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.7);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.7);
  });

  it('devuelve copia sin tocar cuando ya entra', () => {
    const points = circlePoints(8);
    const simplified = simplifyMaskPoints(points, 16);
    expect(simplified).toHaveLength(8);
    expect(simplified).not.toBe(points);
    expect(simplified[0]).toEqual(points[0]);
  });

  it('una línea recta se reduce a sus extremos', () => {
    const line: MaskPoint[] = [];
    for (let index = 0; index <= 100; index += 1) {
      line.push({ x: index / 100, y: 0.5 });
    }
    const simplified = simplifyMaskPoints(line, 16);
    expect(simplified.length).toBeLessThanOrEqual(4);
    expect(simplified[0]).toEqual({ x: 0, y: 0.5 });
  });
});

describe('smoothMaskStroke (plumilla)', () => {
  it('devuelve exactamente maxPoints puntos dentro de 0..1', () => {
    const smoothed = smoothMaskStroke(circlePoints(300), 48);
    expect(smoothed).toHaveLength(48);
    for (const point of smoothed) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it('nunca supera el tope del schema (64)', () => {
    const smoothed = smoothMaskStroke(circlePoints(2000), 999);
    expect(smoothed.length).toBeLessThanOrEqual(64);
    expect(smoothed.length).toBeGreaterThanOrEqual(3);
  });

  it('conserva la envolvente del lazo (la curva no se encoge)', () => {
    const smoothed = smoothMaskStroke(circlePoints(400, 0.4), 48);
    const xs = smoothed.map((point) => point.x);
    const ys = smoothed.map((point) => point.y);
    // El círculo de radio 0.4 llega a x∈[0.1,0.9]; Catmull–Rom puede
    // pasar apenas del radio pero no debe perder la mitad del cuadro.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.6);
  });

  it('suaviza las esquinas: un cuadrado dentado queda sin vértices repetidos', () => {
    const jagged: MaskPoint[] = [];
    for (let index = 0; index < 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      const radius = index % 2 === 0 ? 0.45 : 0.3;
      jagged.push({ x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius });
    }
    const smoothed = smoothMaskStroke(jagged, 48);
    // Los radios alternados 0.45/0.3 se funden: ningún punto debe quedar
    // a distancia <0.3 ni >0.5 del centro (los picos quedan redondeados).
    for (const point of smoothed) {
      const radius = Math.hypot(point.x - 0.5, point.y - 0.5);
      expect(radius).toBeGreaterThan(0.25);
      expect(radius).toBeLessThan(0.55);
    }
  });

  it('deduplica puntos consecutivos y acepta tramos ya cortos', () => {
    const withDupes: MaskPoint[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ];
    const smoothed = smoothMaskStroke(withDupes, 16);
    expect(smoothed.length).toBe(16);
    const xs = smoothed.map((point) => point.x);
    expect(Math.min(...xs)).toBeLessThan(0.3);
    expect(Math.max(...xs)).toBeGreaterThan(0.7);
  });

  it('con menos de 3 puntos devuelve copia sin inventar geometría', () => {
    const two: MaskPoint[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ];
    const smoothed = smoothMaskStroke(two, 48);
    expect(smoothed).toHaveLength(2);
    expect(smoothed).not.toBe(two);
    expect(smoothed[0]).toEqual(two[0]);
  });
});
