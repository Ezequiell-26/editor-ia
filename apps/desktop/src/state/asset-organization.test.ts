import { describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { assetBins, assetMatches, filterAssets } from './asset-organization';

function asset(
  id: string,
  label: string,
  overrides: Partial<Asset> = {},
): Asset {
  return {
    id,
    kind: 'video',
    label,
    source: { type: 'local', path: `media/${id}.mp4` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 1_000 },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 90,
      frameRate: { num: 30, den: 1 },
    },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: '2026-10-20T10:00:00Z' },
    },
    ...overrides,
  } as Asset;
}

const broll = asset('a1', 'B-roll plaza', {
  bin: 'Exteriores',
  favorite: true,
  tags: ['plaza', 'tarde'],
});
const interview = asset('a2', 'Entrevista Ana', {
  kind: 'audio',
  bin: 'Entrevistas',
  tags: ['voz'],
});
const unused = asset('a3', 'Toma descartada', { bin: 'Exteriores' });

describe('asset organization', () => {
  it('lists unique bins sorted in Spanish', () => {
    expect(assetBins([broll, interview, unused])).toEqual(['Entrevistas', 'Exteriores']);
  });

  it('filters by favorite, kind and bin together', () => {
    expect(
      filterAssets([broll, interview, unused], {
        favoritesOnly: true,
        bin: 'Exteriores',
      }).map((item) => item.id),
    ).toEqual(['a1']);
    expect(
      filterAssets([broll, interview, unused], { kind: 'audio' }).map((item) => item.id),
    ).toEqual(['a2']);
    expect(
      filterAssets([broll, interview, unused], { bin: 'Exteriores' }).map((item) => item.id),
    ).toEqual(['a1', 'a3']);
  });

  it('searches tags, bin and path, not only the label', () => {
    expect(assetMatches(broll, { query: 'tarde' })).toBe(true);
    expect(assetMatches(broll, { query: 'exteriores' })).toBe(true);
    expect(assetMatches(interview, { query: 'a2.mp4' })).toBe(true);
    expect(assetMatches(unused, { query: 'plaza' })).toBe(false);
  });

  it('ignores an empty query and returns every asset that passes the filters', () => {
    expect(filterAssets([broll, interview, unused], { query: '   ' })).toHaveLength(3);
    expect(assetMatches(interview, { favoritesOnly: true })).toBe(false);
  });
});
