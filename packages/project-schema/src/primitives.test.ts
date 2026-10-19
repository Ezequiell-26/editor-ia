import { describe, expect, it } from 'vitest';
import {
  DecibelSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  LanguageTagSchema,
  Sha256Schema,
  UnitIntervalSchema,
} from './primitives.ts';

describe('EntityIdSchema', () => {
  it('accepts a uuid v4 as the canonical entity id', () => {
    expect(EntityIdSchema.safeParse('3f2b6a1e-8c9d-4e5f-a0b1-c2d3e4f5a6b7').success).toBe(true);
  });

  it('rejects a human readable slug because ids must not be edited by hand', () => {
    expect(EntityIdSchema.safeParse('asset-1').success).toBe(false);
  });

  it('rejects an uuid of another version', () => {
    expect(EntityIdSchema.safeParse('3f2b6a1e-8c9d-1e5f-a0b1-c2d3e4f5a6b7').success).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(EntityIdSchema.safeParse('').success).toBe(false);
  });
});

describe('Sha256Schema', () => {
  it('accepts a 64 digit lower case hex digest', () => {
    expect(Sha256Schema.safeParse('a'.repeat(64)).success).toBe(true);
  });

  it('rejects upper case hex so the value survives a case sensitive comparison', () => {
    expect(Sha256Schema.safeParse('A'.repeat(64)).success).toBe(false);
  });

  it('rejects a truncated digest', () => {
    expect(Sha256Schema.safeParse('a'.repeat(63)).success).toBe(false);
  });

  it('rejects a non hex character', () => {
    expect(Sha256Schema.safeParse('g'.repeat(64)).success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts a UTC timestamp', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-18T12:34:56Z').success).toBe(true);
  });

  it('accepts a local timestamp with an offset', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-18T09:34:56-03:00').success).toBe(true);
  });

  it('rejects a bare date without a time', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-18').success).toBe(false);
  });

  it('rejects a locale formatted timestamp', () => {
    expect(IsoDateTimeSchema.safeParse('18/10/2026 09:34').success).toBe(false);
  });
});

describe('LanguageTagSchema', () => {
  it('accepts a bare language subtag', () => {
    expect(LanguageTagSchema.safeParse('es').success).toBe(true);
  });

  it('accepts a language and region subtag', () => {
    expect(LanguageTagSchema.safeParse('es-419').success).toBe(true);
  });

  it('rejects a free text language name', () => {
    expect(LanguageTagSchema.safeParse('español argentino').success).toBe(false);
  });
});

describe('UnitIntervalSchema', () => {
  it('accepts the endpoints', () => {
    expect(UnitIntervalSchema.safeParse(0).success).toBe(true);
    expect(UnitIntervalSchema.safeParse(1).success).toBe(true);
  });

  it('rejects a value outside the interval', () => {
    expect(UnitIntervalSchema.safeParse(1.5).success).toBe(false);
    expect(UnitIntervalSchema.safeParse(-0.1).success).toBe(false);
  });
});

describe('DecibelSchema', () => {
  it('accepts a plausible gain', () => {
    expect(DecibelSchema.safeParse(-6).success).toBe(true);
    expect(DecibelSchema.safeParse(0).success).toBe(true);
  });

  it('rejects a gain outside the mixer range', () => {
    expect(DecibelSchema.safeParse(-120).success).toBe(false);
    expect(DecibelSchema.safeParse(30).success).toBe(false);
  });
});

describe('JsonValueSchema', () => {
  it('accepts a nested object and array', () => {
    expect(JsonValueSchema.safeParse({ a: [1, 'two', null, { b: true }] }).success).toBe(true);
  });

  it('rejects values that cannot be serialized to JSON', () => {
    expect(JsonValueSchema.safeParse(() => 1).success).toBe(false);
    expect(JsonValueSchema.safeParse(undefined).success).toBe(false);
    expect(JsonValueSchema.safeParse(Number.NaN).success).toBe(false);
    expect(JsonValueSchema.safeParse(new Date()).success).toBe(false);
    expect(JsonValueSchema.safeParse(Symbol('x')).success).toBe(false);
    expect(JsonValueSchema.safeParse(new Map()).success).toBe(false);
  });

  it('rejects numbers that do not survive a JSON round-trip', () => {
    expect(JsonValueSchema.safeParse(9_007_199_254_740_993).success).toBe(false);
    expect(JsonValueSchema.safeParse(0.5).success).toBe(true);
  });
});
