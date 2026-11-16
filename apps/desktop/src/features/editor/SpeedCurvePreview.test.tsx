// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SpeedCurvePreview } from './SpeedCurvePreview';

afterEach(cleanup);

/**
 * Geometría esperada (espejo de SpeedCurvePreview.tsx):
 * viewBox 200x60, PAD 8 → x = 8 + at*184, y = 52 - speed/top*44 con
 * top = max(1, vmax). Para speed 1→2, top=2: y(1)=30, y(2)=8.
 */

function pathOf(container: HTMLElement): string {
  const path = container.querySelector('.concat-worker-curve-preview-path');
  expect(path).not.toBeNull();
  return path!.getAttribute('d')!;
}

describe('SpeedCurvePreview', () => {
  it('dibuja la polilínea y los puntos con las coordenadas esperadas', () => {
    const { container } = render(
      <SpeedCurvePreview
        points={[
          { at: 0, speed: 1 },
          { at: 1, speed: 2 },
        ]}
      />,
    );
    const svg = container.querySelector('svg.concat-worker-curve-preview');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');

    const d = pathOf(container);
    expect(d.startsWith('M8.00 30.00')).toBe(true);
    expect(d.endsWith('L192.00 8.00')).toBe(true);
    // Sin slope: interpolación lineal → el punto medio está en y=19.
    expect(d).toContain('L100.00 19.00');

    const circles = container.querySelectorAll(
      '.concat-worker-curve-preview-point',
    );
    expect(circles).toHaveLength(2);
    expect(circles[0]!.getAttribute('cx')).toBe('8');
    expect(circles[0]!.getAttribute('cy')).toBe('30');
    expect(circles[1]!.getAttribute('cx')).toBe('192');
    expect(circles[1]!.getAttribute('cy')).toBe('8');

    // Referencia 1× punteada a la altura de speed=1.
    const ref = container.querySelector(
      '.concat-worker-curve-preview-ref',
    )!;
    expect(ref.getAttribute('y1')).toBe('30');
    expect(ref.getAttribute('y2')).toBe('30');
  });

  it('con pendiente en todos los puntos interpola Hermite (no una recta)', () => {
    const straight = render(
      <SpeedCurvePreview
        points={[
          { at: 0, speed: 1 },
          { at: 1, speed: 2 },
        ]}
      />,
    );
    const straightD = pathOf(straight.container);
    straight.unmount();

    const { container } = render(
      <SpeedCurvePreview
        points={[
          { at: 0, speed: 1, slope: 0 },
          { at: 1, speed: 2, slope: 0 },
        ]}
      />,
    );
    const d = pathOf(container);
    expect(d).not.toBe(straightD);
    // Mismos extremos, curva suave en el medio.
    expect(d.startsWith('M8.00 30.00')).toBe(true);
    expect(d.endsWith('L192.00 8.00')).toBe(true);
    expect(d).not.toContain('NaN');
  });

  it('un solo punto muestra la curva plana que haría el worker', () => {
    const { container } = render(
      <SpeedCurvePreview points={[{ at: 0.5, speed: 1 }]} />,
    );
    const svg = container.querySelector('svg.concat-worker-curve-preview');
    expect(svg).not.toBeNull();
    const d = pathOf(container);
    // Extensión plana a los extremos: top=1 → y(1)=8 en todo el ancho.
    expect(d.startsWith('M8.00 8.00')).toBe(true);
    expect(d.endsWith('L192.00 8.00')).toBe(true);
    const circles = container.querySelectorAll(
      '.concat-worker-curve-preview-point',
    );
    expect(circles).toHaveLength(1);
    expect(circles[0]!.getAttribute('cx')).toBe('100');
    expect(circles[0]!.getAttribute('cy')).toBe('8');
  });

  it('sin puntos usables no renderiza nada', () => {
    const { container } = render(<SpeedCurvePreview points={[]} />);
    expect(container.querySelector('svg')).toBeNull();

    const invalid = render(
      <SpeedCurvePreview
        points={[
          { at: Number.NaN, speed: 1 },
          { at: 0.5, speed: -2 },
        ]}
      />,
    );
    expect(invalid.container.querySelector('svg')).toBeNull();
  });

  it('puntos fuera de rango se clampean como hace el worker', () => {
    const { container } = render(
      <SpeedCurvePreview
        points={[
          { at: -0.5, speed: 100 },
          { at: 0.5, speed: 1 },
        ]}
      />,
    );
    const circles = container.querySelectorAll(
      '.concat-worker-curve-preview-point',
    );
    expect(circles).toHaveLength(2);
    // at=-0.5 → 0, speed=100 → 16; top = 16.
    // y(16)=8, y(1)=52-44/16=49.25; x(0)=8, x(0.5)=100.
    expect(circles[0]!.getAttribute('cx')).toBe('8');
    expect(circles[0]!.getAttribute('cy')).toBe('8');
    expect(circles[1]!.getAttribute('cx')).toBe('100');
    expect(circles[1]!.getAttribute('cy')).toBe('49.25');
  });
});
