/**
 * Rampa de velocidad del shuttle (`L`/`J`, como CapCut/Premiere): cada
 * pulsación dentro de la ventana sube un escalón (1× → 2× → 4× → 8×, el tope
 * del clamp de `setPlaybackRate`); una pulsación fuera de ventana vuelve a
 * 1×. La dirección es la de la última tecla: alternar `L`/`J` invierte el
 * sentido conservando la velocidad acumulada.
 *
 * La pausa (`K`, Espacio, frame a frame, inicio/fin) reinicia la rampa sólo
 * cuando la velocidad vigente la fijó el shuttle (`active`): una velocidad
 * elegida a mano en el selector del transporte no se toca.
 */
export const SHUTTLE_RATES = [1, 2, 4, 8] as const;

/** Ventana entre pulsaciones para seguir escalando (ms). */
export const SHUTTLE_WINDOW_MS = 1500;

export interface ShuttleState {
  /** Sentido del último shuttle pedido: 1 adelante, -1 atrás. */
  readonly direction: 1 | -1;
  /** Índice dentro de `SHUTTLE_RATES`. */
  readonly level: number;
  /** Marca temporal (ms) de la última pulsación; -∞ si nunca hubo. */
  readonly lastAt: number;
  /** true mientras la velocidad vigente la fijó la rampa del shuttle. */
  readonly active: boolean;
}

export const IDLE_SHUTTLE: ShuttleState = {
  direction: 1,
  level: 0,
  lastAt: Number.NEGATIVE_INFINITY,
  active: false,
};

/** Velocidad que corresponde al estado (nunca sale de `SHUTTLE_RATES`). */
export function shuttleRate(state: ShuttleState): number {
  return SHUTTLE_RATES[Math.min(state.level, SHUTTLE_RATES.length - 1)] ?? 1;
}

/**
 * Procesa una pulsación de shuttle. `nowMs` es `performance.now()` (o el
 * reloj que use el llamador); debe ser monótono dentro de la sesión.
 */
export function shuttleStep(
  state: ShuttleState,
  direction: 1 | -1,
  nowMs: number,
): ShuttleState {
  const expired = nowMs - state.lastAt > SHUTTLE_WINDOW_MS;
  const level = expired
    ? 0
    : Math.min(state.level + 1, SHUTTLE_RATES.length - 1);
  return { direction, level, lastAt: nowMs, active: true };
}

/**
 * Estado tras pausar. Devuelve `IDLE_SHUTTLE` sólo si la rampa estaba activa
 * (el llamador debe devolver la velocidad a 1× en ese caso); si el usuario
 * nunca usó el shuttle, devuelve el estado intacto.
 */
export function resetShuttle(state: ShuttleState): ShuttleState {
  return state.active ? IDLE_SHUTTLE : state;
}
