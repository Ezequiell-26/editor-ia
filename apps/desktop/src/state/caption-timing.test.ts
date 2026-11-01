import { describe, expect, it } from 'vitest';
import { planCaptionTiming, speechWeight } from './caption-timing';

const FPS = 30;

describe('speechWeight', () => {
  it('suma una pausa al cerrar una oración', () => {
    expect(speechWeight('Hola.')).toBe(5 + 8);
  });

  it('suma menos por una coma', () => {
    expect(speechWeight('Hola,')).toBe(5 + 4);
  });

  it('no cuenta espacios', () => {
    expect(speechWeight('uno dos')).toBe(6);
  });
});

describe('planCaptionTiming', () => {
  it('cubre la escena completa sin huecos ni solapes', () => {
    const plan = planCaptionTiming(['Primer bloque.', 'Segundo bloque.', 'Tercero.'], 100, 300, {
      fps: FPS,
    });
    expect(plan.cues).toHaveLength(3);
    let cursor = 100;
    for (const cue of plan.cues) {
      expect(cue.startFrame).toBe(cursor);
      expect(cue.endFrame).toBeGreaterThan(cue.startFrame);
      cursor = cue.endFrame;
    }
    expect(cursor).toBe(400);
  });

  it('da más tiempo a la oración cerrada que a la coma', () => {
    const plan = planCaptionTiming(['Cierra igual.', 'Sigue igual,'], 0, 120, { fps: FPS });
    const [first, second] = plan.cues;
    expect(first!.endFrame - first!.startFrame).toBeGreaterThan(
      second!.endFrame - second!.startFrame,
    );
  });

  it('respeta el máximo por bloque cuando el texto entra en el tiempo', () => {
    const plan = planCaptionTiming(['Uno dos.', 'Tres cuatro.', 'Cinco seis.'], 0, 180, {
      fps: FPS,
      maxSeconds: 2,
      minSeconds: 0.5,
    });
    for (const cue of plan.cues) {
      expect(cue.endFrame - cue.startFrame).toBeLessThanOrEqual(2 * FPS);
    }
    expect(plan.cues.at(-1)?.endFrame).toBe(180);
    expect(plan.warnings).toEqual([]);
  });

  it('avisa cuando no hay texto suficiente para respetar el máximo', () => {
    const plan = planCaptionTiming(['Corto.', 'Largo.'], 0, 900, {
      fps: FPS,
      maxSeconds: 2,
      minSeconds: 0.5,
    });
    expect(plan.cues.at(-1)?.endFrame).toBe(900);
    expect(plan.warnings.join(' ')).toMatch(/más de 2 s/);
  });

  it('respeta el mínimo cuando la escena tiene margen', () => {
    const plan = planCaptionTiming(['A.', 'B.'], 0, 240, {
      fps: FPS,
      minSeconds: 1,
    });
    for (const cue of plan.cues) {
      expect(cue.endFrame - cue.startFrame).toBeGreaterThanOrEqual(FPS);
    }
  });

  it('avisa cuando la escena es demasiado corta para tantos bloques', () => {
    const plan = planCaptionTiming(['Uno.', 'Dos.', 'Tres.', 'Cuatro.'], 0, 30, {
      fps: FPS,
      minSeconds: 1,
    });
    expect(plan.warnings.join(' ')).toMatch(/corta/i);
    expect(plan.cues.at(-1)?.endFrame).toBe(30);
  });

  it('avisa cuando un bloque supera la velocidad de lectura', () => {
    const plan = planCaptionTiming(
      ['Este bloque tiene muchísimo texto para tan poco tiempo en pantalla.'],
      0,
      20,
      { fps: FPS, maxCps: 10 },
    );
    expect(plan.warnings.join(' ')).toMatch(/caracteres por segundo/);
  });

  it('no inventa subtítulos sin texto', () => {
    expect(planCaptionTiming(['', '   '], 0, 90, { fps: FPS }).cues).toHaveLength(0);
  });

  it('no devuelve bloques con duración cero', () => {
    expect(planCaptionTiming(['Texto.'], 0, 0, { fps: FPS }).cues).toHaveLength(0);
  });

  it('es determinista y suma exactamente la duración', () => {
    const chunks = ['Uno, dos.', 'Tres; cuatro.', 'Cinco seis siete.', 'Ocho.'];
    const a = planCaptionTiming(chunks, 0, 407, { fps: 25 });
    const b = planCaptionTiming(chunks, 0, 407, { fps: 25 });
    expect(a).toEqual(b);
    expect(a.cues.at(-1)?.endFrame).toBe(407);
    const total = a.cues.reduce((sum, cue) => sum + (cue.endFrame - cue.startFrame), 0);
    expect(total).toBe(407);
  });
});
