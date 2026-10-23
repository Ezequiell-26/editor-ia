import { describe, expect, it } from 'vitest';
import { AssetSchema } from './assets.ts';

const ID = '3f2b6a1e-8c9d-4e5f-a0b1-c2d3e4f5a6b7';
const DIGEST = 'a'.repeat(64);

function videoAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    kind: 'video',
    label: 'B-roll 01',
    source: { type: 'local', path: 'media/clip-01.mp4' },
    status: 'ready',
    integrity: { sha256: DIGEST, bytes: 1_048_576 },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 900,
      frameRate: { num: 30, den: 1 },
    },
    rights: {
      license: { id: 'owned-by-user', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: '2026-10-18T12:00:00Z' },
    },
    ...overrides,
  };
}

describe('AssetSchema', () => {
  it('accepts a fully measured local video asset', () => {
    expect(AssetSchema.safeParse(videoAsset()).success).toBe(true);
  });

  it('rejects an asset that reports ready without a content hash', () => {
    const asset = videoAsset();
    delete (asset as { integrity?: unknown }).integrity;
    expect(AssetSchema.safeParse(asset).success).toBe(false);
  });

  it('rejects an asset that reports ready without a measured media probe', () => {
    const asset = videoAsset();
    delete (asset as { media?: unknown }).media;
    expect(AssetSchema.safeParse(asset).success).toBe(false);
  });

  it('rejects a ready asset whose licence is still unknown', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({
          rights: {
            license: { id: 'scraped', commercialUse: 'unknown' },
            provenance: { origin: 'user-imported', acquiredAt: '2026-10-18T12:00:00Z' },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts an unverified asset that carries no probe yet', () => {
    const asset = videoAsset({ status: 'unverified' });
    delete (asset as { media?: unknown }).media;
    delete (asset as { integrity?: unknown }).integrity;
    expect(AssetSchema.safeParse(asset).success).toBe(true);
  });

  it('accepts a missing asset so a broken path is still representable', () => {
    const asset = videoAsset({ status: 'missing' });
    delete (asset as { media?: unknown }).media;
    expect(AssetSchema.safeParse(asset).success).toBe(true);
  });

  it('rejects a video asset without pixel dimensions', () => {
    const media = { ...videoAsset().media, width: undefined };
    expect(AssetSchema.safeParse(videoAsset({ media })).success).toBe(false);
  });

  it('rejects video probe fields on an audio asset', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({
          kind: 'audio',
          media: {
            sampleRate: 48000,
            channels: 2,
            durationFrames: 900,
            width: 1920,
            height: 1080,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts an audio asset measured by a sample rate and channel count', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({ kind: 'audio', media: { sampleRate: 48000, channels: 2, durationFrames: 900 } }),
      ).success,
    ).toBe(true);
  });

  it('accepts a text asset that needs no media probe at all', () => {
    const asset = videoAsset({ kind: 'text' });
    delete (asset as { media?: unknown }).media;
    expect(AssetSchema.safeParse(asset).success).toBe(true);
  });

  it('accepts favorites, tags and a bin without touching the media probe', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({ favorite: true, tags: ['b-roll', 'entrevista'], bin: 'Entrevistas' }),
      ).success,
    ).toBe(true);
  });

  it('rejects duplicate tags regardless of case', () => {
    expect(
      AssetSchema.safeParse(videoAsset({ tags: ['B-roll', 'b-ROLL'] })).success,
    ).toBe(false);
  });

  it('rejects more tags than the editor can show', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({ tags: Array.from({ length: 9 }, (_, index) => `tag-${index}`) }),
      ).success,
    ).toBe(false);
  });

  it('rejects an overlong tag or bin name', () => {
    expect(AssetSchema.safeParse(videoAsset({ tags: ['x'.repeat(25)] })).success).toBe(false);
    expect(AssetSchema.safeParse(videoAsset({ bin: 'x'.repeat(41) })).success).toBe(false);
  });

  it('rejects an asset source that has no local path', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({ source: { type: 'remote', url: 'https://example.com/clip.mp4' } }),
      ).success,
    ).toBe(false);
  });

  it('accepts a downloaded source that records where the bytes came from', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({
          source: {
            type: 'downloaded',
            url: 'https://example.com/clip.mp4',
            path: 'media/clip-01.mp4',
            fetchedAt: '2026-10-18T12:00:00Z',
          },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a downloaded asset whose provenance has no source url', () => {
    expect(
      AssetSchema.safeParse(
        videoAsset({
          source: {
            type: 'downloaded',
            url: 'https://example.com/clip.mp4',
            path: 'media/clip-01.mp4',
            fetchedAt: '2026-10-18T12:00:00Z',
          },
          rights: {
            license: { id: 'unknown-scraper', commercialUse: 'requires-attribution' },
            provenance: { origin: 'downloaded', acquiredAt: '2026-10-18T12:00:00Z' },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown asset key instead of silently ignoring it', () => {
    expect(AssetSchema.safeParse(videoAsset({ apiKe: 'sk-123' })).success).toBe(false);
  });

  it('rejects a zero length video probe', () => {
    const media = { ...videoAsset().media, durationFrames: 0 };
    expect(AssetSchema.safeParse(videoAsset({ media })).success).toBe(false);
  });

  it('rejects an unsupported asset kind', () => {
    expect(AssetSchema.safeParse(videoAsset({ kind: 'exe' })).success).toBe(false);
  });

  it('rejects a path that escapes the project root', () => {
    expect(
      AssetSchema.safeParse(videoAsset({ source: { type: 'local', path: '../secret.mp4' } })).success,
    ).toBe(false);
  });
});
