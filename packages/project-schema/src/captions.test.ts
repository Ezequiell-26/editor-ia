import { describe, expect, it } from 'vitest';
import { CaptionCueSchema, CaptionStyleSchema, CaptionsSchema } from './captions.ts';

const TRACK_CAPTIONS = '77777777-7777-4777-8777-777777777777';
const CUE_A = '88888888-8888-4888-8888-888888888888';
const CUE_B = '99999999-9999-4999-8999-999999999999';
const STYLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function captionStyle(overrides: Record<string, unknown> = {}) {
  return {
    id: STYLE,
    name: 'Subtítulo principal',
    fontFamily: 'Inter',
    fontSizePx: 48,
    color: '#ffffff',
    outlineColor: '#000000',
    position: 'bottom',
    ...overrides,
  };
}

function cue(overrides: Record<string, unknown> = {}) {
  return {
    id: CUE_A,
    trackId: TRACK_CAPTIONS,
    styleId: STYLE,
    text: 'Buenas tardes',
    language: 'es',
    startFrame: 0,
    endFrame: 45,
    ...overrides,
  };
}

function captions(cues: unknown[], styles: unknown[] = [captionStyle()]) {
  return CaptionsSchema.safeParse({ styles, cues });
}

describe('CaptionStyleSchema', () => {
  it('accepts a fully specified caption style', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle()).success).toBe(true);
  });

  it('rejects a font size that cannot be rendered', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle({ fontSizePx: 0 })).success).toBe(false);
    expect(CaptionStyleSchema.safeParse(captionStyle({ fontSizePx: 5_000 })).success).toBe(false);
  });

  it('rejects a colour that is not a hex triplet', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle({ color: 'white' })).success).toBe(false);
  });

  it('accepts the shorthand hex colour', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle({ color: '#fff' })).success).toBe(true);
  });

  it('rejects an unknown caption position', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle({ position: 'middle' })).success).toBe(false);
  });

  it('rejects an unknown style key', () => {
    expect(CaptionStyleSchema.safeParse(captionStyle({ api_key: 'sk-1' })).success).toBe(false);
  });
});

describe('CaptionCueSchema', () => {
  it('accepts a cue with integer frame timecodes', () => {
    expect(CaptionCueSchema.safeParse(cue()).success).toBe(true);
  });

  it('rejects a cue that ends at or before it starts', () => {
    expect(CaptionCueSchema.safeParse(cue({ endFrame: 0 })).success).toBe(false);
    expect(CaptionCueSchema.safeParse(cue({ endFrame: -1 })).success).toBe(false);
  });

  it('rejects empty cue text', () => {
    expect(CaptionCueSchema.safeParse(cue({ text: '   ' })).success).toBe(false);
  });

  it('rejects a free-text language name', () => {
    expect(CaptionCueSchema.safeParse(cue({ language: 'español' })).success).toBe(false);
  });

  it('accepts a regional language tag', () => {
    expect(CaptionCueSchema.safeParse(cue({ language: 'es-419' })).success).toBe(true);
  });

  it('rejects a cue longer than a readable block', () => {
    expect(CaptionCueSchema.safeParse(cue({ text: 'x'.repeat(5_000) })).success).toBe(false);
  });

  it('rejects an unknown cue key', () => {
    expect(CaptionCueSchema.safeParse(cue({ shell: 'powershell -c "rm"' })).success).toBe(false);
  });
});

describe('CaptionsSchema', () => {
  it('accepts sequential cues on one track', () => {
    expect(captions([cue(), cue({ id: CUE_B, startFrame: 45, endFrame: 90 })]).success).toBe(true);
  });

  it('rejects two cues that overlap on the same track', () => {
    expect(captions([cue(), cue({ id: CUE_B, startFrame: 44, endFrame: 90 })]).success).toBe(false);
  });

  it('rejects duplicate cue ids', () => {
    expect(captions([cue(), cue()]).success).toBe(false);
  });

  it('rejects a cue that points at a style that does not exist', () => {
    expect(captions([cue({ styleId: '00000000-0000-4000-8000-000000000000' })]).success).toBe(false);
  });
});
