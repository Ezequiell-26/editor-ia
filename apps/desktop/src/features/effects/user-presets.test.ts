import { describe, expect, it } from 'vitest';
import { ClipEffectsSchema, type ClipEffects } from '@editor-ia/project-schema';
import {
  USER_PRESETS_KEY,
  addUserPreset,
  duplicateUserPreset,
  loadUserPresets,
  removeUserPreset,
  saveUserPresets,
  type UserEffectPreset,
} from './user-presets';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const effects = { contrast: 1.2, vignette: 0.2 } as ClipEffects;

describe('user effect presets', () => {
  it('starts empty and rejects invalid stored data', () => {
    expect(loadUserPresets(memoryStorage())).toEqual([]);
    expect(
      loadUserPresets(memoryStorage({ [USER_PRESETS_KEY]: '{broken' })),
    ).toEqual([]);
    expect(
      loadUserPresets(
        memoryStorage({
          [USER_PRESETS_KEY]: JSON.stringify([
            { id: 'x', name: 'Malo', effects: { contrast: 99 }, createdAt: '2026-01-01' },
          ]),
        }),
      ),
    ).toEqual([]);
  });

  it('adds presets newest first, trims the name and caps the list', () => {
    let list: UserEffectPreset[] = [];
    for (let index = 0; index < 22; index += 1) {
      list = addUserPreset(list, `  Look ${index}  `, effects);
    }
    expect(list).toHaveLength(20);
    expect(list[0]?.name).toBe('Look 21');
    expect(list[19]?.name).toBe('Look 2');
    expect(ClipEffectsSchema.safeParse(list[0]?.effects).success).toBe(true);
  });

  it('ignores empty names and removes by id', () => {
    expect(addUserPreset([], '   ', effects)).toEqual([]);
    const list = addUserPreset([], 'Cálido', effects);
    expect(removeUserPreset(list, list[0]!.id)).toEqual([]);
  });

  it('duplicates a preset with a new id and a copy suffix', () => {
    const list = addUserPreset([], 'Cálido', effects);
    const duplicated = duplicateUserPreset(list, list[0]!.id);
    expect(duplicated).toHaveLength(2);
    expect(duplicated[0]?.name).toBe('Cálido (copia)');
    expect(duplicated[0]?.id).not.toBe(list[0]?.id);
    expect(duplicated[0]?.effects).toEqual(effects);
    expect(duplicateUserPreset(list, 'missing')).toEqual(list);
  });

  it('persists and reloads the list', () => {
    const storage = memoryStorage();
    const list = addUserPreset([], 'Cálido', effects);
    saveUserPresets(list, storage);
    expect(loadUserPresets(storage)).toHaveLength(1);
    expect(loadUserPresets(storage)[0]?.name).toBe('Cálido');
  });
});
