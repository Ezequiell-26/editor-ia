import { describe, expect, it } from 'vitest';
import { normalizeDownloadUrl } from './url.ts';

describe('normalizeDownloadUrl', () => {
  it('accepts a bare YouTube domain and adds https', () => {
    expect(normalizeDownloadUrl('www.youtube.com/watch?v=abc123')).toBe(
      'https://www.youtube.com/watch?v=abc123',
    );
    expect(normalizeDownloadUrl('youtu.be/abc123')).toBe('https://youtu.be/abc123');
  });

  it('extracts the first link from copied share text', () => {
    expect(
      normalizeDownloadUrl('Mirá este video: https://www.youtube.com/shorts/abc123?si=xyz fin'),
    ).toBe('https://www.youtube.com/shorts/abc123?si=xyz');
  });

  it('keeps valid http URLs and trims surrounding whitespace', () => {
    expect(normalizeDownloadUrl('  https://example.com/video.mp4  ')).toBe(
      'https://example.com/video.mp4',
    );
    expect(normalizeDownloadUrl('http://example.com/video.mp4')).toBe(
      'http://example.com/video.mp4',
    );
  });

  it('rejects empty input and dangerous schemes', () => {
    expect(normalizeDownloadUrl('')).toBeNull();
    expect(normalizeDownloadUrl('   ')).toBeNull();
    expect(normalizeDownloadUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeDownloadUrl('file:///C:/video.mp4')).toBeNull();
    expect(normalizeDownloadUrl('esto no es una url')).toBeNull();
  });
});
