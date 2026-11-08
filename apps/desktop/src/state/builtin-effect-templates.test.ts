import { describe, expect, it } from 'vitest';
import { effectRegistry } from '@editor-ia/effect-kit';
import { stackFromTemplate } from './effect-templates';
import {
  builtinEffectTemplates,
  sanitizeBuiltinKeyframes,
} from './builtin-effect-templates';

describe('plantillas de fábrica', () => {
  it('ofrece un catálogo curado para video y para audio', () => {
    const video = builtinEffectTemplates('video');
    const audio = builtinEffectTemplates('audio');
    expect(video.length).toBeGreaterThanOrEqual(10);
    expect(audio.length).toBeGreaterThanOrEqual(10);
    for (const template of [...video, ...audio]) {
      expect(template.id).toMatch(/^builtin-/);
      expect(template.stack.length).toBeGreaterThan(0);
      expect(template.stack.length).toBeLessThanOrEqual(4);
    }
    // Ninguna plantilla mezcla los dos tipos de pila.
    expect(video.every((t) => t.kind === 'video')).toBe(true);
    expect(audio.every((t) => t.kind === 'audio')).toBe(true);
  });

  it('todas las recetas existen en el catálogo y se aplican completas', () => {
    for (const template of builtinEffectTemplates('video')) {
      const { stack, skipped } = stackFromTemplate(template);
      expect(skipped, template.name).toBe(0);
      expect(stack.map((i) => i.effectId)).toEqual(
        template.stack.map((i) => i.effectId),
      );
      for (const instance of stack) {
        expect(effectRegistry.get(instance.effectId), instance.effectId).toBeTruthy();
        // Los params quedaron normalizados: toda clave declarada por el
        // manifiesto tiene valor y ninguna clave ajena sobrevive.
        const manifest = effectRegistry.get(instance.effectId)!;
        for (const spec of manifest.params) {
          expect(instance.params[spec.id], `${template.name}:${spec.id}`).toBeDefined();
        }
      }
    }
  });

  it('los ids de instancia son nuevos en cada resolución', () => {
    const first = builtinEffectTemplates('video');
    const second = builtinEffectTemplates('video');
    expect(first).toHaveLength(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]!.stack[0]!.id).not.toBe(second[index]!.stack[0]!.id);
    }
  });

  it('una plantilla de audio no aparece en la lista de video', () => {
    const names = builtinEffectTemplates('video').map((t) => t.name);
    expect(names).not.toContain('Voz limpia');
    const audioNames = builtinEffectTemplates('audio').map((t) => t.name);
    expect(audioNames).toContain('Voz limpia');
  });

  it('las recetas animadas llegan con sus keyframes al stack aplicado', () => {
    const shake = builtinEffectTemplates('video').find(
      (t) => t.name === 'Golpe que se apaga',
    );
    const tremolo = builtinEffectTemplates('audio').find(
      (t) => t.name === 'Tensión que crece',
    );
    expect(shake && tremolo).toBeTruthy();
    if (!shake || !tremolo) return;

    const { stack: shakeStack } = stackFromTemplate(shake);
    const shakeInstance = shakeStack[0];
    const amount = shakeInstance?.keyframes?.amount;
    expect(amount).toHaveLength(3);
    expect(amount?.map((key) => key.frame)).toEqual([0, 10, 28]);
    expect(amount?.[1]?.easing).toBe('ease-out');
    // Valores dentro del dominio del spec (amount: 0–40 px).
    for (const key of amount ?? []) {
      expect(key.value).toBeGreaterThanOrEqual(0);
      expect(key.value).toBeLessThanOrEqual(40);
    }

    const { stack: tremoloStack } = stackFromTemplate(tremolo);
    const depth = tremoloStack[0]?.keyframes?.depth;
    expect(depth).toHaveLength(2);
    expect(depth?.[0]?.value).toBe(0);
    expect(depth?.[1]?.value).toBeCloseTo(0.7);
    // La curva vive en la clave que inicia el tramo (0→24): un easing o
    // bezier en la última clave es inerte porque no hay segmento que salga
    // de ella. Antes el ease-in-out estaba en la clave del frame 24 y la
    // rampa salía lineal.
    expect(depth?.[0]?.bezier).toEqual({
      cp1X: 0.35,
      cp1Y: 0.05,
      cp2X: 0.5,
      cp2Y: 1,
    });
    expect(depth?.[1]?.easing).toBeUndefined();
    expect(depth?.[1]?.bezier).toBeUndefined();
    // El resto de las de fábrica sigue estático.
    const lookCine = builtinEffectTemplates('video').find((t) => t.name === 'Look cine');
    expect(
      lookCine?.stack.every(
        (instance) => !instance.keyframes || Object.keys(instance.keyframes).length === 0,
      ),
    ).toBe(true);
  });
});

describe('sanitizeBuiltinKeyframes', () => {
  const shake = effectRegistry.get('impact.shake');
  if (!shake) throw new Error('falta impact.shake en el catálogo');

  it('descarta params ajenos, no numéricos, frames negativos y pistas cortas', () => {
    const tracks = sanitizeBuiltinKeyframes(shake, {
      amount: [
        { frame: 0, value: 10 },
        { frame: 5, value: 20 },
      ],
      speed: [{ frame: 0, value: 5 }], // una sola clave: no es pista
      nope: [
        { frame: 0, value: 1 },
        { frame: 5, value: 2 },
      ], // param inexistente
    });
    expect(Object.keys(tracks ?? {})).toEqual(['amount']);
    expect(tracks?.amount).toHaveLength(2);
  });

  it('coerciona valores al dominio del spec y descarta easing inválido', () => {
    const tracks = sanitizeBuiltinKeyframes(shake, {
      amount: [
        { frame: -3, value: 99 },
        { frame: 0, value: -50, easing: 'bounce' as never },
        { frame: 4.6, value: 10 },
      ],
    });
    const track = tracks?.amount;
    expect(track?.map((key) => key.frame)).toEqual([0, 5]); // frame redondeado
    expect(track?.[0]?.value).toBe(0); // -50 clampeado al mínimo
    expect(track?.[0]?.easing).toBeUndefined(); // 'bounce' no existe
  });

  it('conserva un bezier válido y descarta los que salen del rango del schema', () => {
    const curve = { cp1X: 0.2, cp1Y: 0.9, cp2X: 0.3, cp2Y: 1 };
    const tracks = sanitizeBuiltinKeyframes(shake, {
      amount: [
        { frame: 0, value: 5, bezier: curve },
        { frame: 4, value: 15, bezier: { cp1X: 1.5, cp1Y: 0, cp2X: 0, cp2Y: 0 } },
        { frame: 8, value: 25, bezier: { cp1X: Number.NaN, cp1Y: 0, cp2X: 0, cp2Y: 0 } },
        { frame: 12, value: 30, bezier: 'no-es-objeto' as never },
      ],
    });
    const track = tracks?.amount;
    expect(track?.[0]?.bezier).toEqual(curve);
    // Fuera de 0..1, NaN o no-objeto: la clave sobrevive con su easing, sin
    // curva — igual que un documento cuya bezier no pasa el schema.
    expect(track?.[1]?.bezier).toBeUndefined();
    expect(track?.[2]?.bezier).toBeUndefined();
    expect(track?.[3]?.bezier).toBeUndefined();
  });

  it('sin pistas válidas devuelve undefined', () => {
    expect(sanitizeBuiltinKeyframes(shake, undefined)).toBeUndefined();
    expect(sanitizeBuiltinKeyframes(shake, {})).toBeUndefined();
  });
});
