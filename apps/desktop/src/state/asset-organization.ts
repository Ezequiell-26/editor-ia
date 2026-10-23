import type { Asset } from '@editor-ia/project-schema';
import { friendlyAssetLabel } from './asset-labels';

export type AssetKindFilter = 'all' | 'video' | 'image' | 'audio';

export interface AssetFilterInput {
  readonly query?: string;
  readonly kind?: AssetKindFilter;
  readonly bin?: string | null;
  readonly favoritesOnly?: boolean;
}

/** Bins in use, sorted for a stable selector. */
export function assetBins(assets: readonly Asset[]): string[] {
  return [
    ...new Set(
      assets
        .map((asset) => asset.bin)
        .filter((bin): bin is string => Boolean(bin)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'es'));
}

export function assetMatches(asset: Asset, input: AssetFilterInput = {}): boolean {
  const kind = input.kind ?? 'all';
  if (kind !== 'all' && asset.kind !== kind) return false;
  if (input.favoritesOnly && !asset.favorite) return false;
  if (input.bin && asset.bin !== input.bin) return false;
  const needle = (input.query ?? '').trim().toLocaleLowerCase('es');
  if (!needle) return true;
  const source = 'path' in asset.source ? asset.source.path : '';
  const haystack = [
    asset.label,
    friendlyAssetLabel(asset.label),
    source,
    asset.bin ?? '',
    ...(asset.tags ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase('es');
  return haystack.includes(needle);
}

export function filterAssets(
  assets: readonly Asset[],
  input: AssetFilterInput = {},
): Asset[] {
  return assets.filter((asset) => assetMatches(asset, input));
}
