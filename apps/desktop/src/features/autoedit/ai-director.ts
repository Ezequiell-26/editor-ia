import type { AssistantMessage } from '../../services/project-service';
import type { AutoEditVariant } from './auto-edit';

/**
 * Dirección asistida por IA.
 *
 * El motor determinista decide **qué** cortes existen (ya medidos con FFmpeg).
 * La IA sólo opina sobre el orden, el título y el gancho. Si no hay proveedor,
 * si la respuesta no es JSON válido o si el proveedor es simulado, la vista se
 * queda con el orden medido y lo dice: nunca se inventa una propuesta.
 */

export interface DirectorProposal {
  /** Título corto para el montaje, sin comillas ni markdown. */
  readonly title: string;
  /** Frase de apertura sugerida (lo que se dice o se muestra al inicio). */
  readonly hook: string;
  /** Por qué ese orden funciona, en una o dos frases. */
  readonly notes: string;
  /** Orden propuesto de los cortes, por índice. */
  readonly order: readonly number[];
  readonly model: string;
}

export interface DirectorRequest {
  readonly messages: readonly AssistantMessage[];
  readonly approvedCost: boolean;
}

const MAX_TITLE = 80;
const MAX_HOOK = 180;
const MAX_NOTES = 400;

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function seconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Resumen compacto del material y de la variante elegida. Se mantiene corto a
 * propósito: el modelo sólo necesita poder juzgar el orden, no re-analizar el
 * video.
 */
export function buildDirectorBrief(
  variant: AutoEditVariant,
  sourceLabels: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`Montaje: ${variant.name} (${variant.style})`);
  lines.push(
    `Duración ${seconds(variant.durationSeconds)} · ${variant.cuts.length} cortes · interés medio ${variant.score}/100`,
  );
  if (sourceLabels.length > 0) {
    lines.push(`Material: ${sourceLabels.join(', ')}`);
  }
  lines.push('Cortes (índice · tramo · interés · motivo):');
  for (const [index, cut] of variant.cuts.entries()) {
    lines.push(
      `${index} · ${cut.startSeconds.toFixed(1)}s–${cut.endSeconds.toFixed(1)}s · ${cut.score} · ${cut.reason}`,
    );
  }
  const spoken = variant.captions
    .map((caption) => caption.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (spoken.length > 0) {
    lines.push(`Texto disponible: ${spoken.join(' / ').slice(0, 600)}`);
  } else {
    lines.push('Texto disponible: ninguno (montaje sin voz medida).');
  }
  return lines.join('\n');
}

/** Mensajes listos para `assistantChat`. */
export function buildDirectorMessages(
  variant: AutoEditVariant,
  sourceLabels: readonly string[],
): readonly AssistantMessage[] {
  const system = [
    'Sos el director de montaje de Olyvia.',
    'Recibís cortes ya medidos de un video (tramos, interés y motivo) y tenés que proponer un orden.',
    'No inventes cortes nuevos, no cambies los tiempos y no agregues material que no esté en la lista.',
    'Priorizá que el primer corte enganche en menos de 2 segundos y que el interés no caiga en picada.',
    'Devolvés SOLO JSON válido, sin markdown ni explicación:',
    '{"title": string (máx 60), "hook": string (máx 120), "notes": string (máx 240), "order": [entero,...]}',
    'El array "order" tiene exactamente un índice por corte, sin repetir, entre 0 y (cantidad de cortes - 1).',
  ].join(' ');
  const brief = buildDirectorBrief(variant, sourceLabels);
  return [
    { role: 'assistant', content: system },
    { role: 'user', content: brief },
  ];
}

/**
 * Extrae el objeto JSON de una respuesta que puede venir con texto alrededor.
 * Devuelve `null` si no hay nada parseable.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const attempts: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  attempts.push(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(trimmed.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Se prueba el siguiente recorte.
    }
  }
  return null;
}

/**
 * Valida la propuesta contra la variante real. Cualquier índice fuera de rango
 * o repetido invalida la propuesta completa: es preferible descartarla antes
 * que aplicar un orden a medias.
 */
export function parseDirectorProposal(
  reply: string,
  variant: AutoEditVariant,
  model: string,
): DirectorProposal | null {
  const object = extractJsonObject(reply);
  if (!object) return null;
  const title = clean(object.title, MAX_TITLE);
  const hook = clean(object.hook, MAX_HOOK);
  const notes = clean(object.notes, MAX_NOTES);
  const rawOrder = object.order;
  if (!Array.isArray(rawOrder)) return null;
  const count = variant.cuts.length;
  if (rawOrder.length !== count) return null;
  const order: number[] = [];
  const seen = new Set<number>();
  for (const value of rawOrder) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < 0 || value >= count) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    order.push(value);
  }
  if (order.length !== count) return null;
  return {
    title: title || 'Montaje sugerido',
    hook,
    notes,
    order,
    model,
  };
}
