import { describe, expect, it } from 'vitest';
import { renderOutputFileName, segmentOutputFileName } from './render-output';

const AT = new Date(2026, 9, 31, 8, 5, 9, 42);

describe('nombre de salida del render del agente', () => {
  it('usa el nombre del proyecto, el perfil y un sello determinista', () => {
    expect(renderOutputFileName('Mi Proyecto', 'profile-1', AT)).toBe(
      'Mi-Proyecto-profile-1-20261031-080509042.mp4',
    );
  });

  it('sanea caracteres inválidos y no deja separadores', () => {
    const name = renderOutputFileName('a/b\\c:d*e?f"g<h>i|j', null, AT);
    expect(name).toBe('abcdefghij-20261031-080509042.mp4');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('quita acentos combinados y guiones finales del perfil', () => {
    expect(renderOutputFileName('Edición en vivo', 'abc-', AT)).toBe(
      'Edicion-en-vivo-abc-20261031-080509042.mp4',
    );
  });

  it('cae a un nombre seguro cuando el proyecto no tiene caracteres útiles', () => {
    expect(renderOutputFileName('///', null, AT)).toBe('olyvia-20261031-080509042.mp4');
  });

  it('recorta nombres largos sin perder la extensión', () => {
    const name = renderOutputFileName('x'.repeat(200), 'p'.repeat(80), AT);
    expect(name.length).toBeLessThan(120);
    expect(name.endsWith('.mp4')).toBe(true);
  });

  it('genera un nombre estable por escena y revisión para reanudar', () => {
    expect(segmentOutputFileName('Integral agente', 'abc-123-def', 7)).toBe(
      'Integral-agente-escena-abc-123-def-r7.mp4',
    );
  });
});
