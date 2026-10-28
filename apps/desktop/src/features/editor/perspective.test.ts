import { describe, expect, it } from 'vitest';
import type { PerspectiveCorner } from '@editor-ia/project-schema';
import {
  applyMatrix3,
  fittedContentBox,
  perspectiveMatrix3d,
  type PerspectiveViewport,
} from './perspective';

type Point = readonly [number, number];

const FULL: [PerspectiveCorner, PerspectiveCorner, PerspectiveCorner, PerspectiveCorner] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const QUAD: [PerspectiveCorner, PerspectiveCorner, PerspectiveCorner, PerspectiveCorner] = [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.15 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.85 },
];

/** Reproduce la lista column-major de `matrix3d` como matriz 3×3 fila-mayor. */
function parseMatrix3d(value: string): number[] {
  const match = /^matrix3d\((.+)\)$/.exec(value);
  expect(match).not.toBeNull();
  const list = match![1]!.split(',').map(Number);
  expect(list).toHaveLength(16);
  // x' = m11·x + m21·y + m41; y' = m12·x + m22·y + m42; w' = m14·x + m24·y + m44.
  return [list[0]!, list[4]!, list[12]!, list[1]!, list[5]!, list[13]!, list[3]!, list[7]!, list[15]!];
}

/** Aplica la lista completa como CSS: el origen se toma alrededor de toda ella. */
function applyWithOrigin(point: Point, matrix: number[], origin: Point): Point {
  const [x, y] = applyMatrix3([point[0] - origin[0], point[1] - origin[1]], matrix as [
    number, number, number, number, number, number, number, number, number,
  ]);
  return [x + origin[0], y + origin[1]];
}

function expectPoint(actual: Point, expected: Point): void {
  // La matriz se serializa con 8 decimales: el error medido queda por debajo
  // de 0,001 px, muy lejos de un píxel de pantalla.
  expect(actual[0]).toBeCloseTo(expected[0], 2);
  expect(actual[1]).toBeCloseTo(expected[1], 2);
}

describe('perspectiva CSS de la preview', () => {
  it('no transforma el cuadro completo (esquinas por defecto)', () => {
    const viewport: PerspectiveViewport = {
      width: 960,
      height: 540,
      mediaWidth: 1920,
      mediaHeight: 1080,
    };
    expect(perspectiveMatrix3d(FULL, viewport)).toBeUndefined();
    expect(
      perspectiveMatrix3d(
        FULL.map((corner) => ({ x: corner.x + 0.0002, y: corner.y - 0.0002 })),
        viewport,
      ),
    ).toBeUndefined();
  });

  it('mapea el cuadrilátero al cuadro completo con origen centrado', () => {
    const viewport: PerspectiveViewport = {
      width: 960,
      height: 540,
      mediaWidth: 1920,
      mediaHeight: 1080,
    };
    const value = perspectiveMatrix3d(QUAD, viewport);
    expect(value).toBeTruthy();
    const matrix = parseMatrix3d(value!);
    const origin: Point = [480, 270];
    const source: Point[] = QUAD.map((corner) => [corner.x * 960, corner.y * 540]);
    const destination: Point[] = [
      [0, 0],
      [960, 0],
      [960, 540],
      [0, 540],
    ];
    source.forEach((point, index) => {
      expectPoint(applyWithOrigin(point, matrix, origin), destination[index]!);
    });
  });

  it('respeta el letterbox de un medio 4:3 en un cuadro 16:9', () => {
    const viewport: PerspectiveViewport = {
      width: 960,
      height: 540,
      mediaWidth: 1440,
      mediaHeight: 1080,
    };
    expect(fittedContentBox(viewport)).toEqual({ x: 120, y: 0, width: 720, height: 540 });
    const value = perspectiveMatrix3d(QUAD, viewport);
    expect(value).toBeTruthy();
    const matrix = parseMatrix3d(value!);
    const origin: Point = [480, 270];
    // El MP4 define las esquinas en píxeles del perfil y las aplica al frame ya
    // escalado: origen = caja del contenido + esquina × cuadro de la preview.
    const source: Point[] = QUAD.map((corner) => [120 + corner.x * 960, 0 + corner.y * 540]);
    const destination: Point[] = [
      [120, 0],
      [840, 0],
      [840, 540],
      [120, 540],
    ];
    source.forEach((point, index) => {
      expectPoint(applyWithOrigin(point, matrix, origin), destination[index]!);
    });
  });

  it('respeta el letterbox de un medio vertical en un cuadro horizontal', () => {
    const viewport: PerspectiveViewport = {
      width: 960,
      height: 540,
      mediaWidth: 1080,
      mediaHeight: 1920,
    };
    const box = fittedContentBox(viewport);
    expect(box.x).toBeCloseTo((960 - 540 * (1080 / 1920)) / 2, 6);
    expect(box.y).toBe(0);
    expect(box.height).toBe(540);
    const value = perspectiveMatrix3d(QUAD, viewport);
    expect(value).toBeTruthy();
    const matrix = parseMatrix3d(value!);
    const origin: Point = [480, 270];
    const source: Point[] = QUAD.map((corner) => [box.x + corner.x * 960, corner.y * 540]);
    const destination: Point[] = [
      [box.x, 0],
      [box.x + box.width, 0],
      [box.x + box.width, 540],
      [box.x, 540],
    ];
    source.forEach((point, index) => {
      expectPoint(applyWithOrigin(point, matrix, origin), destination[index]!);
    });
  });

  it('sin tamaño de escena o con esquinas degeneradas no emite transformación', () => {
    expect(
      perspectiveMatrix3d(QUAD, { width: 0, height: 0 }),
    ).toBeUndefined();
    const collapsed: [PerspectiveCorner, PerspectiveCorner, PerspectiveCorner, PerspectiveCorner] = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(
      perspectiveMatrix3d(collapsed, { width: 960, height: 540, mediaWidth: 1920, mediaHeight: 1080 }),
    ).toBeUndefined();
  });

  it('usa el cuadro completo cuando el medio no declara tamaño', () => {
    expect(fittedContentBox({ width: 640, height: 360 })).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    });
  });
});
