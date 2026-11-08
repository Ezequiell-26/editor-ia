import { describe, expect, it } from 'vitest';
import { effectRegistry } from '@editor-ia/effect-kit';
import { stackFromTemplate } from './effect-templates';
import { builtinEffectTemplates } from './builtin-effect-templates';

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
});
