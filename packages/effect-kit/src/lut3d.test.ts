import { describe, expect, it } from 'vitest';
import {
  CAMERA_PROFILE_IDS,
  cameraProfileLut,
  parseCubeLut,
} from './lut3d.ts';

function cubeText(size: number, fn: (r: number, g: number, b: number) => [number, number, number]): string {
  const lines = ['TITLE "test"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  const scale = size - 1;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const [rr, gg, bb] = fn(r / scale, g / scale, b / scale);
        lines.push(`${rr} ${gg} ${bb}`);
      }
    }
  }
  return lines.join('\n');
}

describe('parseCubeLut', () => {
  it('parsea una LUT identidad 2³', () => {
    const source = parseCubeLut(cubeText(2, (r, g, b) => [r, g, b]));
    expect(source).not.toBeNull();
    expect(source?.lut.size).toBe(2);
    expect(source?.lut.data.length).toBe(2 * 2 * 2 * 4);
    // Primera entrada (r=0,g=0,b=0) → negro; la entrada índice 1 varía el rojo.
    expect(source?.lut.data[0]).toBe(0);
    expect(source?.lut.data[4]).toBe(255); // r=1 → rojo pleno
    expect(source?.domainMin).toEqual([0, 0, 0]);
    expect(source?.domainMax).toEqual([1, 1, 1]);
  });

  it('respeta DOMAIN_MIN/MAX custom', () => {
    const text = cubeText(2, (r, g, b) => [r, g, b]).replace(
      'DOMAIN_MAX 1.0 1.0 1.0',
      'DOMAIN_MAX 0.5 0.5 0.5',
    );
    const source = parseCubeLut(text);
    expect(source?.domainMax).toEqual([0.5, 0.5, 0.5]);
  });

  it('devuelve null sin LUT_3D_SIZE o con pocas entradas', () => {
    expect(parseCubeLut('0.1 0.2 0.3\n')).toBeNull();
    expect(parseCubeLut('LUT_3D_SIZE 4\n0.1 0.2 0.3\n')).toBeNull();
    expect(parseCubeLut('')).toBeNull();
  });

  it('ignora comentarios y líneas no numéricas', () => {
    const text = `# comentario\n${cubeText(2, (r, g, b) => [r, g, b])}\nCOMMENT cola`;
    const source = parseCubeLut(text);
    expect(source?.lut.size).toBe(2);
  });
});

describe('cameraProfileLut', () => {
  it('genera una LUT 33³ para cada perfil registrado', () => {
    for (const id of CAMERA_PROFILE_IDS) {
      const source = cameraProfileLut(id);
      expect(source, id).not.toBeNull();
      expect(source?.lut.size).toBe(33);
      expect(source?.lut.data.length).toBe(33 * 33 * 33 * 4);
      expect(source?.domainMax).toEqual([1, 1, 1]);
    }
  });

  it('devuelve null para ids desconocidos', () => {
    expect(cameraProfileLut('nope')).toBeNull();
    expect(cameraProfileLut('')).toBeNull();
  });

  it('slog3709 con gris medio da un gris visible (paridad camera_log.rs)', () => {
    const source = cameraProfileLut('slog3709');
    expect(source).not.toBeNull();
    const size = source!.lut.size;
    // Índice del texel (r=g=b=16/32≈0.5): b*size² + g*size + r
    const mid = 16;
    const idx = (mid * size * size + mid * size + mid) * 4;
    const r = source!.lut.data[idx] ?? 0;
    const g = source!.lut.data[idx + 1] ?? 0;
    const b = source!.lut.data[idx + 2] ?? 0;
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(245);
    // Perfil neutro en gris: canales casi iguales.
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });

  it('es determinista y cachea por id', () => {
    expect(cameraProfileLut('vlog709')).toBe(cameraProfileLut('vlog709'));
  });
});
