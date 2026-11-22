// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getAiMode, getAiOnly, setAiMode, setAiOnly, toggleAiMode } from './ai-mode';

describe('ai-mode', () => {
  afterEach(() => {
    setAiOnly(false);
    setAiMode(false);
    window.localStorage.clear();
  });

  it('arranca apagado y alterna el estado', () => {
    expect(getAiMode()).toBe(false);
    toggleAiMode();
    expect(getAiMode()).toBe(true);
    toggleAiMode();
    expect(getAiMode()).toBe(false);
  });

  it('persiste la elección en localStorage', () => {
    setAiMode(true);
    expect(getAiMode()).toBe(true);
    expect(window.localStorage.getItem('editoria.ai-mode.v1')).toBe('1');
    setAiMode(false);
    expect(window.localStorage.getItem('editoria.ai-mode.v1')).toBe('0');
  });

  it('setAiMode con el mismo valor no re-emite ni reescribe', () => {
    setAiMode(false);
    // Ya estaba en false: la escritura es idempotente y no rompe nada.
    setAiMode(false);
    expect(getAiMode()).toBe(false);
    expect(window.localStorage.getItem('editoria.ai-mode.v1')).toBeNull();
  });

  it('ai-only persiste y fuerza la vista reducida aunque el toggle viejo esté apagado', () => {
    expect(getAiOnly()).toBe(false); // default de tests; la app real nace en true
    setAiMode(false);
    setAiOnly(true);
    expect(getAiOnly()).toBe(true);
    expect(getAiMode()).toBe(true);
    expect(window.localStorage.getItem('editoria.ai-only.v1')).toBe('1');

    setAiOnly(false);
    expect(getAiMode()).toBe(false);
    expect(window.localStorage.getItem('editoria.ai-only.v1')).toBe('0');
  });
});
