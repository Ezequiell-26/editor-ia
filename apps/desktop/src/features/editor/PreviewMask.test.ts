// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { maskClipPath, maskStrokeSvg } from './Preview';
import type { ClipMask } from '@editor-ia/project-schema';

const ellipse = (expand?: number): ClipMask => ({
  shape: 'ellipse',
  x: 0,
  y: 0,
  width: 0.8,
  height: 0.8,
  feather: 0,
  invert: false,
  ...(expand !== undefined ? { expand } : {}),
});

describe('maskClipPath · expand', () => {
  it('expand positivo agranda los radios (factor 1/(1−e))', () => {
    const base = maskClipPath(ellipse());
    const grown = maskClipPath(ellipse(0.5));
    // 0.8*50=40% → con expand 0.5 el radio pasa a 80%.
    expect(grown).toContain('80%');
    expect(grown).not.toBe(base);
  });

  it('expand negativo encoge los radios', () => {
    const shrunk = maskClipPath(ellipse(-0.5));
    // factor 1/1.5 → radio 40%/1.5 ≈ 26.67%.
    expect(shrunk).toContain('26.666');
  });

  it('freehand usa los puntos absolutos e ignora expand como polygon', () => {
    const stroke: ClipMask = {
      shape: 'freehand',
      x: 0.1,
      y: -0.05,
      width: 1,
      height: 1,
      feather: 0,
      invert: false,
      expand: 0.4,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.5, y: 0.9 },
      ],
    };
    const path = maskClipPath(stroke);
    // points + offset x/y en tanto por ciento: (0.2+0.1)*100 = 30%.
    expect(path).toContain('polygon(');
    expect(path).toContain('30%');
    const withoutExpand = maskClipPath({ ...stroke, expand: undefined });
    expect(path).toBe(withoutExpand);
    // Y el trazo de color no aplica (igual que en Rust).
    expect(
      maskStrokeSvg({ ...stroke, strokeColor: '#ff0000', strokeWidth: 0.2 }),
    ).toBeUndefined();
  });

  it('polygon ignora expand (el render tampoco lo aplica)', () => {
    const poly: ClipMask = {
      shape: 'polygon',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      feather: 0,
      invert: false,
      expand: 0.4,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
    };
    const withExpand = maskClipPath(poly);
    const withoutExpand = maskClipPath({ ...poly, expand: undefined });
    expect(withExpand).toBe(withoutExpand);
  });
});

describe('maskStrokeSvg · trazo de máscara', () => {
  const base: ClipMask = {
    shape: 'ellipse',
    x: 0,
    y: 0,
    width: 0.8,
    height: 0.8,
    feather: 0,
    invert: false,
  };

  it('emite el contorno con color y semiancho sw·(rx+ry)', () => {
    const svg = maskStrokeSvg({ ...base, strokeColor: '#ff0000', strokeWidth: 0.1 });
    expect(svg).toContain('stroke="#ff0000"');
    // rx=ry=40 → stroke-width = 0,1·80 = 8.
    expect(svg).toContain('stroke-width="8.00"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('<ellipse');
  });

  it('devuelve undefined sin color, sin ancho, en polygon o en text', () => {
    expect(maskStrokeSvg(base)).toBeUndefined();
    expect(maskStrokeSvg({ ...base, strokeColor: '#fff', strokeWidth: 0 })).toBeUndefined();
    expect(
      maskStrokeSvg({
        ...base,
        shape: 'polygon',
        strokeColor: '#ff0000',
        strokeWidth: 0.2,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      }),
    ).toBeUndefined();
    expect(
      maskStrokeSvg({ ...base, shape: 'text', strokeColor: '#ff0000', strokeWidth: 0.2 }),
    ).toBeUndefined();
  });
});
