import { beforeEach, describe, expect, it } from 'vitest';
import { effectRegistry } from '@editor-ia/effect-kit';
import {
  importCustomEffectPackage,
  removeCustomEffect,
  restoreCustomEffects,
} from './custom-effects';

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

const PACKAGE = JSON.stringify({
  manifest: {
    id: 'test_glow',
    name: 'Glow Test',
    category: 'light',
    kind: 'video',
    params: [{ id: 'intensity', label: 'Intensidad', type: 'float', min: 0, max: 1, default: 0.5 }],
    gpu: {
      passes: [
        {
          shader: 'void main() { fragColor = texture(u_currentTexture, v_texCoord); }',
        },
      ],
    },
  },
});

let store: Storage;

beforeEach(() => {
  store = fakeStorage();
  restoreCustomEffects(true, store);
});

describe('custom-effects', () => {
  it('importa, registra y persiste un paquete válido', () => {
    const result = importCustomEffectPackage(PACKAGE, store);
    expect(result.ok).toBe(true);
    expect(result.name).toBe('Glow Test');
    expect(effectRegistry.get('custom.test_glow')?.name).toBe('Glow Test');

    // Persiste: restaurar desde storage lo vuelve a registrar.
    restoreCustomEffects(true, store);
    expect(effectRegistry.get('custom.test_glow')).toBeTruthy();
  });

  it('rechaza JSON inválido y paquetes que no parsean', () => {
    expect(importCustomEffectPackage('no json', store).ok).toBe(false);
    expect(importCustomEffectPackage('{"foo":1}', store).ok).toBe(false);
    expect(effectRegistry.get('custom.test_glow')).toBeUndefined();
  });

  it('no duplica el mismo paquete importado dos veces', () => {
    importCustomEffectPackage(PACKAGE, store);
    importCustomEffectPackage(PACKAGE, store);
    restoreCustomEffects(true, store);
    expect(effectRegistry.get('custom.test_glow')).toBeTruthy();
    const stored = JSON.parse(store.getItem('editor-ia.custom-effects.v1') ?? '[]');
    expect(stored).toHaveLength(1);
  });

  it('removeCustomEffect lo saca del registry y del storage', () => {
    importCustomEffectPackage(PACKAGE, store);
    removeCustomEffect('custom.test_glow', store);
    expect(effectRegistry.get('custom.test_glow')).toBeUndefined();
    restoreCustomEffects(true, store);
    expect(effectRegistry.get('custom.test_glow')).toBeUndefined();
  });
});
