import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  captionCharsPerLineForProject,
  captionOffsetYForProject,
  planCaptionCues,
  wrapCaptionText,
  type CaptionSegmentInput,
} from './caption-planner';

function timedSegment(text: string, words: readonly string[], start = 0, end = 6): CaptionSegmentInput {
  const step = (end - start) / words.length;
  return {
    start,
    end,
    text,
    words: words.map((word, index) => ({
      word,
      start: start + index * step,
      end: start + (index + 1) * step,
    })),
  };
}

const LONG =
  'Hoy vamos a ver tres ejercicios para mejorar la sentadilla sin dolor de rodilla y cómo progresar cada semana';

describe('wrapCaptionText', () => {
  it('corta en dos líneas sin pasar el ancho pedido', () => {
    const text = wrapCaptionText('Hoy vamos a ver tres ejercicios para mejorar la sentadilla', 42, 2);
    const lines = text.split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(42);
    }
  });

  it('deja intacto lo que ya entra en una línea', () => {
    expect(wrapCaptionText('Hola', 42, 2)).toBe('Hola');
  });
});

describe('planCaptionCues', () => {
  it('parte un segmento largo en cues que entran en dos líneas', () => {
    const words = LONG.split(' ');
    const plan = planCaptionCues([timedSegment(LONG, words)], { maxCharsPerLine: 42, maxLines: 2 });
    expect(plan.cues.length).toBeGreaterThan(1);
    expect(plan.splitSegments).toBe(1);
    for (const cue of plan.cues) {
      expect(cue.text.split('\n').length).toBeLessThanOrEqual(2);
      expect([...cue.text.replace(/\n/g, ' ')].length).toBeLessThanOrEqual(84);
    }
    // El texto completo sobrevive al corte, en orden.
    expect(plan.cues.map((cue) => cue.text.replace(/\n/g, ' ')).join(' ')).toBe(LONG);
  });

  it('usa los tiempos de palabra cuando el transcriptor los devuelve', () => {
    const words = ['Hola', 'desde', 'la', 'prueba'];
    const plan = planCaptionCues([timedSegment('Hola desde la prueba', words, 2, 4)]);
    expect(plan.cues).toHaveLength(1);
    expect(plan.cues[0]!.startSeconds).toBeCloseTo(2, 5);
    expect(plan.cues[0]!.endSeconds).toBeCloseTo(4, 5);
    expect(plan.cues[0]!.words?.map((word) => word.text)).toEqual(words);
  });

  it('sin tiempos de palabra reparte el segmento en proporción al texto', () => {
    const plan = planCaptionCues([
      { start: 10, end: 12, text: 'una frase corta de prueba' },
    ]);
    expect(plan.cues).toHaveLength(1);
    expect(plan.cues[0]!.startSeconds).toBeCloseTo(10, 5);
    expect(plan.cues[0]!.endSeconds).toBeCloseTo(12, 5);
  });

  it('si las palabras no cubren el texto, no pierde contenido', () => {
    const plan = planCaptionCues([
      {
        start: 0,
        end: 2,
        text: 'Hola desde la prueba.',
        words: [
          { word: 'Hola', start: 0, end: 0.4 },
          { word: 'desde', start: 0.4, end: 0.8 },
          { word: 'la', start: 0.8, end: 1.2 },
        ],
      },
    ]);
    expect(plan.cues.map((cue) => cue.text).join(' ')).toBe('Hola desde la prueba.');
    expect(plan.cues[0]!.words).toBeUndefined();
  });

  it('respeta el mínimo de duración sin pisar el cue siguiente', () => {
    const plan = planCaptionCues([
      { start: 0, end: 0.2, text: 'Sí' },
      { start: 0.2, end: 2, text: 'Perfecto, seguimos' },
    ]);
    expect(plan.cues[0]!.endSeconds - plan.cues[0]!.startSeconds).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it('mide la velocidad de lectura en vez de estirar el tiempo', () => {
    const fast = timedSegment(
      'esto es una frase larguísima dicha a toda velocidad sin pausas',
      ['esto', 'es', 'una', 'frase', 'larguísima', 'dicha', 'a', 'toda', 'velocidad', 'sin', 'pausas'],
      0,
      1.2,
    );
    const plan = planCaptionCues([fast], { maxCps: 20 });
    expect(plan.overCps).toBeGreaterThan(0);
    expect(plan.maxCps).toBeGreaterThan(20);
    // El final no se movió: la sincronización con la voz manda.
    expect(plan.cues.at(-1)!.endSeconds).toBeCloseTo(1.2, 5);
  });

  it('no inventa cues de segmentos vacíos o sin duración', () => {
    expect(
      planCaptionCues([
        { start: 0, end: 2, text: '   ' },
        { start: 2, end: 2, text: 'sin duración' },
      ]).cues,
    ).toHaveLength(0);
  });
});

describe('colocación según el formato', () => {
  it('sube los subtítulos en vertical y los deja en horizontal', () => {
    const vertical = createEmptyProject('Vertical');
    vertical.video = { width: 1080, height: 1920, frameRate: { num: 30, den: 1 } };
    const horizontal = createEmptyProject('Horizontal');
    expect(captionOffsetYForProject(vertical)).toBe(-154);
    expect(captionOffsetYForProject(horizontal)).toBe(0);
    expect(captionCharsPerLineForProject(vertical)).toBe(32);
    expect(captionCharsPerLineForProject(horizontal)).toBe(42);
  });
});
