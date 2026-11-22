// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addAiMemory,
  aiMemoryContext,
  clearAiMemory,
  forgetAiMemory,
  loadAiMemory,
} from './ai-memory';

describe('ai memory', () => {
  beforeEach(() => localStorage.clear());

  it('guarda, lista y olvida notas', () => {
    addAiMemory('  el usuario prefiere cortes secos  ');
    addAiMemory('estilo: documental');
    const notes = loadAiMemory();
    expect(notes).toHaveLength(2);
    expect(notes[0]!.text).toBe('estilo: documental');
    forgetAiMemory(notes[0]!.id);
    expect(loadAiMemory()).toHaveLength(1);
    clearAiMemory();
    expect(loadAiMemory()).toEqual([]);
  });

  it('inyecta contexto acotado y tolera storage corrupto', () => {
    addAiMemory('nota uno');
    const ctx = aiMemoryContext();
    expect(ctx).toContain('nota uno');
    expect(ctx.startsWith('- ')).toBe(true);
    localStorage.setItem('editoria.ai-memory.v1', '{roto');
    expect(loadAiMemory()).toEqual([]);
    expect(aiMemoryContext()).toBe('');
  });
});
