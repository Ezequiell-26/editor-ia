import { describe, expect, it } from 'vitest';
import { ExportVariantSchema, RenderProfileListSchema, RenderProfileSchema } from './delivery.ts';

const PROFILE_A = '21212121-2121-4212-8212-212121212121';
const PROFILE_B = '23232323-2323-4323-8323-232323232323';
const VARIANT = '24242424-2424-4424-8424-242424242424';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_A,
    name: 'YouTube 1080p',
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    resolution: { width: 1920, height: 1080 },
    frameRate: { num: 30, den: 1 },
    bitrate: { mode: 'crf', crf: 20 },
    pixelFormat: 'yuv420p',
    audioSampleRate: 48000,
    audioChannels: 2,
    aspectRatio: '16:9',
    qualityGate: {
      minOutputBytes: 1_000_000,
      durationToleranceFrames: 3,
      requireAllAssetsReady: true,
    },
    ...overrides,
  };
}

describe('RenderProfileSchema', () => {
  it('accepts a constant rate profile', () => {
    expect(RenderProfileSchema.safeParse(profile()).success).toBe(true);
  });

  it('accepts a target bitrate profile', () => {
    expect(
      RenderProfileSchema.safeParse(
        profile({ bitrate: { mode: 'target', videoBitsPerSecond: 6_000_000 } }),
      ).success,
    ).toBe(true);
  });

  it('rejects a target bitrate of zero', () => {
    expect(
      RenderProfileSchema.safeParse(profile({ bitrate: { mode: 'target', videoBitsPerSecond: 0 } }))
        .success,
    ).toBe(false);
  });

  it('rejects a crf outside the encoder range', () => {
    expect(RenderProfileSchema.safeParse(profile({ bitrate: { mode: 'crf', crf: 60 } })).success)
      .toBe(false);
  });

  it('rejects a bitrate object with an unknown mode', () => {
    expect(RenderProfileSchema.safeParse(profile({ bitrate: { mode: 'auto' } })).success).toBe(false);
  });

  it('rejects a resolution that contradicts the declared aspect ratio', () => {
    expect(RenderProfileSchema.safeParse(profile({ aspectRatio: '9:16' })).success).toBe(false);
  });

  it('accepts a vertical resolution that matches a vertical ratio', () => {
    expect(
      RenderProfileSchema.safeParse(
        profile({
          resolution: { width: 1080, height: 1920 },
          aspectRatio: '9:16',
          name: 'Shorts 1080x1920',
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects h264 inside a webm container', () => {
    expect(RenderProfileSchema.safeParse(profile({ container: 'webm' })).success).toBe(false);
  });

  it('accepts vp9 with opus inside a webm container', () => {
    expect(
      RenderProfileSchema.safeParse(
        profile({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' }),
      ).success,
    ).toBe(true);
  });

  it('defaults the quality gate to requiring every asset ready', () => {
    const parsed = RenderProfileSchema.parse(
      profile({ qualityGate: { minOutputBytes: 500_000, durationToleranceFrames: 0 } }),
    );
    expect(parsed.qualityGate.requireAllAssetsReady).toBe(true);
  });

  it('rejects a quality gate that accepts an empty output file', () => {
    expect(
      RenderProfileSchema.safeParse(
        profile({ qualityGate: { minOutputBytes: 0, durationToleranceFrames: 3 } }),
      ).success,
    ).toBe(false);
  });

  it('rejects a sample rate that no encoder supports', () => {
    expect(RenderProfileSchema.safeParse(profile({ audioSampleRate: 12 })).success).toBe(false);
  });

  it('rejects an unknown profile key', () => {
    expect(
      RenderProfileSchema.safeParse(profile({ shellCommand: 'ffmpeg -i in -c copy out' })).success,
    ).toBe(false);
  });
});

describe('RenderProfileListSchema', () => {
  it('rejects two profiles sharing an id', () => {
    expect(RenderProfileListSchema.safeParse([profile(), profile()]).success).toBe(false);
  });

  it('rejects two profiles sharing a display name', () => {
    expect(
      RenderProfileListSchema.safeParse([profile(), profile({ id: PROFILE_B })]).success,
    ).toBe(false);
  });

  it('accepts distinct profiles', () => {
    expect(
      RenderProfileListSchema.safeParse([
        profile(),
        profile({ id: PROFILE_B, name: 'Shorts vertical' }),
      ]).success,
    ).toBe(true);
  });
});

describe('ExportVariantSchema', () => {
  function variant(overrides: Record<string, unknown> = {}) {
    return {
      id: VARIANT,
      name: 'Corto vertical',
      renderProfileId: PROFILE_A,
      platform: 'shorts',
      ...overrides,
    };
  }

  it('accepts a variant bound to a profile', () => {
    expect(ExportVariantSchema.safeParse(variant()).success).toBe(true);
  });

  it('rejects a variant without a profile reference', () => {
    const payload = variant();
    delete (payload as { renderProfileId?: unknown }).renderProfileId;
    expect(ExportVariantSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an unknown target platform', () => {
    expect(ExportVariantSchema.safeParse(variant({ platform: 'myspace' })).success).toBe(false);
  });

  it('rejects an unknown variant key', () => {
    expect(ExportVariantSchema.safeParse(variant({ publishNow: true })).success).toBe(false);
  });
});
