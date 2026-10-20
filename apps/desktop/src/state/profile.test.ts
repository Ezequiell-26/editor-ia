import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  PROFILE_STORAGE_KEY,
  initialsOf,
  loadProfile,
  normalizeProfile,
  saveProfile,
} from './profile';

const AVATAR =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ISP/2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';

describe('perfil local', () => {
  it('normaliza nombre, rol y avatar', () => {
    const profile = normalizeProfile({
      name: '  Ana  ',
      role: '  Editora  ',
      avatar: AVATAR,
    });
    expect(profile.name).toBe('Ana');
    expect(profile.role).toBe('Editora');
    expect(profile.avatar).toBe(AVATAR);
  });

  it('rechaza avatares que no son imágenes o son enormes', () => {
    expect(normalizeProfile({ avatar: 'https://example.com/a.png' }).avatar).toBeNull();
    expect(normalizeProfile({ avatar: 'data:text/html;base64,abc' }).avatar).toBeNull();
    expect(normalizeProfile({ avatar: `data:image/png;base64,${'A'.repeat(1_600_000)}` }).avatar).toBeNull();
  });

  it('calcula iniciales legibles', () => {
    expect(initialsOf('Ana Pérez')).toBe('AP');
    expect(initialsOf('  ')).toBe('IA');
    expect(initialsOf('Editor')).toBe('E');
  });

  it('guarda y recupera sólo desde el almacenamiento local', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    saveProfile({ ...DEFAULT_PROFILE, name: 'Ana', avatar: AVATAR }, storage);
    expect(store.has(PROFILE_STORAGE_KEY)).toBe(true);
    expect(loadProfile(storage)).toMatchObject({ name: 'Ana', avatar: AVATAR });
    expect(loadProfile({ getItem: () => '{roto' })).toEqual(DEFAULT_PROFILE);
  });
});
