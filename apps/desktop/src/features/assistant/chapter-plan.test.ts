import { describe, expect, it } from 'vitest';
import { planChapterScenes } from './chapter-plan';

describe('planificador capítulo→escena', () => {
  it('separa capítulos Markdown y reparte los clips en orden', () => {
    const plan = planChapterScenes(
      [
        '# Apertura',
        'Una ciudad despierta. La cámara recorre el río.',
        '',
        '# Desarrollo',
        'El protagonista camina. Descubre una pista.',
        'La pista cambia todo.',
        '',
        '## Cierre',
        'Vuelve a casa.',
      ].join('\n'),
      ['clip-a', 'clip-b'],
      40,
    );
    expect(plan.map((scene) => scene.chapter)).toEqual(['Apertura', 'Desarrollo', 'Cierre']);
    expect(plan.map((scene) => scene.clipId)).toEqual(['clip-a', 'clip-b', 'clip-a']);
    expect(plan.map((scene) => scene.intent)).toEqual(['hook', 'explainer', 'outro']);
    expect(plan[1]?.narration).toContain('La pista cambia todo.');
    expect(plan[0]?.title).toBe('Una ciudad despierta.');
    expect(plan[0]?.notes).toBe('Capítulo: Apertura');
  });

  it('corta frases largas en escenas dentro del presupuesto de palabras', () => {
    const long = Array.from({ length: 45 }, (_, index) => `palabra${index}`).join(' ');
    const plan = planChapterScenes(long, ['clip-a'], 20);
    expect(plan).toHaveLength(3);
    for (const scene of plan) {
      expect(scene.narration.split(/\s+/).length).toBeLessThanOrEqual(20);
    }
    expect(plan.map((scene) => scene.narration).join(' ')).toBe(long);
  });

  it('sin encabezados usa un capítulo por defecto y no inventa escenas vacías', () => {
    const plan = planChapterScenes('Solo una frase breve.', ['clip-a']);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ chapter: 'Capítulo 1', intent: 'hook' });
    expect(planChapterScenes('   ', ['clip-a'])).toEqual([]);
    expect(planChapterScenes('Texto válido.', [])).toEqual([]);
  });
});
