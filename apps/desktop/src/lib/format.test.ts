import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('distingue bytes, KB y MB sin redondear a 0 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(246)).toBe('246 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20480)).toBe('20 KB');
    expect(formatBytes(2_000_000)).toBe('1.9 MB');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
