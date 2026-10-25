import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  buildMotionPlan,
  buildProjectMotionPlans,
  freeTextTemplate,
  layerVisual,
  lowerThirdTemplate,
  MotionPlanError,
  titleCardTemplate,
} from './plan';
import { templateById } from './templates';

const NOW = '2026-01-01T00:00:00.000Z';
const context = {
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

describe('motion plan', () => {
  it('construye un lower third con fondo y dos textos', () => {
    const plan = buildMotionPlan(
      lowerThirdTemplate,
      {
        name: 'Ana Pérez',
        role: 'Editora',
        accent: '#7dd3c0',
        side: 'left',
        animation: 'slide-left',
      },
      context,
    );
    expect(plan.layers.filter((layer) => layer.kind === 'text')).toHaveLength(2);
    expect(plan.layers.some((layer) => layer.kind === 'rect')).toBe(true);
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('rechaza un color inválido sin inventar una plantilla', () => {
    expect(() =>
      buildMotionPlan(
        lowerThirdTemplate,
        { name: 'Ana', role: '', accent: 'rojo', side: 'left', animation: 'fade' },
        context,
      ),
    ).toThrow(MotionPlanError);
  });

  it('envuelve un título largo en varias líneas y respeta el límite', () => {
    const plan = buildMotionPlan(
      titleCardTemplate,
      {
        title:
          'Una historia larga sobre edición de video que necesita varias líneas para entrar bien',
        subtitle: 'Prueba',
        background: '#0f172a',
        accent: '#7dd3c0',
        align: 'left',
        animation: 'slide-up',
      },
      context,
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThan(2);
    expect(texts.length).toBeLessThanOrEqual(8);
  });

  it('calcula fade y slide sin salir de rango', () => {
    const layer = {
      kind: 'text' as const,
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.1,
      text: 'Hola',
      fontFamily: 'Segoe UI',
      fontSizePx: 48,
      weight: 600,
      color: '#ffffff',
      align: 'left' as const,
      animation: { kind: 'fade' as const, inFrames: 10, outFrames: 10 },
    };
    const mid = layerVisual(layer, 0.5, 60);
    expect(mid.opacity).toBeGreaterThan(0.9);
    expect(mid.opacity).toBeLessThanOrEqual(1);
    const slide = layerVisual(
      { ...layer, animation: { kind: 'slide-up', distance: 0.1 } },
      0.1,
      60,
    );
    expect(slide.transform).toContain('translateY');
  });

  it('indexa planes por clip y reporta un motion faltante', () => {
    const project = createEmptyProject('Motion', NOW);
    const track = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'graphic' as const,
      label: 'G1',
      order: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
    project.timeline.tracks.push(track);
    project.motion.push({
      id: '00000000-0000-4000-8000-000000000002',
      template: { id: 'lower-third', version: '1.0.0', source: 'bundled' },
      props: { name: 'Ana', role: '', accent: '#7dd3c0', side: 'left', animation: 'fade' },
    });
    project.timeline.clips.push({
      id: '00000000-0000-4000-8000-000000000003',
      trackId: track.id,
      kind: 'graphic',
      label: 'Placa',
      startFrame: 0,
      durationFrames: 90,
      source: { type: 'graphic', motionId: project.motion[0]!.id },
    });
    const bundle = buildProjectMotionPlans(project);
    expect(bundle.plans['00000000-0000-4000-8000-000000000003']).toBeDefined();
    expect(bundle.errors).toEqual([]);

    project.timeline.clips[0]!.source = {
      type: 'graphic',
      motionId: '00000000-0000-4000-8000-000000000099',
    };
    const broken = buildProjectMotionPlans(project);
    expect(broken.errors[0]).toMatch(/no existe/i);
  });

  it('expone las cinco plantillas con versión', () => {
    for (const id of [
      'title-card',
      'free-text',
      'lower-third',
      'end-card',
      'stat-callout',
    ]) {
      expect(templateById(id)?.version).toBe('1.0.0');
    }
  });

  it('acota el texto libre en 4K vertical y no desborda las líneas', () => {
    const plan = buildMotionPlan(
      freeTextTemplate,
      {
        ...freeTextTemplate.defaults,
        text: 'uno\ndos\ntres\ncuatro\ncinco\nseis',
        size: 200,
        y: 0.1,
        width: 0.9,
      },
      { width: 2160, height: 3840, fpsNum: 30, fpsDen: 1, durationFrames: 90 },
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThan(0);
    for (const layer of texts) {
      expect(layer.fontSizePx).toBeLessThanOrEqual(400);
      expect(layer.y).toBeLessThanOrEqual(1);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.001);
    }
  });
});
