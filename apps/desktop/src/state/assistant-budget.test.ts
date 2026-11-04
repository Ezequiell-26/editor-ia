// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ASSISTANT_TOKEN_BUDGET_KEY,
  DEFAULT_ASSISTANT_TOKEN_BUDGET,
  MAX_ASSISTANT_TOKEN_BUDGET,
  MIN_ASSISTANT_TOKEN_BUDGET,
  clampAssistantTokenBudget,
  estimateConversationTokens,
  estimateTokens,
  loadAssistantTokenBudget,
  saveAssistantTokenBudget,
} from './assistant-budget';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('estimación de tokens del asistente', () => {
  it('estima ~4 caracteres por token y el vacío como 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
    expect(estimateTokens('hola')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('  hola mundo  ')).toBe(3);
  });

  it('suma historial y mensaje actual', () => {
    expect(estimateConversationTokens(['a'.repeat(40), 'b'.repeat(80), ''])).toBe(30);
  });
});

describe('presupuesto configurable del asistente', () => {
  it('usa el default cuando no hay valor guardado', () => {
    expect(loadAssistantTokenBudget()).toBe(DEFAULT_ASSISTANT_TOKEN_BUDGET);
    expect(window.localStorage.getItem(ASSISTANT_TOKEN_BUDGET_KEY)).toBeNull();
  });

  it('guarda y vuelve a leer el valor con límites', () => {
    expect(saveAssistantTokenBudget(6_500)).toBe(6_500);
    expect(loadAssistantTokenBudget()).toBe(6_500);
    expect(window.localStorage.getItem(ASSISTANT_TOKEN_BUDGET_KEY)).toBe('6500');
  });

  it('clampea valores fuera de rango o inválidos', () => {
    expect(clampAssistantTokenBudget(10)).toBe(MIN_ASSISTANT_TOKEN_BUDGET);
    expect(clampAssistantTokenBudget(999_999)).toBe(MAX_ASSISTANT_TOKEN_BUDGET);
    expect(clampAssistantTokenBudget(Number.NaN)).toBe(DEFAULT_ASSISTANT_TOKEN_BUDGET);
    expect(saveAssistantTokenBudget(10)).toBe(MIN_ASSISTANT_TOKEN_BUDGET);
  });

  it('tolera valores guardados corruptos', () => {
    window.localStorage.setItem(ASSISTANT_TOKEN_BUDGET_KEY, 'no-es-un-numero');
    expect(loadAssistantTokenBudget()).toBe(DEFAULT_ASSISTANT_TOKEN_BUDGET);
  });

  it('avisa a los suscriptores al guardar', () => {
    const events: number[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<number>).detail);
    };
    window.addEventListener('editoria:assistant-token-budget-changed', listener);
    try {
      saveAssistantTokenBudget(3_000);
    } finally {
      window.removeEventListener('editoria:assistant-token-budget-changed', listener);
    }
    expect(events).toEqual([3_000]);
  });
});
