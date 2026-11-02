import { describe, expect, it } from 'vitest';
import type { TranscriptionSegment } from '../services/project-service';
import { buildNarrationPlan, fallbackAssignments } from './narration-plan';

function segment(
  start: number,
  end: number,
  text: string,
  words?: { start: number; end: number; word: string }[],
): TranscriptionSegment {
  return {
    start,
    end,
    text,
    words: (words ?? []).map((word) => ({ ...word, probability: 0.9 })),
  };
}

describe('plan de narración', () => {
  it('corta por puntuación y conserva tiempos de palabras', () => {
    const plan = buildNarrationPlan([
      segment(0, 4, 'Hola mundo. ¿Cómo estás?', [
        { start: 0, end: 0.4, word: 'Hola' },
        { start: 0.4, end: 0.8, word: 'mundo.' },
        { start: 1.6, end: 2, word: '¿Cómo' },
        { start: 2, end: 2.4, word: 'estás?' },
      ]),
    ]);
    expect(plan.sentences.map((sentence) => sentence.text)).toEqual([
      'Hola mundo.',
      '¿Cómo estás?',
    ]);
    expect(plan.sentences[0]?.start).toBeCloseTo(0, 3);
    expect(plan.sentences[0]?.end).toBeCloseTo(0.8, 3);
    expect(plan.sentences[1]?.start).toBeCloseTo(1.6, 3);
    expect(plan.start).toBeCloseTo(0, 3);
    expect(plan.end).toBeCloseTo(2.9, 3);
  });

  it('sintetiza palabras cuando la transcripción sólo trae texto', () => {
    const plan = buildNarrationPlan([segment(0, 3, 'uno dos tres cuatro')]);
    expect(plan.sentences).toHaveLength(1);
    expect(plan.sentences[0]?.text).toBe('uno dos tres cuatro');
    expect(plan.sentences[0]?.words).toHaveLength(4);
  });

  it('parte frases demasiado largas en una pausa', () => {
    const words = Array.from({ length: 10 }, (_, index) => ({
      start: index < 8 ? index : index + 2,
      end: index < 8 ? index + 0.8 : index + 2.8,
      word: `w${index}`,
    }));
    const plan = buildNarrationPlan([segment(0, 20, words.map((word) => word.word).join(' '), words)], {
      maxSentenceSeconds: 5,
    });
    expect(plan.sentences.length).toBeGreaterThanOrEqual(2);
  });

  it('fusiona frases diminutas con la vecina', () => {
    const plan = buildNarrationPlan([
      segment(0, 0.4, 'Sí.', [{ start: 0, end: 0.4, word: 'Sí.' }]),
      segment(0.5, 3, 'Esto es una frase completa.', [
        { start: 0.5, end: 1, word: 'Esto' },
        { start: 1, end: 1.5, word: 'es' },
        { start: 1.5, end: 2, word: 'una' },
        { start: 2, end: 2.5, word: 'frase' },
        { start: 2.5, end: 3, word: 'completa.' },
      ]),
    ]);
    expect(plan.sentences).toHaveLength(1);
    expect(plan.sentences[0]?.text).toBe('Sí. Esto es una frase completa.');
  });

  it('devuelve un plan vacío sin palabras', () => {
    const plan = buildNarrationPlan([segment(0, 1, '')]);
    expect(plan.sentences).toHaveLength(0);
  });

  it('genera asignaciones de respaldo en orden', () => {
    expect(fallbackAssignments(5, 3)).toEqual([0, 1, 2, 0, 1]);
    expect(fallbackAssignments(2, 0)).toEqual([]);
  });
});
