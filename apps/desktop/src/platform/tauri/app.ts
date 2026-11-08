/**
 * Ciclo de vida de la app a nivel Tauri: modo background, señales de la
 * bandeja y aviso de UI lista. La UI consume estas operaciones semánticas,
 * nunca `invoke`/`emit`/`listen` directos.
 */

import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { detectNativeRuntime } from './shared';
import type { UnlistenFn } from '../../services/contracts/events';

const noopUnlisten: UnlistenFn = () => {};

/** true si la app arrancó en modo background (MCP sin UI visible). */
export function isBackgroundStartMode(): Promise<boolean> {
  if (!detectNativeRuntime()) return Promise.resolve(false);
  return invoke<boolean>('background_start_mode').catch(() => false);
}

/** La bandeja pide mostrar la UI sin reiniciar el proceso. */
export function onAppShowRequested(handler: () => void): Promise<UnlistenFn> {
  if (!detectNativeRuntime()) return Promise.resolve(noopUnlisten);
  return listen('app-show-requested', () => handler()).catch(() => noopUnlisten);
}

/** Avisa al backend que la UI montó (cierra el splash). */
export function emitAppReady(): Promise<void> {
  if (!detectNativeRuntime()) return Promise.resolve();
  return emit('app-ready').catch(() => {});
}
