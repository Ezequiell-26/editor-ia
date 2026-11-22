// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  customSkill,
  deleteCustomSkill,
  loadCustomSkills,
  saveCustomSkill,
  type CustomSkill,
} from './custom-skills';
import { aiSkill, listSkills } from './ai-skills';

function makeSkill(id: string): CustomSkill {
  return {
    id,
    name: `Skill ${id}`,
    summary: 'Resumen',
    category: 'guion',
    target: 'script',
    output: 'guion',
    prompt: 'instrucciones',
    custom: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('custom skills', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('guarda, lista y resuelve skills personalizadas', () => {
    saveCustomSkill(makeSkill('a'));
    saveCustomSkill(makeSkill('b'));
    expect(loadCustomSkills().map((s) => s.id)).toEqual(['b', 'a']);
    expect(customSkill('a')?.name).toBe('Skill a');
    expect(aiSkill('a')?.name).toBe('Skill a');
    expect(listSkills().some((s) => s.id === 'a')).toBe(true);
  });

  it('las built-in ganan ante ids duplicados y se pueden borrar', () => {
    saveCustomSkill(makeSkill('hook-3s'));
    expect(aiSkill('hook-3s')?.name).toBe('Gancho de 3 segundos');
    deleteCustomSkill('hook-3s');
    expect(loadCustomSkills()).toHaveLength(0);
  });

  it('tolera storage corrupto o inválido', () => {
    localStorage.setItem('editoria.aihub.custom-skills.v1', '{no json');
    expect(loadCustomSkills()).toEqual([]);
    localStorage.setItem(
      'editoria.aihub.custom-skills.v1',
      JSON.stringify([{ id: 'x' }, 'basura', makeSkill('ok')]),
    );
    expect(loadCustomSkills().map((s) => s.id)).toEqual(['ok']);
  });
});
