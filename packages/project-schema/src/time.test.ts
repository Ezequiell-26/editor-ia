import { describe, expect, it } from 'vitest';
import { FrameSchema, FrameRateSchema, TOTAL_DURATION_MAX_FRAMES } from './time.ts';

describe('FrameSchema', () => {
  it('accepts a zero frame as the timeline origin', () => {
    expect(FrameSchema.safeParse(0).success).toBe(true);
  });

  it('rejects a negative frame position', () => {
    expect(FrameSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects a fractional frame count', () => {
    expect(FrameSchema.safeParse(12.5).success).toBe(false);
  });

  it('rejects a frame count that is not a JS safe integer', () => {
    expect(FrameSchema.safeParse(2 ** 53).success).toBe(false);
  });

  it('rejects non-finite frame counts', () => {
    expect(FrameSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(FrameSchema.safeParse(Number.NaN).success).toBe(false);
  });

  it('rejects a frame count above the supported project length', () => {
    expect(FrameSchema.safeParse(TOTAL_DURATION_MAX_FRAMES + 1).success).toBe(false);
  });
});

describe('FrameRateSchema', () => {
  it('accepts an exact integer frame rate', () => {
    expect(FrameRateSchema.safeParse({ num: 30, den: 1 }).success).toBe(true);
  });

  it('accepts a rational NTSC frame rate', () => {
    expect(FrameRateSchema.safeParse({ num: 30000, den: 1001 }).success).toBe(true);
  });

  it('rejects a zero denominator', () => {
    expect(FrameRateSchema.safeParse({ num: 30, den: 0 }).success).toBe(false);
  });

  it('rejects a zero or negative numerator', () => {
    expect(FrameRateSchema.safeParse({ num: 0, den: 1 }).success).toBe(false);
    expect(FrameRateSchema.safeParse({ num: -30, den: 1 }).success).toBe(false);
  });

  it('rejects a fractional rational component', () => {
    expect(FrameRateSchema.safeParse({ num: 29.97, den: 1 }).success).toBe(false);
  });
});
