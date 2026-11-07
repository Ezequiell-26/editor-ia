import { describe, expect, it } from 'vitest';
import { createInstance, effectRegistry, MAX_STACK_EFFECTS } from '@editor-ia/effect-kit';
import {
  deleteEffectTemplate,
  loadEffectTemplates,
  parseEffectTemplateFile,
  saveEffectTemplate,
  serializeEffectTemplate,
  stackFromTemplate,
} from './effect-templates';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const EXPOSURE = effectRegistry.get('color.exposure');
const ECHO = effectRegistry.get('audio.echo');
if (!EXPOSURE || !ECHO) throw new Error('catálogo sin los efectos de prueba');

const VIDEO_STACK = [createInstance(EXPOSURE), createInstance(EXPOSURE)];

describe('plantillas de efectos', () => {
  it('guarda, lista y borra plantillas por tipo', () => {
    const storage = fakeStorage();
    const saved = saveEffectTemplate('Mi look', 'video', VIDEO_STACK, storage);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe('Mi look');
    expect(loadEffectTemplates(storage)).toHaveLength(1);
    expect(deleteEffectTemplate(saved[0]!.id, storage)).toHaveLength(0);
    expect(loadEffectTemplates(storage)).toHaveLength(0);
  });

  it('reemplaza por nombre+tipo sin duplicar', () => {
    const storage = fakeStorage();
    saveEffectTemplate('Look', 'video', VIDEO_STACK, storage);
    saveEffectTemplate('look', 'video', [createInstance(EXPOSURE)], storage);
    const templates = loadEffectTemplates(storage);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.stack).toHaveLength(1);
    // Mismo nombre en otro tipo convive.
    saveEffectTemplate('Look', 'audio', [createInstance(ECHO)], storage);
    expect(loadEffectTemplates(storage)).toHaveLength(2);
  });

  it('no guarda stacks vacíos ni nombres en blanco', () => {
    const storage = fakeStorage();
    expect(saveEffectTemplate('X', 'video', [], storage)).toHaveLength(0);
    expect(saveEffectTemplate('   ', 'video', VIDEO_STACK, storage)).toHaveLength(0);
  });

  it('serializa y parsea el archivo JSON', () => {
    const storage = fakeStorage();
    const [template] = saveEffectTemplate('Exportable', 'audio', [createInstance(ECHO)], storage);
    const text = serializeEffectTemplate(template!);
    const parsed = parseEffectTemplateFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.template.name).toBe('Exportable');
      expect(parsed.template.kind).toBe('audio');
      expect(parsed.template.stack).toHaveLength(1);
    }
  });

  it('rechaza JSON inválido, kind ajeno y pilas corruptas', () => {
    expect(parseEffectTemplateFile('no json').ok).toBe(false);
    expect(parseEffectTemplateFile('{"kind":"otra-cosa"}').ok).toBe(false);
    expect(
      parseEffectTemplateFile(
        JSON.stringify({
          kind: 'olyvia-effect-template',
          version: 1,
          name: 'X',
          effectKind: 'video',
          stack: [{ effectId: 42 }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseEffectTemplateFile(
        JSON.stringify({
          kind: 'olyvia-effect-template',
          version: 1,
          name: 'X',
          effectKind: 'video',
          stack: [],
        }),
      ).ok,
    ).toBe(false);
  });

  it('al aplicar regenera ids, normaliza params y omite efectos desconocidos', () => {
    const storage = fakeStorage();
    saveEffectTemplate('Mixta', 'video', VIDEO_STACK, storage);
    const [template] = loadEffectTemplates(storage);
    const originalIds = template!.stack.map((entry) => entry.id);

    const { stack, skipped } = stackFromTemplate({
      ...template!,
      stack: [
        ...template!.stack,
        {
          id: 'fantasma-1',
          effectId: 'efecto.que.no.existe',
          enabled: true,
          params: {},
        },
      ],
    });

    expect(skipped).toBe(1);
    expect(stack).toHaveLength(2);
    for (const instance of stack) {
      expect(originalIds).not.toContain(instance.id);
      expect(instance.effectId).toBe('color.exposure');
    }
  });

  it('tolera storage corrupto o ausente', () => {
    const storage = fakeStorage();
    storage.setItem('editor-ia.effect-templates.v1', '{basura');
    expect(loadEffectTemplates(storage)).toEqual([]);
    expect(loadEffectTemplates()).toEqual([]);
  });
});
