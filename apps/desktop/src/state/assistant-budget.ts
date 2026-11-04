/**
 * Preferencias locales del asistente: presupuesto de tokens visible.
 *
 * Es una **estimación** (4 caracteres por token, el mismo criterio que AI Hub)
 * para que la persona vea el tamaño de la conversación antes de mandarla. El
 * límite configurable sólo dispara un aviso; nunca bloquea el envío ni recorta
 * el texto. El valor queda en `localStorage`, no en el proyecto.
 */

export const ASSISTANT_TOKEN_BUDGET_KEY = 'editoria.assistant.token-budget.v1';
export const ASSISTANT_TOKEN_BUDGET_CHANGED_EVENT =
  'editoria:assistant-token-budget-changed';
export const DEFAULT_ASSISTANT_TOKEN_BUDGET = 4_000;
export const MIN_ASSISTANT_TOKEN_BUDGET = 500;
export const MAX_ASSISTANT_TOKEN_BUDGET = 50_000;

/** Estimación grosera y explícita: ~4 caracteres por token. */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

/** Suma la estimación de cada bloque (historial, mensaje actual, etc.). */
export function estimateConversationTokens(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + estimateTokens(text), 0);
}

export function clampAssistantTokenBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ASSISTANT_TOKEN_BUDGET;
  return Math.min(
    MAX_ASSISTANT_TOKEN_BUDGET,
    Math.max(MIN_ASSISTANT_TOKEN_BUDGET, Math.round(value)),
  );
}

export function loadAssistantTokenBudget(): number {
  try {
    const raw = window.localStorage.getItem(ASSISTANT_TOKEN_BUDGET_KEY);
    if (raw === null || raw.trim() === '') return DEFAULT_ASSISTANT_TOKEN_BUDGET;
    return clampAssistantTokenBudget(Number(raw));
  } catch {
    return DEFAULT_ASSISTANT_TOKEN_BUDGET;
  }
}

export function saveAssistantTokenBudget(value: number): number {
  const clamped = clampAssistantTokenBudget(value);
  try {
    window.localStorage.setItem(ASSISTANT_TOKEN_BUDGET_KEY, String(clamped));
  } catch {
    // sin almacenamiento: el valor vive solo en la sesión
  }
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_TOKEN_BUDGET_CHANGED_EVENT, { detail: clamped }),
  );
  return clamped;
}
