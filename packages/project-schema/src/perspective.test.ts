import { describe, expect, it } from 'vitest';
import { PerspectiveSchema } from './timeline.ts';

const fullFrame = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('perspectiva a cuatro puntos', () => {
  it('acepta el cuadro completo y un cuadrilátero convexo', () => {
    expect(PerspectiveSchema.safeParse({ corners: fullFrame }).success).toBe(true);
    expect(
      PerspectiveSchema.safeParse({
        corners: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.2 },
          { x: 0.8, y: 0.9 },
          { x: 0.2, y: 0.8 },
        ],
        interpolation: 'cubic',
      }).success,
    ).toBe(true);
  });

  it('rechaza coordenadas fuera de 0..1', () => {
    const corners = fullFrame.map((corner, index) =>
      index === 0 ? { x: -0.1, y: 0 } : corner,
    );
    expect(PerspectiveSchema.safeParse({ corners }).success).toBe(false);
  });

  it('rechaza un área menor al 1%', () => {
    const corners = [
      { x: 0.5, y: 0.5 },
      { x: 0.51, y: 0.5 },
      { x: 0.51, y: 0.51 },
      { x: 0.5, y: 0.51 },
    ];
    expect(PerspectiveSchema.safeParse({ corners }).success).toBe(false);
  });

  it('rechaza un cuadrilátero no convexo (cruzado)', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(PerspectiveSchema.safeParse({ corners }).success).toBe(false);
  });

  it('rechaza una tupla con cantidad incorrecta de esquinas', () => {
    expect(
      PerspectiveSchema.safeParse({ corners: fullFrame.slice(0, 3) }).success,
    ).toBe(false);
  });
});
