import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';

const MAX_THUMBNAIL_CACHE = 150;
const cache = new Map<string, string>();

function cacheThumbnail(key: string, value: string): void {
  if (cache.size >= MAX_THUMBNAIL_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
}

/**
 * FFmpeg se lanza por cada miniatura. Con una biblioteca grande eso significaba
 * cientos de procesos simultáneos compitiendo por CPU y disco. Esta cola limita
 * la concurrencia y deja el resto esperando su turno.
 */
const MAX_CONCURRENT_THUMBNAILS = 4;
let activeThumbnails = 0;
const waitingForSlot: Array<() => void> = [];

/** Corre `task` cuando hay un lugar libre. Exportado para poder probarlo. */
export async function withThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeThumbnails >= MAX_CONCURRENT_THUMBNAILS) {
    await new Promise<void>((resolve) => {
      waitingForSlot.push(resolve);
    });
  }
  activeThumbnails += 1;
  try {
    return await task();
  } finally {
    activeThumbnails -= 1;
    waitingForSlot.shift()?.();
  }
}

/** Concurrencia actual; sólo para pruebas y depuración. */
export function activeThumbnailJobs(): number {
  return activeThumbnails;
}

export function useThumbnail(
  service: DesktopService,
  asset: Asset | null,
  root: string | null,
): string | null {
  const relative =
    asset && (asset.source.type === 'local' || asset.source.type === 'downloaded' || asset.source.type === 'generated' || asset.source.type === 'template')
      ? asset.source.path
      : null;
  const key = relative ? `${root ?? ''}:${relative}` : '';
  const [src, setSrc] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));

  useEffect(() => {
    if (!asset || !relative || !root || !service.available || asset.kind === 'font' || asset.kind === 'text') {
      setSrc(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setSrc(hit);
      return;
    }
    let active = true;
    void withThumbnailSlot(() => service.mediaThumbnail(relative, asset.kind === 'image'))
      .then((value) => {
        if (!active) return;
        cacheThumbnail(key, value);
        setSrc(value);
      })
      .catch(() => {
        if (active) setSrc(null);
      });
    return () => {
      active = false;
    };
  }, [asset, key, relative, root, service]);

  return src;
}
