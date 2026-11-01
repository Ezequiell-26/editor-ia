import { describe, expect, it } from 'vitest';
import {
  MIN_SMART_TRANSITION_FRAMES,
  SMART_TRANSITION_MAX_FRAMES,
  describeTransitionPlan,
  planSmartTransitions,
  type AssemblyShot,
} from './smart-transitions';

function shot(overrides: Partial<AssemblyShot> = {}): AssemblyShot {
  return { kind: 'image', durationFrames: 120, hasNarration: true, ...overrides };
}

describe('planSmartTransitions', () => {
  it('no pone transición en el primer plano', () => {
    const plan = planSmartTransitions([shot(), shot()], { fps: 30 });
    expect(plan[0]).toBeNull();
    expect(plan[1]).not.toBeNull();
  });

  it('usa disolvencia entre fotos con narración y ritmo estable', () => {
    const plan = planSmartTransitions([shot(), shot()], { fps: 30, baseFrames: 12 });
    expect(plan[1]).toMatchObject({ type: 'dissolve', frames: 12, easing: 'ease-out' });
  });

  it('alterna barridos entre fotos cuando el ritmo es rápido', () => {
    const plan = planSmartTransitions([shot(), shot(), shot(), shot()], {
      fps: 30,
      baseFrames: 10,
      rhythm: 'punchy',
    });
    expect(plan[1]?.type).toBe('wipe-left');
    expect(plan[2]?.type).toBe('wipe-right');
    expect(plan[3]?.type).toBe('wipe-left');
  });

  it('funde a negro cuando cambia el tipo de material y usa easing lineal', () => {
    const plan = planSmartTransitions(
      [shot({ kind: 'image' }), shot({ kind: 'video' })],
      { fps: 30 },
    );
    expect(plan[1]).toMatchObject({ type: 'fade-black', easing: 'linear' });
    expect(plan[1]?.reason).toMatch(/fundido a negro/);
  });

  it('no compite con la voz: disolvencia cuando hay narración a ambos lados', () => {
    const plan = planSmartTransitions(
      [
        shot({ kind: 'video', hasNarration: true }),
        shot({ kind: 'video', hasNarration: true }),
      ],
      { fps: 30, rhythm: 'punchy' },
    );
    expect(plan[1]?.type).toBe('dissolve');
  });

  it('desplaza cuando el video no tiene narración', () => {
    const plan = planSmartTransitions(
      [
        shot({ kind: 'video', hasNarration: false }),
        shot({ kind: 'video', hasNarration: false }),
        shot({ kind: 'video', hasNarration: false }),
      ],
      { fps: 30 },
    );
    expect(plan[1]?.type).toBe('slide-left');
    expect(plan[2]?.type).toBe('slide-right');
  });

  it('prefiere disolvencia en planos demasiado cortos', () => {
    const plan = planSmartTransitions(
      [
        shot({ kind: 'video', hasNarration: false, durationFrames: 12 }),
        shot({ kind: 'video', hasNarration: false, durationFrames: 12 }),
      ],
      { fps: 30 },
    );
    expect(plan[1]?.type).toBe('dissolve');
    expect(plan[1]?.reason).toMatch(/cortos/);
  });

  it('nunca pasa de dos segundos ni del máximo de frames', () => {
    const plan = planSmartTransitions([shot(), shot()], { fps: 60, baseFrames: 600 });
    expect(plan[1]?.frames).toBe(SMART_TRANSITION_MAX_FRAMES);
    const plan30 = planSmartTransitions([shot(), shot()], { fps: 30, baseFrames: 600 });
    expect(plan30[1]?.frames).toBe(60);
  });

  it('nunca es más larga que el plano más corto del corte', () => {
    const plan = planSmartTransitions(
      [shot({ durationFrames: 200 }), shot({ durationFrames: 9 })],
      { fps: 30, baseFrames: 40 },
    );
    expect(plan[1]?.frames).toBe(9);
  });

  it('omite la transición cuando no llega al mínimo perceptible', () => {
    const plan = planSmartTransitions(
      [shot({ durationFrames: MIN_SMART_TRANSITION_FRAMES - 1 }), shot()],
      { fps: 30, baseFrames: 12 },
    );
    expect(plan[1]).toBeNull();
  });

  it('escala la duración según el ritmo', () => {
    const calm = planSmartTransitions([shot(), shot()], { fps: 30, baseFrames: 20, rhythm: 'calm' });
    const steady = planSmartTransitions([shot(), shot()], { fps: 30, baseFrames: 20 });
    const punchy = planSmartTransitions([shot(), shot()], { fps: 30, baseFrames: 20, rhythm: 'punchy' });
    expect(calm[1]?.frames).toBe(15);
    expect(steady[1]?.frames).toBe(20);
    expect(punchy[1]?.frames).toBe(28);
  });

  it('es determinista', () => {
    const shots = [shot(), shot({ kind: 'video' }), shot(), shot({ durationFrames: 40 })];
    const a = planSmartTransitions(shots, { fps: 30, baseFrames: 14, rhythm: 'punchy' });
    const b = planSmartTransitions(shots, { fps: 30, baseFrames: 14, rhythm: 'punchy' });
    expect(a).toEqual(b);
  });

  it('ignora planos sin duración válida', () => {
    const plan = planSmartTransitions(
      [shot({ durationFrames: 0 }), shot({ durationFrames: Number.NaN })],
      { fps: 30 },
    );
    expect(plan[1]).toBeNull();
  });
});

describe('describeTransitionPlan', () => {
  it('resume los tipos usados', () => {
    const plan = planSmartTransitions(
      [shot(), shot(), shot(), shot({ kind: 'video' })],
      { fps: 30, baseFrames: 10 },
    );
    const summary = describeTransitionPlan(plan);
    expect(summary).toMatch(/3 corte\(s\)/);
    expect(summary).toMatch(/dissolve/);
    expect(summary).toMatch(/fade-black/);
  });

  it('explica el corte seco cuando no hay transiciones', () => {
    expect(describeTransitionPlan([null, null])).toMatch(/corte seco/i);
  });
});
