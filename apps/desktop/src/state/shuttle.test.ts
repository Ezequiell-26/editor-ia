import { describe, expect, it } from 'vitest';
import {
  IDLE_SHUTTLE,
  SHUTTLE_RATES,
  SHUTTLE_WINDOW_MS,
  resetShuttle,
  shuttleRate,
  shuttleStep,
  type ShuttleState,
} from './shuttle';

function press(state: ShuttleState, direction: 1 | -1, nowMs: number): ShuttleState {
  return shuttleStep(state, direction, nowMs);
}

describe('shuttleStep', () => {
  it('la primera pulsación reproduce a 1× en la dirección pedida', () => {
    const next = press(IDLE_SHUTTLE, -1, 1000);
    expect(next.direction).toBe(-1);
    expect(shuttleRate(next)).toBe(1);
    expect(next.active).toBe(true);
  });

  it('pulsaciones seguidas en la misma dirección escalan 1→2→4→8 y se clavan', () => {
    let state = IDLE_SHUTTLE;
    const rates: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      state = press(state, 1, 1000 + i * 200);
      rates.push(shuttleRate(state));
    }
    expect(rates).toEqual([1, 2, 4, 8, 8, 8]);
  });

  it('una pulsación fuera de ventana reinicia la rampa a 1×', () => {
    let state = IDLE_SHUTTLE;
    for (let i = 0; i < 3; i += 1) {
      state = press(state, 1, 1000 + i * 200);
    }
    expect(shuttleRate(state)).toBe(4);
    const after = press(state, 1, 1000 + 3 * 200 + SHUTTLE_WINDOW_MS + 1);
    expect(shuttleRate(after)).toBe(1);
    expect(after.direction).toBe(1);
  });

  it('el borde exacto de la ventana todavía cuenta como seguida', () => {
    let state = press(IDLE_SHUTTLE, 1, 0);
    state = press(state, 1, SHUTTLE_WINDOW_MS);
    expect(shuttleRate(state)).toBe(2);
  });

  it('alternar L/J invierte el sentido conservando la velocidad acumulada', () => {
    let state = press(IDLE_SHUTTLE, 1, 0);
    state = press(state, 1, 100);
    state = press(state, -1, 200);
    expect(state.direction).toBe(-1);
    expect(shuttleRate(state)).toBe(4);
  });
});

describe('resetShuttle', () => {
  it('devuelve idle cuando la rampa estaba activa', () => {
    const active = press(IDLE_SHUTTLE, 1, 0);
    expect(resetShuttle(active)).toBe(IDLE_SHUTTLE);
  });

  it('no toca el estado si el shuttle nunca se usó', () => {
    expect(resetShuttle(IDLE_SHUTTLE)).toBe(IDLE_SHUTTLE);
  });

  it('las tasas de la rampa nunca superan el tope de SHUTTLE_RATES', () => {
    let state = IDLE_SHUTTLE;
    for (let i = 0; i < 10; i += 1) {
      state = press(state, 1, i * 100);
      expect(shuttleRate(state)).toBeLessThanOrEqual(SHUTTLE_RATES[SHUTTLE_RATES.length - 1] ?? 8);
    }
    expect(shuttleRate(state)).toBe(8);
  });
});
