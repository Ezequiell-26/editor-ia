// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ensureScratchCanvas } from './scratch-canvas';

function fakeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

describe('ensureScratchCanvas', () => {
  it('crea el lienzo una sola vez y lo reutiliza en los frames siguientes', () => {
    const create = vi.fn(() => fakeCanvas());
    const first = ensureScratchCanvas(null, 1280, 720, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(first.resized).toBe(true);
    expect(first.canvas.width).toBe(1280);
    expect(first.canvas.height).toBe(720);

    let current = first.canvas;
    for (let frame = 0; frame < 120; frame += 1) {
      const next = ensureScratchCanvas(current, 1280, 720, create);
      expect(next.resized).toBe(false);
      expect(next.canvas).toBe(current);
      current = next.canvas;
    }
    // 120 frames después sigue habiendo un solo canvas creado.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('redimensiona sólo cuando cambia el tamaño', () => {
    const create = vi.fn(() => fakeCanvas());
    const first = ensureScratchCanvas(null, 640, 360, create);
    const wider = ensureScratchCanvas(first.canvas, 1280, 360, create);
    expect(wider.resized).toBe(true);
    expect(wider.canvas.width).toBe(1280);
    expect(wider.canvas.height).toBe(360);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('normaliza tamaños inválidos a un píxel', () => {
    const result = ensureScratchCanvas(null, 0, -5, fakeCanvas);
    expect(result.canvas.width).toBe(1);
    expect(result.canvas.height).toBe(1);
  });

  it('redondea tamaños fraccionarios', () => {
    const result = ensureScratchCanvas(null, 1279.6, 719.4, fakeCanvas);
    expect(result.canvas.width).toBe(1280);
    expect(result.canvas.height).toBe(719);
  });
});
