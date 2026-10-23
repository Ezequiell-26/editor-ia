import { useCallback, useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { detectNativeRuntime } from '../services/project-service';

/** Extensiones que la app sabe importar (mismo criterio que el diálogo nativo). */
export const MEDIA_EXTENSIONS: readonly string[] = [
  // video
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'm4v',
  'wmv',
  'flv',
  'ts',
  // audio
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  // imagen
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
];

/** Separa las rutas que sirven de las que no, para avisar qué se ignoró. */
export function splitDroppedPaths(
  paths: readonly string[],
): { readonly accepted: string[]; readonly ignored: string[] } {
  const accepted: string[] = [];
  const ignored: string[] = [];
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (MEDIA_EXTENSIONS.includes(extension)) {
      accepted.push(path);
    } else {
      ignored.push(name);
    }
  }
  return { accepted, ignored };
}

interface FileDropState {
  readonly hovering: boolean;
  readonly lastIgnored: readonly string[];
}

/**
 * Arrastrar archivos a la ventana: Tauri entrega las rutas reales del sistema
 * (no blobs), que es lo que el backend necesita para importar.
 */
export function useFileDrop(onDrop: (paths: string[]) => void | Promise<void>): FileDropState {
  const [hovering, setHovering] = useState(false);
  const [lastIgnored, setLastIgnored] = useState<readonly string[]>([]);
  const dropRef = useCallback(onDrop, [onDrop]);

  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let unlisten: UnlistenFn | null = null;
    let active = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active) return;
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setHovering(true);
          return;
        }
        if (payload.type === 'leave') {
          setHovering(false);
          return;
        }
        // drop
        setHovering(false);
        const paths = payload.paths ?? [];
        const { accepted, ignored } = splitDroppedPaths(paths);
        setLastIgnored(ignored);
        if (accepted.length > 0) {
          void dropRef(accepted);
        }
      })
      .then((off) => {
        if (!active) {
          off();
        } else {
          unlisten = off;
        }
      })
      .catch(() => {
        // sin drag-drop (p. ej. navegador): la app sigue funcionando igual
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [dropRef]);

  return { hovering, lastIgnored };
}
