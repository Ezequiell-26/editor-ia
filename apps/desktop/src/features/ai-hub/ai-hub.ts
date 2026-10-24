import type { ViewId } from '../../app/navigation';

export type AiSkillCategory =
  | 'guion'
  | 'crecimiento'
  | 'produccion'
  | 'localizacion'
  | 'motion';

export interface AiSkill {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly category: AiSkillCategory;
  readonly target: ViewId;
  readonly output: string;
  readonly prompt: string;
}

/**
 * Skills locales: no llaman a un modelo por sí solas. Componen un pedido
 * compacto con contrato de salida para que el proveedor configurado gaste
 * menos tokens y devuelva algo que la app pueda usar.
 */
export const AI_SKILLS: readonly AiSkill[] = [
  {
    id: 'hook-3s',
    name: 'Gancho de 3 segundos',
    summary: 'Abre con una tensión concreta, sin introducción ni saludo.',
    category: 'guion',
    target: 'script',
    output: 'JSON con "hook", "promise" y "visual"',
    prompt:
      'Escribí un gancho de 3 segundos para el brief. Una sola idea, presente, sin saludo ni contexto previo. Devolvé JSON: {"hook": string, "promise": string, "visual": string}. El hook debe poder decirse en voz alta en menos de 12 palabras.',
  },
  {
    id: 'short-30-60',
    name: 'Short de 30–60 s',
    summary: 'Estructura compacta: hook, desarrollo, prueba y cierre.',
    category: 'guion',
    target: 'script',
    output: 'JSON con escenas y narración',
    prompt:
      'Convertí el brief en un short de 30 a 60 segundos. Estructura: hook (0–3 s), contexto mínimo, demostración concreta, prueba y cierre. Devolvé JSON: {"title": string, "scenes": [{"title": string, "narration": string, "visual": string, "estimatedSeconds": number}]}. Sin acotaciones ni explicaciones; la narración debe leerse en voz alta.',
  },
  {
    id: 'retention-audit',
    name: 'Auditoría de retención',
    summary: 'Detecta relleno, promesas tardías y cortes que pierden al espectador.',
    category: 'crecimiento',
    target: 'script',
    output: 'Lista priorizada de cambios',
    prompt:
      'Auditá el brief o guion con criterio de retención. Marcá: promesa que tarda demasiado, relleno, explicación sin ejemplo, prueba ausente y cierre sin acción. Devolvé JSON: {"score": number, "findings": [{"problem": string, "fix": string, "impact": "alto"|"medio"|"bajo"}]}. No inventes métricas ni prometas resultados.',
  },
  {
    id: 'policy-safe',
    name: 'Reescritura segura',
    summary: 'Quita afirmaciones absolutas y evita riesgos de monetización.',
    category: 'crecimiento',
    target: 'script',
    output: 'Texto reescrito y cambios explicados',
    prompt:
      'Reescribí el texto para reducir riesgo de rechazo o strike sin cambiar el mensaje central. Eliminá garantías absolutas, promesas de resultados, testimonios inventados y lenguaje que induzca a error. Devolvé JSON: {"rewritten": string, "changes": [string], "remainingRisks": [string]}. Aclaración final de una línea: esto no es asesoramiento legal.',
  },
  {
    id: 'titles-thumbnails',
    name: 'Título + texto de miniatura',
    summary: 'Tres variantes legibles en el feed, sin clickbait engañoso.',
    category: 'crecimiento',
    target: 'thumbnails',
    output: 'JSON con tres variantes cortas',
    prompt:
      'Proponé tres títulos y tres textos de miniatura para el brief. Máximo 60 caracteres por título y 4 palabras por texto de miniatura. Sin promesas falsas ni mayúsculas gritadas. Devolvé JSON: {"variants": [{"title": string, "thumbnail": string, "reason": string}]}.',
  },
  {
    id: 'translate-context',
    name: 'Contexto para traducir',
    summary: 'Prepara un glosario y un tono antes de usar Localización.',
    category: 'localizacion',
    target: 'localization',
    output: 'Glosario y nota de tono',
    prompt:
      'A partir del brief, armá un contexto compacto para traducir subtítulos: tono, público, términos que no se traducen y modismos que conviene evitar. Devolvé JSON: {"tone": string, "audience": string, "glossary": [string], "avoid": [string]}. No traduzcas el texto completo.',
  },
  {
    id: 'description-tags',
    name: 'Descripción y capítulos',
    summary: 'Metadatos listos para publicar, sin relleno.',
    category: 'produccion',
    target: 'script',
    output: 'Descripción, capítulos y tags',
    prompt:
      'Escribí metadatos para el brief. Devolvé JSON: {"description": string, "chapters": [{"title": string, "at": string}], "tags": [string], "pinnedComment": string}. La descripción debe ser específica y breve; los capítulos sólo si el brief tiene estructura temporal; los tags sin spam.',
  },
  {
    id: 'broll-plan',
    name: 'Plan de B-roll',
    summary: 'Qué mostrar en pantalla, con material propio y sin stock.',
    category: 'produccion',
    target: 'production',
    output: 'Lista de planos por escena',
    prompt:
      'Proponé un plan de B-roll para el brief usando material propio o grabaciones simples, sin stock ni imágenes externas. Para cada escena indicá qué se ve, por qué apoya la narración y una alternativa si no hay material. Devolvé JSON: {"shots": [{"scene": string, "visual": string, "purpose": string, "fallback": string}]}.',
  },
  {
    id: 'voice-brief',
    name: 'Brief de voz y ritmo',
    summary: 'Indicaciones para una narración natural y medible.',
    category: 'produccion',
    target: 'production',
    output: 'Indicaciones de voz por escena',
    prompt:
      'Prepará indicaciones de voz para el brief: ritmo, pausas, énfasis y actitud por escena, sin acotaciones actorales excesivas. Devolvé JSON: {"voice": string, "scenes": [{"scene": string, "delivery": string, "pauseAfter": number}]}. Mantené cada indicación en una línea.',
  },
  {
    id: 'motion-brief',
    name: 'Motion graphics',
    summary: 'Elegí una plantilla y props listas para el estudio Motion.',
    category: 'motion',
    target: 'motion',
    output: 'JSON con templateId, props y durationSeconds',
    prompt:
      'Elegí una plantilla de motion graphics para el brief. Plantillas disponibles: title-card (título/subtítulo/fondo/acento), lower-third (nombre/rol/acento), end-card (título/CTA/fondo/acento) y stat-callout (valor/etiqueta/acento). Devolvé JSON: {"templateId": string, "props": object, "durationSeconds": number, "reason": string}. Usá sólo las props documentadas, textos breves y colores #rrggbb. No inventes campos ni rutas.',
  },
];

