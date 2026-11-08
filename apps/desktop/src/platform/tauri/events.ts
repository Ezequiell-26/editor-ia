/**
 * Bus de eventos nativos (Tauri) con nombres de canal centralizados.
 *
 * Regla del proyecto: la UI se suscribe a eventos semánticos, nunca al
 * string del canal. Fuera de la app de escritorio las suscripciones se
 * resuelven a un no-op que devuelve una función de desuscripción válida.
 */

import { listen } from '@tauri-apps/api/event';
import { detectNativeRuntime } from './shared';

export interface ModelDownloadProgress {
  readonly id: string;
  readonly percent: number;
}

/**
 * Progreso real de descarga de modelos locales (canal `model-download`).
 * Devuelve la función para cancelar la suscripción.
 */
export function onModelDownloadProgress(
  handler: (progress: ModelDownloadProgress) => void,
): Promise<() => void> {
  if (!detectNativeRuntime()) return Promise.resolve(() => {});
  return listen<ModelDownloadProgress>('model-download', (event) => {
    handler(event.payload);
  });
}

// Los eventos de ciclo de vida de la app viven en `./app` junto a sus comandos.
