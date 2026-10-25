import { describe, expect, it } from 'vitest';
import { hasEmoji, insertEmoji } from './emoji';

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
