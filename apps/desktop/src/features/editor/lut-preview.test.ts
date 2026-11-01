import { describe, expect, it } from 'vitest';
import {
  applyCubeToPixels,
  lutTextureData,
  parseCube,
  sampleCube,
  MAX_CUBE_1D_SIZE,
  MAX_CUBE_SIZE,
} from './lut-preview';

function cubeFromRows(size: number, row: (r: number, g: number, b: number) => [number, number, number]): string {
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        lines.push(row(red, green, blue).join(' '));
      }
    }
  }
  return lines.join('\n');
}

const identity = cubeFromRows(2, (r, g, b) => [r, g, b]);
const invert = cubeFromRows(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);

describe('parseCube', () => {
  it('lee tamaño, dominio y colores en orden rojo → verde → azul', () => {
    const text = [
      '# comentario',
      'TITLE "Prueba"',
      'LUT_3D_SIZE 2',
      '0.1 0.2 0.3',
      '0.4 0.5 0.6',
      '0.7 0.8 0.9',
      '0 0 0',
      '1 1 1',
      '0.5 0.5 0.5',
      '0.25 0.25 0.25',
      '0.75 0.75 0.75',
    ].join('\n');
    const lut = parseCube(text);
    expect(lut.size).toBe(2);
    const rounded = Array.from(lut.data).map((value) => Math.round(value * 1000) / 1000);
    expect(rounded).toEqual([
      0.1, 0.2, 0.3,
      0.4, 0.5, 0.6,
      0.7, 0.8, 0.9,
      0, 0, 0,
      1, 1, 1,
      0.5, 0.5, 0.5,
      0.25, 0.25, 0.25,
      0.75, 0.75, 0.75,
    ]);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('acepta DOMAIN_MIN/DOMAIN_MAX y LUT_3D_INPUT_RANGE', () => {
    const domain = parseCube(
      ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...identity.split('\n').slice(1)].join('\n'),
    );
    expect(domain.domainMax).toEqual([2, 2, 2]);

    const range = parseCube(
      ['LUT_3D_SIZE 2', 'LUT_3D_INPUT_RANGE 0 4', ...identity.split('\n').slice(1)].join('\n'),
    );
    expect(range.domainMin).toEqual([0, 0, 0]);
    expect(range.domainMax).toEqual([4, 4, 4]);
  });

  it('ignora líneas vacías, comentarios y BOM', () => {
    const lut = parseCube(`\uFEFF${identity.replace(/\n/g, '\n\n')}`);
    expect(lut.size).toBe(2);
  });

  it('acepta un .cube 1D y LUT_1D_INPUT_RANGE', () => {
    const text = [
      'TITLE "curva 1D"',
      'LUT_1D_SIZE 3',
      'LUT_1D_INPUT_RANGE 0 2',
      '0 0 0',
      '0.5 0.25 0.75',
      '1 1 1',
    ].join('\n');
    const lut = parseCube(text);
    expect(lut.dimension).toBe(1);
    expect(lut.size).toBe(3);
    expect(lut.domainMax).toEqual([2, 2, 2]);
    expect(Array.from(lut.data)).toEqual([0, 0, 0, 0.5, 0.25, 0.75, 1, 1, 1]);
    expect(lutTextureData(lut)).toHaveLength(3 * 4);
  });

  it('rechaza LUT 1D inválidos, mezclados y tamaños fuera de rango', () => {
    expect(() => parseCube('LUT_1D_SIZE 1')).toThrow(/tamaño 1D/);
    expect(() => parseCube(`LUT_1D_SIZE ${MAX_CUBE_1D_SIZE + 1}`)).toThrow(/demasiado grande/);
    expect(() =>
      parseCube('LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n0 0 0\n0 0 0'),
    ).toThrow(/mezcla/);
    expect(() => parseCube('LUT_1D_SIZE 2\n0 0 0')).toThrow(/incompleto/);
  });

  it('rechaza tamaño faltante, colores incompletos y valores no numéricos', () => {
    expect(() => parseCube('0 0 0')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCube('LUT_3D_SIZE 3\n0 0 0')).toThrow(/incompleto/);
    expect(() => parseCube(`LUT_3D_SIZE 2\n0 0 x\n${identity.split('\n').slice(1).join('\n')}`)).toThrow(
      /no es un número/,
    );
  });

  it('rechaza tamaños fuera de rango y dominios invertidos', () => {
    expect(() => parseCube(`LUT_3D_SIZE ${MAX_CUBE_SIZE + 1}`)).toThrow(/demasiado grande/);
    const inverted = ['LUT_3D_SIZE 2', 'DOMAIN_MIN 1 1 1', 'DOMAIN_MAX 0 0 0', ...identity.split('\n').slice(1)].join('\n');
    expect(() => parseCube(inverted)).toThrow(/DOMAIN_MAX/);
  });
});

describe('sampleCube', () => {
  it('la identidad devuelve el mismo color', () => {
    const lut = parseCube(identity);
    expect(sampleCube(lut, 0.25, 0.5, 0.75)).toEqual([0.25, 0.5, 0.75]);
    expect(sampleCube(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(sampleCube(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('interpola trilinealmente con un tamaño 3', () => {
    // Curva cuadrática muestreada en los nodos: el valor interpolado no cae en
    // la recta, así que una lectura por vecino más cercano daría otro número.
    const lut = parseCube(
      cubeFromRows(3, (r, g, b) => [(r / 2) ** 2, (g / 2) ** 2, (b / 2) ** 2]),
    );
    const [red, green, blue] = sampleCube(lut, 0.3, 0.4, 0.9);
    expect(red).toBeCloseTo(0.25 * 0.6, 5);
    expect(green).toBeCloseTo(0.25 * 0.8, 5);
    expect(blue).toBeCloseTo(0.25 + (1 - 0.25) * 0.8, 5);
  });

  it('mapea el dominio y recorta fuera de rango', () => {
    const lut = parseCube(
      ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...identity.split('\n').slice(1)].join('\n'),
    );
    expect(sampleCube(lut, 1, 1, 1)).toEqual([0.5, 0.5, 0.5]);
    expect(sampleCube(lut, -5, -5, -5)).toEqual([0, 0, 0]);
    const clipped = sampleCube(lut, 9, 9, 9);
    expect(clipped[0]).toBe(1);
    expect(clipped[1]).toBe(1);
    expect(clipped[2]).toBe(1);
  });

  it('interpola una rampa 1D por canal', () => {
    const lut = parseCube(
      ['LUT_1D_SIZE 3', '0 0 0', '0.5 0.25 0.75', '1 1 1'].join('\n'),
    );
    expect(sampleCube(lut, 0.25, 0.25, 0.25)).toEqual([0.25, 0.125, 0.375]);
    expect(sampleCube(lut, 0.75, 0.25, 0)).toEqual([0.75, 0.125, 0]);
    expect(sampleCube(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });
});

describe('applyCubeToPixels', () => {
  it('mezcla por intensidad y conserva el alfa', () => {
    const lut = parseCube(invert);
    const pixels = new Uint8ClampedArray([0, 0, 0, 128, 255, 255, 255, 64]);
    applyCubeToPixels(lut, pixels, 1);
    expect(Array.from(pixels)).toEqual([255, 255, 255, 128, 0, 0, 0, 64]);

    const half = new Uint8ClampedArray([0, 0, 0, 255]);
    applyCubeToPixels(lut, half, 0.5);
    expect(Array.from(half)).toEqual([128, 128, 128, 255]);
  });

  it('con intensidad 0 no toca los píxeles', () => {
    const lut = parseCube(invert);
    const pixels = new Uint8ClampedArray([12, 34, 56, 255]);
    applyCubeToPixels(lut, pixels, 0);
    expect(Array.from(pixels)).toEqual([12, 34, 56, 255]);
  });

  it('recorta intensidades fuera de 0..1', () => {
    const lut = parseCube(invert);
    const pixels = new Uint8ClampedArray([0, 0, 0, 255]);
    applyCubeToPixels(lut, pixels, 4);
    expect(Array.from(pixels)).toEqual([255, 255, 255, 255]);
  });
});

describe('lutTextureData', () => {
  it('arma RGBA8 con el mismo índice que el archivo', () => {
    const lut = parseCube(identity);
    const texture = lutTextureData(lut);
    // Primer texel: negro. Segundo texel: rojo (r varía más rápido).
    expect(Array.from(texture.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(texture.slice(4, 8))).toEqual([255, 0, 0, 255]);
    // Último texel: blanco.
    expect(Array.from(texture.slice(texture.length - 4))).toEqual([255, 255, 255, 255]);
  });
});
