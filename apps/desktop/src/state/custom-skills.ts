/**
 * Skills personalizadas del usuario: mismo formato que `AI_SKILLS`
 * (`AiSkill`), persistidas en localStorage. Se combinan con la biblioteca
 * en `listSkills()` y `aiSkill()` las resuelve — el AI Hub, el compositor
 * de prompts y cualquier consumidor de `aiSkill` las ven sin cambios.
 *
 * Límites honestos: una skill personalizada es una plantilla de prompt +
 * destino; no ejecuta código propio ni instala nada. El modelo que la
 * corre es el proveedor configurado en Ajustes.
 */

import type { ViewId } from '../app/navigation';
import type { AiSkill, AiSkillCategory } from './ai-skills';

export interface CustomSkill extends AiSkill {
  readonly custom: true;
  readonly createdAt: string;
}

const STORAGE_KEY = 'editoria.aihub.custom-skills.v1';
const MAX_CUSTOM_SKILLS = 50;
const MAX_FIELD = 4000;

/** Respaldo en memoria para contextos sin localStorage (tests, SSR). */
let memoryRaw: string | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isCategory(value: unknown): value is AiSkillCategory {
  return (
    value === 'guion' ||
    value === 'crecimiento' ||
    value === 'produccion' ||
    value === 'localizacion' ||
    value === 'motion'
  );
}

function sanitizeSkill(raw: unknown): CustomSkill | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  const output = typeof item.output === 'string' ? item.output.trim() : '';
  const target = typeof item.target === 'string' ? item.target : '';
  if (
    !id ||
    !name ||
    !summary ||
    !prompt ||
    !output ||
    !isCategory(item.category) ||
    item.custom !== true
  ) {
    return null;
  }
  return {
    id,
    name: name.slice(0, 200),
    summary: summary.slice(0, MAX_FIELD),
    category: item.category,
    target: target as ViewId,
    output: output.slice(0, 200),
    prompt: prompt.slice(0, MAX_FIELD),
    custom: true,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

export function loadCustomSkills(): CustomSkill[] {
  try {
    const store = storage();
    const raw = store ? store.getItem(STORAGE_KEY) : memoryRaw;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSkill)
      .filter((skill): skill is CustomSkill => skill !== null)
      .slice(0, MAX_CUSTOM_SKILLS);
  } catch {
    return [];
  }
}

function persist(skills: readonly CustomSkill[]): void {
  const serialized = JSON.stringify(skills);
  const store = storage();
  if (!store) {
    memoryRaw = serialized;
    return;
  }
  try {
    store.setItem(STORAGE_KEY, serialized);
  } catch {
    // Sin almacenamiento: las skills viven sólo en memoria de la sesión.
    memoryRaw = serialized;
  }
}

export function saveCustomSkill(skill: CustomSkill): CustomSkill[] {
  const skills = loadCustomSkills().filter((item) => item.id !== skill.id);
  skills.unshift(skill);
  const trimmed = skills.slice(0, MAX_CUSTOM_SKILLS);
  persist(trimmed);
  return trimmed;
}

export function deleteCustomSkill(id: string): CustomSkill[] {
  const skills = loadCustomSkills().filter((item) => item.id !== id);
  persist(skills);
  return skills;
}

export function customSkill(id: string): CustomSkill | null {
  return loadCustomSkills().find((skill) => skill.id === id) ?? null;
}
