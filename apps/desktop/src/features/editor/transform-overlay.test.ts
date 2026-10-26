import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  boxRect,
  movePatch,
  resetPatch,
  rotatePatch,
  scalePatch,
  scaleFactor,
} from './transform-overlay';

const project = { width: 1920, height: 1080 };
const canvas = { width: 960, height: 540 };
const identity = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 };

describe('caja de transformación', () => {
  it('el factor de escala relaciona lienzo y proyecto', () => {
    expect(scaleFactor(canvas, project)).toBe(0.5);
    expect(scaleFactor({ width: 0, height: 0 }, project)).toBe(1);
  });

  it('sin transformación la caja ocupa el cuadro completo', () => {
    const box = boxRect(identity, project, canvas);
    expect(box.cx).toBe(480);
    expect(box.cy).toBe(270);
    expect(box.width).toBe(960);
    expect(box.height).toBe(540);
    expect(box.rotationDeg).toBe(0);
  });

  it('aplica desplazamiento y escala en píxeles del proyecto', () => {
    const box = boxRect(
      { offsetX: 200, offsetY: -100, scaleX: 0.5, scaleY: 0.5, rotationDeg: 15 },
      project,
      canvas,
    );
    // 200 px de proyecto con factor 0.5 son 100 px de lienzo.
    expect(box.cx).toBe(580);
    expect(box.cy).toBe(220);
    expect(box.width).toBe(480);
    expect(box.height).toBe(270);
    expect(box.rotationDeg).toBe(15);
  });
});

describe('mover', () => {
  it('convierte el arrastre de pantalla a píxeles del proyecto', () => {
    const patch = movePatch(identity, { x: 100, y: 50 }, project, canvas);
    expect(patch).toEqual({ offsetX: 200, offsetY: 100 });
  });

  it('el imán lleva al centro cuando el desplazamiento es chico', () => {
    const patch = movePatch(identity, { x: 2, y: -2 }, project, canvas);
    expect(patch).toEqual({ offsetX: 0, offsetY: 0 });
  });

  it('se puede desactivar el imán con Alt', () => {
    const patch = movePatch(identity, { x: 2, y: 0 }, project, canvas, false);
    expect(patch.offsetX).toBe(4);
  });

  it('no deja el centro a más de un cuadro de distancia', () => {
    const patch = movePatch(identity, { x: 100_000, y: -100_000 }, project, canvas);
    expect(patch.offsetX).toBe(project.width);
    expect(patch.offsetY).toBe(-project.height);
  });
});

describe('escalar', () => {
  it('escala proporcional a la distancia al centro', () => {
    const center = { x: 480, y: 270 };
    const patch = scalePatch(identity, { x: 580, y: 270 }, { x: 680, y: 270 }, center);
    expect(patch.scaleX).toBe(2);
    expect(patch.scaleY).toBe(2);
  });

  it('respeta los límites del esquema', () => {
    const center = { x: 480, y: 270 };
    const huge = scalePatch(identity, { x: 490, y: 270 }, { x: 100_000, y: 270 }, center);
    expect(huge.scaleX).toBe(MAX_SCALE);
    const tiny = scalePatch(identity, { x: 100_000, y: 270 }, { x: 481, y: 270 }, center);
    expect(tiny.scaleX).toBe(MIN_SCALE);
  });

  it('con el puntero en el centro no cambia nada', () => {
    const center = { x: 480, y: 270 };
    const patch = scalePatch(identity, { x: 480, y: 270 }, { x: 600, y: 270 }, center);
    expect(patch).toEqual({ scaleX: 1, scaleY: 1 });
  });
});

describe('rotar', () => {
  const center = { x: 480, y: 270 };

  it('suma el ángulo recorrido alrededor del centro', () => {
    const patch = rotatePatch(identity, { x: 580, y: 270 }, { x: 480, y: 370 }, center);
    expect(patch.rotationDeg).toBe(90);
  });

  it('normaliza a (-180, 180]', () => {
    // 170° + 90° = 260°, que se normaliza a -100°.
    const patch = rotatePatch(
      { ...identity, rotationDeg: 170 },
      { x: 580, y: 270 },
      { x: 480, y: 370 },
      center,
    );
    expect(patch.rotationDeg).toBe(-100);
  });

  it('con Shift cuantiza a pasos de 15 grados', () => {
    const patch = rotatePatch(identity, { x: 580, y: 270 }, { x: 500, y: 330 }, center, true);
    expect(patch.rotationDeg % 15).toBe(0);
  });
});

describe('restablecer', () => {
  it('vuelve al encuadre original', () => {
    expect(resetPatch()).toEqual({
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
    });
  });
});
