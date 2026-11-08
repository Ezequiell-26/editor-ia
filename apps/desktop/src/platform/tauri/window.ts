/**
 * Adaptadores de ventana del escritorio (Tauri).
 *
 * La UI nunca importa `@tauri-apps/api/window` ni `@tauri-apps/api/dpi`
 * directamente: estos helpers concentran el canal nativo y son no-op seguros
 * fuera de la app de escritorio.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { detectNativeRuntime } from './shared';
import type { UnlistenFn } from '../../services/contracts/events';

const noopUnlisten: UnlistenFn = () => {};

/** Deja la ventana compacta y centrada (launcher estilo project manager). */
export function setupCompactWindow(width = 900, height = 580): void {
  if (!detectNativeRuntime()) return;
  const appWindow = getCurrentWindow();
  void appWindow
    .unmaximize()
    .then(() => appWindow.setResizable(false))
    .then(() => appWindow.setMaximizable(false))
    .then(() => appWindow.setSize(new LogicalSize(width, height)))
    .then(() => appWindow.center())
    .catch(() => {});
}

/** Maximiza la ventana; si el SO lo rechaza, alterna maximize como fallback. */
export function maximizeMainWindow(): void {
  if (!detectNativeRuntime()) return;
  const appWindow = getCurrentWindow();
  void appWindow.maximize().catch(() => {
    void appWindow.toggleMaximize().catch(() => {});
  });
}

/**
 * Maximiza sólo si aún no lo está (al entrar al editor con una ventana que
 * quedó restaurada). Conserva el fallback toggleMaximize del comportamiento
 * anterior.
 */
export function ensureWindowMaximized(): void {
  if (!detectNativeRuntime()) return;
  const appWindow = getCurrentWindow();
  void appWindow
    .isMaximized()
    .then((maximized) => {
      if (!maximized) maximizeMainWindow();
    })
    .catch(() => maximizeMainWindow());
}

/**
 * Modo editor: ventana redimensionable/maximizable y maximizada (al entrar
 * desde el launcher).
 */
export function enterEditorWindowMode(): void {
  if (!detectNativeRuntime()) return;
  const appWindow = getCurrentWindow();
  void appWindow
    .setResizable(true)
    .catch(() => {})
    .then(() => appWindow.setMaximizable(true).catch(() => {}))
    .then(() => appWindow.maximize())
    .catch(() => {
      void appWindow.toggleMaximize().catch(() => {});
    });
}

export function isWindowFullscreen(): Promise<boolean> {
  if (!detectNativeRuntime()) return Promise.resolve(false);
  return getCurrentWindow().isFullscreen();
}

export function setWindowFullscreen(value: boolean): Promise<void> {
  if (!detectNativeRuntime()) return Promise.resolve();
  return getCurrentWindow().setFullscreen(value);
}

/** Alterna maximize y devuelve el estado resultante. */
export function toggleMaximizeWindow(): Promise<boolean> {
  if (!detectNativeRuntime()) return Promise.resolve(false);
  const appWindow = getCurrentWindow();
  return appWindow
    .toggleMaximize()
    .then(() => appWindow.isMaximized())
    .catch(() => false);
}

/** Estado actual de maximizado (para sincronizar controles de ventana). */
export function isWindowMaximized(): Promise<boolean> {
  if (!detectNativeRuntime()) return Promise.resolve(false);
  return getCurrentWindow().isMaximized().catch(() => false);
}

/** Suscripción a cambios de tamaño (maximizar/restaurar/redimensionar). */
export function onWindowResized(handler: () => void): Promise<UnlistenFn> {
  if (!detectNativeRuntime()) return Promise.resolve(noopUnlisten);
  return getCurrentWindow()
    .onResized(handler)
    .catch(() => noopUnlisten);
}

export interface WindowCloseRequest {
  /** Evita el cierre; la app decide después (guardado de proyecto). */
  readonly preventDefault: () => void;
}

/**
 * Pedido de cierre de la ventana (botón nativo o gesto del SO). El handler
 * puede ser async: Tauri espera la Promise antes de cerrar si no se llamó
 * `preventDefault`.
 */
export function onWindowCloseRequested(
  handler: (event: WindowCloseRequest) => void | Promise<void>,
): Promise<UnlistenFn> {
  if (!detectNativeRuntime()) return Promise.resolve(noopUnlisten);
  return getCurrentWindow()
    .onCloseRequested((event) =>
      // Se devuelve la Promise del handler: Tauri la espera antes de cerrar.
      handler({ preventDefault: () => event.preventDefault() }),
    )
    .catch(() => noopUnlisten);
}

/** Cierre forzado tras guardar (equivalente a `appWindow.destroy()`). */
export function destroyMainWindow(): Promise<void> {
  if (!detectNativeRuntime()) return Promise.resolve();
  return getCurrentWindow().destroy().catch(() => {});
}

export function minimizeMainWindow(): void {
  if (!detectNativeRuntime()) return;
  void getCurrentWindow().minimize().catch(() => {});
}

export function closeMainWindow(): void {
  if (!detectNativeRuntime()) return;
  void getCurrentWindow().close().catch(() => {});
}
