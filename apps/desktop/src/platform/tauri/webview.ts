/**
 * Eventos de drag & drop del webview (rutas reales del SO, no blobs).
 *
 * El payload nativo se normaliza a `{type, paths}` para que el hook de UI no
 * conozca la forma interna de Tauri.
 */

import { getCurrentWebview } from '@tauri-apps/api/webview';
import { detectNativeRuntime } from './shared';
import type { UnlistenFn } from '../../services/contracts/events';

export interface WebviewDragEvent {
  readonly type: 'enter' | 'over' | 'leave' | 'drop' | string;
  readonly paths?: string[];
}

const noopUnlisten: UnlistenFn = () => {};

export function onWebviewDragDrop(
  handler: (event: WebviewDragEvent) => void,
): Promise<UnlistenFn> {
  if (!detectNativeRuntime()) return Promise.resolve(noopUnlisten);
  return getCurrentWebview()
    .onDragDropEvent((event) => {
      const payload = event.payload;
      // `paths` sólo existe en enter/over/drop; en `leave` no viene.
      handler(
        'paths' in payload
          ? { type: payload.type, paths: payload.paths }
          : { type: payload.type },
      );
    })
    .catch(() => noopUnlisten);
}
