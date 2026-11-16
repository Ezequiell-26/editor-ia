/**
 * Wrappers del comando Rust `dual_monitor_*` con fallback a
 * `window.open` cuando la app corre en navegador (vite dev): una segunda
 * pestaña del mismo origen comparte `BroadcastChannel`, así que el
 * monitor dual funciona igual sin Tauri.
 */

import { invoke } from '@tauri-apps/api/core';
import { detectNativeRuntime } from './shared';

export async function openDualMonitorWindow(): Promise<void> {
  if (!detectNativeRuntime()) {
    const url = `${window.location.pathname}${window.location.search}${window.location.search ? '&' : '?'}dual=1`;
    window.open(url, '_blank', 'popup=yes,width=1280,height=720');
    return;
  }
  await invoke('dual_monitor_open');
}

// `dual_monitor_close` / `dual_monitor_is_open` quedan registrados en Rust
// pero sin wrapper frontend: la dual se cierra desde adentro con
// `closeDualWindowSelf()` (platform/dual-monitor.ts).
