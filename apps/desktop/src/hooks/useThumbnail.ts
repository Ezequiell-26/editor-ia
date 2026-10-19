import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';

const cache = new Map<string, string>();

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
    void service
      .mediaThumbnail(relative, asset.kind === 'image')
      .then((value) => {
        if (!active) return;
        cache.set(key, value);
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
