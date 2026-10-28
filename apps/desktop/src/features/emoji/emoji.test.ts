import { describe, expect, it } from 'vitest';
import { hasEmoji, insertEmoji } from './emoji';
import { findEmoji } from './emoji-data';
import { SPANISH_TOTAL, spanishName } from './emoji-es';

describe('inserción de emojis', () => {
  it('inserta en el cursor y conserva el resto', () => {
    expect(insertEmoji('Hola mundo', '🚀', 4, 4)).toEqual({
      value: 'Hola🚀 mundo',
      cursor: 6,
    });
  });

  it('reemplaza la selección y acota índices inválidos', () => {
    expect(insertEmoji('Hola mundo', '😀', 5, 10)).toEqual({
      value: 'Hola 😀',
      cursor: 7,
    });
    expect(insertEmoji('abc', '✨', 99, 120)).toEqual({ value: 'abc✨', cursor: 4 });
    expect(insertEmoji('abc', '✨', -4, -1)).toEqual({ value: '✨abc', cursor: 1 });
  });

  it('detecta emojis y no confunde texto normal', () => {
    expect(hasEmoji('Hola 😀')).toBe(true);
    expect(hasEmoji('Bandera 🏳️‍🌈')).toBe(true);
    expect(hasEmoji('Hola mundo')).toBe(false);
    expect(hasEmoji('Números 123')).toBe(false);
  });
});

describe('búsqueda en español', () => {
  it('encuentra emojis por su nombre en español', () => {
    // "cara" sólo aparece en las etiquetas en español: en inglés son "face".
    const caras = findEmoji('cara');
    expect(caras.length).toBeGreaterThan(5);
    expect(caras.some((entry) => entry.emoji === '😀')).toBe(true);
  });

  it('sigue encontrando por el nombre en inglés', () => {
    const faces = findEmoji('grinning');
    expect(faces.some((entry) => entry.emoji === '😀')).toBe(true);
  });

  it('el catálogo en español cubre casi dos mil emojis base', () => {
    // El conjunto compacto trae los emojis base (sin variantes de tono).
    expect(SPANISH_TOTAL).toBeGreaterThan(1500);
    expect(spanishName('😀')).toBeTruthy();
  });
});
