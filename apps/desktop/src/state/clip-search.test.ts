import { describe, expect, it } from 'vitest';
import { matchesClipSearch } from './clip-search';

describe('matchesClipSearch', () => {
  it('acepta todo con una consulta vacía', () => {
    expect(matchesClipSearch(['Intro'], '')).toBe(true);
    expect(matchesClipSearch(['Intro'], '   ')).toBe(true);
  });

  it('busca sin distinguir mayúsculas y en cualquier campo', () => {
    expect(matchesClipSearch(['Intro', 'V1'], 'intro')).toBe(true);
    expect(matchesClipSearch(['Intro', 'V1'], 'v1')).toBe(true);
    expect(matchesClipSearch([undefined, 'Toma de prueba'], 'TOMA')).toBe(true);
    expect(matchesClipSearch(['Intro', 'V1'], 'cierre')).toBe(false);
  });
});
