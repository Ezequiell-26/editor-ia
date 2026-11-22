/**
 * Memoria libre de la IA: notas persistentes en localStorage que el
 * asistente recibe como contexto y que el propio agente puede escribir
 * vía tools MCP (`memory_add`, `memory_list`, `memory_forget`).
 *
 * A diferencia de la memoria del Director (calibración medida de
 * exports), esto es memoria declarativa: preferencias del usuario,
 * decisiones de estilo, datos del proyecto que deben sobrevivir sesiones.
 * Cada nota es texto plano acotado; no ejecuta nada.
 */

export interface AiMemoryNote {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
}

const STORAGE_KEY = 'editoria.ai-memory.v1';
const MAX_NOTES = 200;
const MAX_NOTE_CHARS = 2000;
const CONTEXT_NOTES = 20;
const CONTEXT_CHARS = 3000;

function sanitize(raw: unknown): AiMemoryNote | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!id || !text) return null;
  return {
    id,
    text: text.slice(0, MAX_NOTE_CHARS),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

export function loadAiMemory(): AiMemoryNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitize)
      .filter((note): note is AiMemoryNote => note !== null)
      .slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

function persist(notes: readonly AiMemoryNote[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Sin almacenamiento: la memoria vive sólo en la sesión.
  }
}

export function addAiMemory(text: string): AiMemoryNote[] {
  const trimmed = text.trim().slice(0, MAX_NOTE_CHARS);
  if (!trimmed) return loadAiMemory();
  const notes = [
    {
      id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      createdAt: new Date().toISOString(),
    },
    ...loadAiMemory(),
  ].slice(0, MAX_NOTES);
  persist(notes);
  return notes;
}

export function forgetAiMemory(id: string): AiMemoryNote[] {
  const notes = loadAiMemory().filter((note) => note.id !== id);
  persist(notes);
  return notes;
}

export function clearAiMemory(): AiMemoryNote[] {
  persist([]);
  return [];
}

/**
 * Bloque compacto para el contexto del asistente: las notas más recientes
 * que entran en el presupuesto de caracteres. Devuelve '' si no hay nada.
 */
export function aiMemoryContext(): string {
  const notes = loadAiMemory().slice(0, CONTEXT_NOTES);
  if (notes.length === 0) return '';
  let out = '';
  for (const note of notes) {
    const line = `- ${note.text}`;
    if (out.length + line.length + 1 > CONTEXT_CHARS) break;
    out += `${line}\n`;
  }
  return out.trimEnd();
}