export function aiSkill(id: string): AiSkill | null {
  return AI_SKILLS.find((skill) => skill.id === id) ?? null;
}

export const AI_BRIEF_LIMIT = 4_000;

export interface ComposedPrompt {
  readonly prompt: string;
  readonly characters: number;
  readonly estimatedTokens: number;
  readonly tooLong: boolean;
}

/**
 * Compone un pedido autocontenido y acotado. El contrato de salida va al final,
 * donde los modelos suelen respetarlo mejor; el brief nunca se recorta en
 * silencio: si se pasa del límite, la UI lo muestra y no deja enviarlo.
 */
export function composeSkillPrompt(
  skill: AiSkill,
  brief: string,
  briefLimit = AI_BRIEF_LIMIT,
): ComposedPrompt {
  const clean = brief.replace(/\s+/g, ' ').trim();
  const header = `SKILL: ${skill.name}\nOBJETIVO: ${skill.summary}`;
  const footer = `SALIDA: ${skill.output}. Devolvé sólo lo pedido, sin markdown ni explicaciones adicionales. No inventes datos: si falta un dato imprescindible, pedilo en una sola línea.`;
  const prompt = `${header}\n\nCONTEXTO:\n${clean}\n\n${footer}`;
  const characters = prompt.length;
  return {
    prompt,
    characters,
    estimatedTokens: Math.max(1, Math.ceil(characters / 4)),
    tooLong: clean.length > briefLimit,
  };
}

export function briefTokens(brief: string): number {
  const clean = brief.trim();
  return clean ? Math.max(1, Math.ceil(clean.length / 4)) : 0;
}

export function briefProblem(brief: string): string | null {
  const clean = brief.trim();
  // Vacío no es un error todavía: el usuario recién abrió la vista.
  if (!clean) return null;
  if (clean.length < 10) return 'Describí el video con al menos 10 caracteres.';
  if (clean.length > AI_BRIEF_LIMIT) {
    return `El brief supera los ${AI_BRIEF_LIMIT.toLocaleString('es-AR')} caracteres; recortalo para no gastar contexto de más.`;
  }
  return null;
}

export function categoryLabel(category: AiSkillCategory): string {
  return {
    guion: 'Guion',
    crecimiento: 'Crecimiento',
    produccion: 'Producción',
    localizacion: 'Localización',
    motion: 'Motion',
  }[category];
}
