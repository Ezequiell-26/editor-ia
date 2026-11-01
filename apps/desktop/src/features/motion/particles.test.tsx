// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMotionPlan, layerVisual } from './plan';
import { MotionPreview } from './MotionPreview';
import { particleBurstTemplate, type MotionCircleLayer } from './templates';

const context = {
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

function build(props: Record<string, unknown> = {}) {
  return buildMotionPlan(
    particleBurstTemplate,
    {
      count: 12,
      color: '#7dd3c0',
      spread: 32,
      seed: 7,
      label: '',
      ...props,
    },
    context,
  );
}

afterEach(() => {
  cleanup();
});

describe('plantilla de partículas', () => {
  it('genera círculos deterministas con deriva y sin assets', () => {
    const plan = build();
    expect(plan.layers).toHaveLength(12);
    for (const layer of plan.layers) {
      expect(layer.kind).toBe('circle');
      const circle = layer as MotionCircleLayer;
      expect(circle.width).toBeGreaterThan(0);
      expect(circle.height).toBeGreaterThan(0);
      expect(circle.x).toBeGreaterThanOrEqual(0);
      expect(circle.x + circle.width).toBeLessThanOrEqual(1.0001);
      expect(circle.y).toBeGreaterThanOrEqual(0);
      expect(circle.y + circle.height).toBeLessThanOrEqual(1.0001);
      expect(circle.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(circle.opacity).toBeGreaterThanOrEqual(0);
      expect(circle.opacity).toBeLessThanOrEqual(1);
      expect(circle.animation.kind).toBe('fade');
      expect(circle.drift).toBeDefined();
      expect(Math.abs(circle.drift!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(circle.drift!.y)).toBeLessThanOrEqual(1);
    }
    // La misma semilla reproduce el mismo plan; otra semilla lo cambia.
    expect(build().layers).toEqual(plan.layers);
    expect(build({ seed: 8 }).layers).not.toEqual(plan.layers);
  });

  it('agrega el texto opcional sin superar el límite de 16 capas', () => {
    const plan = build({ count: 15, label: 'Nuevo' });
    expect(plan.layers.length).toBeLessThanOrEqual(16);
    expect(plan.layers.at(-1)?.kind).toBe('text');
    expect(plan.layers.filter((layer) => layer.kind === 'circle').length).toBeLessThanOrEqual(15);
  });

  it('la deriva avanza linealmente en la preview', () => {
    const circle = build().layers[0] as MotionCircleLayer;
    const start = layerVisual(circle, 0, 90);
    const middle = layerVisual(circle, 0.5, 90);
    const end = layerVisual(circle, 1, 90);
    const expected = (progress: number) =>
      `translate(${(circle.drift!.x / circle.width) * progress * 100}%, ${(circle.drift!.y / circle.height) * progress * 100}%)`;
    expect(start.transform).toContain(expected(0));
    expect(middle.transform).toContain(expected(0.5));
    expect(end.transform).toContain(expected(1));
  });

  it('renderiza un nodo circular por partícula', () => {
    const plan = build();
    const { container } = render(<MotionPreview plan={plan} progress={0.4} />);
    expect(container.querySelectorAll('[data-layer-kind="circle"]')).toHaveLength(12);
  });

  it('rechaza colores y conteos fuera de rango', () => {
    expect(() => build({ color: 'rojo' })).toThrow();
    expect(() => build({ count: 20 })).toThrow();
  });
});
