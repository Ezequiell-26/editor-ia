// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMotionPlan, MotionPlanError } from './plan';
import { MotionPreview } from './MotionPreview';
import {
  cinemaBarsTemplate,
  cinematicTitleTemplate,
  glitchTextTemplate,
  lowerThirdMinimalTemplate,
  MOTION_ANIMATIONS,
  MOTION_TEMPLATES,
  templateById,
  zoomPunchTemplate,
} from './templates';
import type { MotionLayer, MotionTemplate } from './templates';

const context = {
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

const verticalContext = {
  width: 2160,
  height: 3840,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

const existentes = ['title-card', 'free-text', 'lower-third', 'end-card', 'stat-callout'];

const nuevas: readonly MotionTemplate[] = [
  lowerThirdMinimalTemplate,
  cinemaBarsTemplate,
  zoomPunchTemplate,
  glitchTextTemplate,
  cinematicTitleTemplate,
];

afterEach(() => {
  cleanup();
});

/** Mismas invariantes que valida el render ASS en src-tauri/src/render/motion.rs. */
function expectLayersValidas(layers: readonly MotionLayer[]): void {
  expect(layers.length).toBeGreaterThan(0);
  expect(layers.length).toBeLessThanOrEqual(16);
  for (const layer of layers) {
    expect(layer.x).toBeGreaterThanOrEqual(0);
    expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
    expect(layer.y).toBeGreaterThanOrEqual(0);
    expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    expect(layer.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    if (layer.kind === 'text') {
      expect(layer.fontSizePx).toBeGreaterThanOrEqual(4);
      expect(layer.fontSizePx).toBeLessThanOrEqual(400);
      expect(layer.weight).toBeGreaterThanOrEqual(100);
      expect(layer.weight).toBeLessThanOrEqual(900);
      expect(layer.text.length).toBeLessThanOrEqual(500);
      expect(['left', 'center', 'right']).toContain(layer.align);
    } else {
      expect(layer.opacity).toBeGreaterThanOrEqual(0);
      expect(layer.opacity).toBeLessThanOrEqual(1);
    }
    expect(MOTION_ANIMATIONS).toContain(layer.animation.kind);
    if (layer.animation.inFrames !== undefined) {
      expect(layer.animation.inFrames).toBeGreaterThanOrEqual(0);
      expect(layer.animation.inFrames).toBeLessThanOrEqual(600);
    }
    if (layer.animation.outFrames !== undefined) {
      expect(layer.animation.outFrames).toBeGreaterThanOrEqual(0);
      expect(layer.animation.outFrames).toBeLessThanOrEqual(600);
    }
    if (layer.animation.distance !== undefined) {
      expect(layer.animation.distance).toBeGreaterThan(0);
      expect(layer.animation.distance).toBeLessThanOrEqual(0.5);
    }
  }
}

describe('plantillas motion pro', () => {
  it('registra las cinco plantillas nuevas con claves únicas sin colisionar', () => {
    const ids = MOTION_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'lower-third-minimal',
      'cinema-bars',
      'zoom-punch',
      'glitch-text',
      'cinematic-title',
    ]) {
      expect(ids.filter((item) => item === id)).toHaveLength(1);
      expect(templateById(id)?.version).toBe('1.0.0');
    }
    for (const id of existentes) {
      expect(templateById(id)).not.toBeNull();
    }
    // Las originales quedan primero: la vista Motion arranca con
    // MOTION_TEMPLATES[0] seleccionada (Título de apertura).
    expect(ids.slice(0, existentes.length)).toEqual(existentes);
  });

  it('cada plantilla nueva construye un plan válido desde sus defaults', () => {
    for (const template of nuevas) {
      const plan = buildMotionPlan(template, { ...template.defaults }, context);
      expect(plan.version).toBe(1);
      expect(plan.width).toBe(context.width);
      expect(plan.height).toBe(context.height);
      expect(plan.durationFrames).toBe(context.durationFrames);
      expectLayersValidas(plan.layers);
      expect(plan.layers.some((layer) => layer.kind === 'text')).toBe(true);
    }
  });

  it('declara un default por campo y opciones coherentes', () => {
    for (const template of nuevas) {
      for (const field of template.fields) {
        expect(template.defaults[field.id]).toBeDefined();
        if (field.options) {
          const values = field.options.map((option) => option.value);
          expect(values).toContain(String(template.defaults[field.id]));
        }
      }
    }
  });

  it('rechaza props inválidas con MotionPlanError sin inventar capas', () => {
    for (const template of nuevas) {
      const colorField = template.fields.find((field) => field.kind === 'color');
      expect(colorField).toBeDefined();
      const props = { ...template.defaults, [colorField!.id]: 'rojo' };
      expect(() => buildMotionPlan(template, props, context)).toThrow(MotionPlanError);
    }
  });

  it('mantiene el plan válido en 4K vertical con tamaños acotados', () => {
    for (const template of nuevas) {
      const plan = buildMotionPlan(template, { ...template.defaults }, verticalContext);
      expectLayersValidas(plan.layers);
      for (const layer of plan.layers) {
        if (layer.kind === 'text') {
          expect(layer.fontSizePx).toBeLessThanOrEqual(400);
        }
      }
    }
  });

  it('escala la coreografía con el fps del proyecto', () => {
    const pal = buildMotionPlan(glitchTextTemplate, { ...glitchTextTemplate.defaults }, {
      ...context,
      fpsNum: 60,
    });
    for (const layer of pal.layers) {
      expect(layer.animation.inFrames ?? 0).toBeLessThanOrEqual(600);
    }
  });

  it('escenifica los efectos: glitch alternado, punch rápido y cine lento', () => {
    const glitch = buildMotionPlan(
      glitchTextTemplate,
      { ...glitchTextTemplate.defaults },
      context,
    );
    const entradas = new Set(
      glitch.layers
        .filter((layer) => layer.kind === 'text')
        .map((layer) => layer.animation.inFrames),
    );
    // Tres copias con entradas desfasadas: opacidad alternada.
    expect(entradas.size).toBe(3);

    const punch = buildMotionPlan(zoomPunchTemplate, { ...zoomPunchTemplate.defaults }, context);
    const punchIn = punch.layers[0]!.animation.inFrames ?? 0;
    // Keyframes agresivos: entra más rápido que el 0,4 s estándar.
    expect(punchIn).toBeLessThan(Math.round(30 * 0.4));
    expect(punch.layers[0]!.animation.kind).toBe('pop');

    const cine = buildMotionPlan(
      cinematicTitleTemplate,
      { ...cinematicTitleTemplate.defaults },
      context,
    );
    const title = cine.layers.find((layer) => layer.kind === 'text')!;
    expect(title.animation.kind).toBe('pop');
    // Escala lenta: tarda más que el estándar.
    expect(title.animation.inFrames ?? 0).toBeGreaterThan(Math.round(30 * 0.4));
    const subtitle = cine.layers.filter((layer) => layer.kind === 'text').at(-1)!;
    expect(subtitle.animation.kind).toBe('slide-up');
    expect(subtitle.animation.inFrames ?? 0).toBeGreaterThan(title.animation.inFrames ?? 0);
  });

  it('las barras de cine arman el letterbox con las dos barras negras', () => {
    const plan = buildMotionPlan(cinemaBarsTemplate, { ...cinemaBarsTemplate.defaults }, context);
    const barras = plan.layers.filter(
      (layer) => layer.kind === 'rect' && layer.color === '#000000',
    );
    expect(barras).toHaveLength(2);
    expect(barras[0]!.y).toBe(0);
    expect(barras[1]!.y + barras[1]!.height).toBeCloseTo(1, 5);
  });
});

// Misma invariante que MotionView.test.tsx: la preview muestra las capas del
// plan con data-layer-kind y ninguna queda afuera.
describe('plantillas motion pro en la preview', () => {
  it('muestra capas de texto y respeta el total del plan', () => {
    for (const template of nuevas) {
      const plan = buildMotionPlan(template, { ...template.defaults }, context);
      const { container, unmount } = render(
        createElement(MotionPreview, { plan, progress: 0.45 }),
      );
      expect(container.querySelectorAll('[data-layer-kind="text"]').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('[data-layer-kind]').length).toBe(plan.layers.length);
      unmount();
    }
  });
});
