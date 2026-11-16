import { describe, expect, it } from 'vitest';
import {
  canvasToCorner,
  canvasToLocal,
  isValidPerspectiveQuad,
  localToCanvas,
  perspectiveHandlePoints,
  translateCorners,
} from './perspective-handles';
import type { PerspectiveViewport } from './perspective';

const project = { width: 1920, height: 1080 };
const canvas = { width: 960, height: 540 };
const identity = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 };
// Medio 16:9 en lienzo 16:9 → content-box = lienzo completo.
const viewport: PerspectiveViewport = {
  width: 960,
  height: 540,
  mediaWidth: 1920,
  mediaHeight: 1080,
};
const unitCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('perspective-handles', () => {
  it('localToCanvas y canvasToLocal son inversas', () => {
    const transform = { offsetX: 120, offsetY: -40, scaleX: 1.3, scaleY: 0.8, rotationDeg: 25 };
    const local: [number, number] = [100, 200];
    const round = canvasToLocal(localToCanvas(local, transform, project, canvas), transform, project, canvas);
    expect(round[0]).toBeCloseTo(local[0], 6);
    expect(round[1]).toBeCloseTo(local[1], 6);
  });

  it('sin transformación las esquinas caen en las puntas del content-box', () => {
    const points = perspectiveHandlePoints(unitCorners, identity, project, canvas, viewport);
    expect(points[0]).toEqual([0, 0]);
    expect(points[1]![0]).toBeCloseTo(960, 5);
    expect(points[1]![1]).toBeCloseTo(0, 5);
    expect(points[2]![0]).toBeCloseTo(960, 5);
    expect(points[2]![1]).toBeCloseTo(540, 5);
    expect(points[3]![0]).toBeCloseTo(0, 5);
    expect(points[3]![1]).toBeCloseTo(540, 5);
  });

  it('offset, escala y rotación mueven las esquinas', () => {
    const moved = perspectiveHandlePoints(
      unitCorners,
      { offsetX: 96, offsetY: 0, scaleX: 2, scaleY: 2, rotationDeg: 0 },
      project,
      canvas,
      viewport,
    );
    // offsetX=96px proyecto → 48px lienzo; escala 2 sobre origen centro:
    // (0,0) → O + 2·((0,0)-O) + (48,0) = (-432,-270); (960,540) → (1488,810).
    expect(moved[0]![0]).toBeCloseTo(-432, 4);
    expect(moved[0]![1]).toBeCloseTo(-270, 4);
    expect(moved[2]![0]).toBeCloseTo(1488, 4);
    expect(moved[2]![1]).toBeCloseTo(810, 4);
  });

  it('canvasToCorner respeta el letterbox del content-box', () => {
    // Medio 1:1 en lienzo 16:9 → content-box centrado con bandas.
    const square: PerspectiveViewport = { width: 960, height: 540, mediaWidth: 1080, mediaHeight: 1080 };
    const transform = { ...identity };
    // Centro del content-box = centro del lienzo.
    const center = canvasToCorner([480, 270], transform, project, canvas, square);
    expect(center.x).toBeCloseTo(0.5, 4);
    expect(center.y).toBeCloseTo(0.5, 4);
    // Esquina sup-izq del content-box: x=0, y=0 en coords del clip.
    const corner = canvasToCorner([195, 0], transform, project, canvas, square);
    expect(corner.x).toBeCloseTo(0, 3);
    expect(corner.y).toBeCloseTo(0, 3);
  });

  it('canvasToCorner clampea a 0..1', () => {
    const corner = canvasToCorner([5000, -500], identity, project, canvas, viewport);
    expect(corner.x).toBe(1);
    expect(corner.y).toBe(0);
  });

  it('translateCorners mueve el quad y clampea', () => {
    const moved = translateCorners(unitCorners, 0.1, -0.1);
    expect(moved[0]).toEqual({ x: 0.1, y: 0 });
    expect(moved[2]).toEqual({ x: 1, y: 0.9 });
  });

  it('isValidPerspectiveQuad acepta el quad unitario y rechaza auto-intersecciones', () => {
    expect(isValidPerspectiveQuad(unitCorners)).toBe(true);
    const bowtie = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(isValidPerspectiveQuad(bowtie)).toBe(false);
    const degenerate = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(isValidPerspectiveQuad(degenerate)).toBe(false);
  });
});
