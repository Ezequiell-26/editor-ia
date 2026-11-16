/**
 * Monitor dual (`previa_dupla` de AlaukCut): protocolo y detección del
 * modo para la segunda ventana del SO.
 *
 * La ventana dual carga la misma app con `?dual=1` (o con el label
 * `dual-monitor` que crea el comando Rust `dual_monitor_open`). No monta
 * el editor: `DualMonitorView` recibe el proyecto y el transporte por
 * `BroadcastChannel`, que funciona entre ventanas del mismo origen — en
 * Tauri todas las ventanas comparten `tauri.localhost`, en el navegador
 * `window.open` abre otra pestaña del mismo origen.
 */

export const DUAL_MONITOR_CHANNEL = 'olyvia-dual-monitor';
export const DUAL_MONITOR_LABEL = 'dual-monitor';

export interface DualTransportState {
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly playbackRate: number;
  readonly playbackDirection: 1 | -1;
}

/** Ventana dual → principal. */
export type DualToMainMessage =
  | { readonly type: 'hello' }
  | { readonly type: 'bye' }
  | {
      readonly type: 'command';
      readonly action: 'play' | 'pause' | 'toggle' | 'seek' | 'rate';
      readonly frame?: number;
      readonly rate?: number;
    }
  | { readonly type: 'close' };

/** Principal → ventana dual. `project`/`opened` van en el snapshot inicial
 *  y después sólo `project` (documento completo) y `transport`. */
export type DualFromMainMessage =
  | {
      readonly type: 'snapshot';
      readonly project: unknown;
      readonly opened: unknown;
      readonly playheadFrame: number;
      readonly playing: boolean;
      readonly playbackRate: number;
      readonly playbackDirection: 1 | -1;
    }
  | { readonly type: 'project'; readonly project: unknown }
  | ({ readonly type: 'transport' } & DualTransportState)
  | { readonly type: 'close' };

/** `?dual=1` en la URL — presente en dev/navegador y si Tauri conserva el
 *  query del `WebviewUrl::App`. */
export function isDualMonitorQuery(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dual') === '1';
}

/** Label de la ventana actual cuando corre dentro de Tauri. */
export async function isDualMonitorLabel(): Promise<boolean> {
  try {
    const { currentWindowLabel } = await import('./tauri/window');
    return currentWindowLabel() === DUAL_MONITOR_LABEL;
  } catch {
    return false;
  }
}

export function dualChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(DUAL_MONITOR_CHANNEL);
}

/** Cierra la ventana dual desde adentro: Tauri por API, navegador por
 *  `window.close()` (funciona en pestañas abiertas con `window.open`). */
export async function closeDualWindowSelf(): Promise<void> {
  try {
    const { closeCurrentWindow, currentWindowLabel } = await import('./tauri/window');
    if (currentWindowLabel() !== null) {
      await closeCurrentWindow();
      return;
    }
  } catch {
    // Sin Tauri o sin permiso: sigue el fallback.
  }
  window.close();
}
