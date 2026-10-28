import { describe, expect, it } from 'vitest';
import { applyChromaToPixels, type ChromaSettings } from './ChromaPreview';

const GREEN: ChromaSettings = {
  color: '#00ff00',
  similarity: 0.3,
  blend: 0.1,
  spill: 0,
};

function rgba(...pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

describe('clave de color de la vista', () => {
  it('hace transparente la pantalla verde y conserva el sujeto', () => {
    const data = rgba([0, 255, 0, 255], [255, 40, 40, 255]);
    applyChromaToPixels(data, GREEN);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[4]).toBe(255);
  });

  it('clave cualquier color parejo, no sólo verde', () => {
    const data = rgba([204, 136, 68, 255], [250, 250, 250, 255]);
    applyChromaToPixels(data, {
      color: '#cc8844',
      similarity: 0.3,
      blend: 0.1,
      spill: 0.8,
    });
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it('suaviza el borde y baja el derrame verde', () => {
    const data = rgba([20, 220, 20, 255]);
    applyChromaToPixels(data, {
      color: '#00ff00',
      similarity: 0.3,
      blend: 0.2,
      spill: 1,
    });
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(255);
    expect(data[1]).toBeLessThan(220);
  });

  it('no toca píxeles opacos aunque el derrame esté al máximo', () => {
    const data = rgba([255, 40, 40, 255]);
    applyChromaToPixels(data, {
      color: '#00ff00',
      similarity: 0.3,
      blend: 0.1,
      spill: 1,
    });
    expect(Array.from(data)).toEqual([255, 40, 40, 255]);
  });
});
