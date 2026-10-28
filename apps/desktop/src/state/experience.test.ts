import { describe, expect, it } from 'vitest';
import { NAV_VIEWS } from '../app/navigation';
import {
  DEFAULT_EXPERIENCE_MODE,
  filterViewsForMode,
  isExperienceMode,
  loadExperienceMode,
  saveExperienceMode,
  type ExperienceMode,
} from './experience';

describe('modo de uso (guiado / pro)', () => {
  it('por defecto es pro: cero regresión para quien ya usa la app', () => {
    expect(DEFAULT_EXPERIENCE_MODE).toBe('pro');
    expect(loadExperienceMode({ getItem: () => null })).toBe('pro');
  });

  it('en modo pro el rail queda intacto', () => {
    expect(filterViewsForMode(NAV_VIEWS, 'pro')).toEqual(NAV_VIEWS);
  });

  it('el modo guiado esconde las superficies de especialistas y conserva la ruta', () => {
    const guided = filterViewsForMode(NAV_VIEWS, 'guiada');
    const ids = guided.map((view) => view.id);
    for (const id of ['home', 'projects', 'editor', 'download', 'creator']) {
      expect(ids).toContain(id);
    }
    for (const id of ['lab', 'production']) {
      expect(ids).not.toContain(id);
    }
  });

  it('valida el modo guardado y tolera almacenamiento roto', () => {
    expect(isExperienceMode('guiada')).toBe(true);
    expect(isExperienceMode('pro')).toBe(true);
    expect(isExperienceMode('avanzado')).toBe(false);
    expect(loadExperienceMode({ getItem: () => 'guiada' })).toBe('guiada');
    expect(loadExperienceMode({ getItem: () => 'otra cosa' })).toBe('pro');
    expect(loadExperienceMode({ getItem: () => '{roto' })).toBe('pro');
    expect(loadExperienceMode(null)).toBe('pro');
  });

  it('guarda el modo elegido', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    saveExperienceMode('guiada' as ExperienceMode, adapter);
    expect(storage.get('editor-ia.experience.v1')).toBe('guiada');
    expect(loadExperienceMode(adapter)).toBe('guiada');
  });
});
