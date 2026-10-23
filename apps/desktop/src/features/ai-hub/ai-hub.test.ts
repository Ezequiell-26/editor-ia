import { describe, expect, it } from 'vitest';
import {
  AI_BRIEF_LIMIT,
  AI_SKILLS,
  aiSkill,
  briefProblem,
  briefTokens,
  categoryLabel,
  composeSkillPrompt,
} from './ai-hub';

const brief = 'Un video corto sobre cómo ordenar una timeline sin perder tomas.';

describe('AI Hub skills', () => {
  it('ofrece skills únicas, con contrato y vista de destino', () => {
    const ids = AI_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AI_SKILLS.length).toBeGreaterThanOrEqual(8);
    for (const skill of AI_SKILLS) {
      expect(skill.output.length).toBeGreaterThan(4);
      expect(skill.prompt.length).toBeGreaterThan(40);
      expect(skill.target).toBeTruthy();
      expect(categoryLabel(skill.category)).toBeTruthy();
    }
    expect(aiSkill('hook-3s')?.name).toBe('Gancho de 3 segundos');
    expect(aiSkill('no-existe')).toBeNull();
  });

  it('compone un pedido acotado con el brief y el contrato al final', () => {
    const skill = AI_SKILLS[0]!;
    const composed = composeSkillPrompt(skill, `  ${brief}  `);
    expect(composed.prompt).toContain(skill.name);
    expect(composed.prompt).toContain(brief);
    expect(composed.prompt.indexOf('SALIDA:')).toBeGreaterThan(composed.prompt.indexOf('CONTEXTO:'));
    expect(composed.characters).toBe(composed.prompt.length);
    expect(composed.estimatedTokens).toBe(Math.ceil(composed.characters / 4));
    expect(composed.tooLong).toBe(false);
  });

  it('marca el exceso de contexto en vez de recortar en silencio', () => {
    const long = 'x'.repeat(AI_BRIEF_LIMIT + 1);
    const composed = composeSkillPrompt(AI_SKILLS[0]!, long);
    expect(composed.tooLong).toBe(true);
    expect(composed.prompt).toContain(long);
    expect(briefProblem(long)).toMatch(/supera/i);
    expect(briefProblem('')).toBeNull();
    expect(briefProblem('corto')).toMatch(/al menos 10/i);
    expect(briefProblem(brief)).toBeNull();
    expect(briefTokens('')).toBe(0);
    expect(briefTokens('12345')).toBe(2);
  });
});
