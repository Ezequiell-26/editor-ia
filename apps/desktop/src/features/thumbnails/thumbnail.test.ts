import { describe, expect, it } from 'vitest';
import {
  THUMBNAIL_ASPECTS,
  THUMBNAIL_TEMPLATES,
  coverRect,
  formatThumbnailBytes,
  safeArea,
  thumbnailAspect,
  thumbnailFileName,
  thumbnailVariants,
  wrapLines,
} from './thumbnail';

describe('Thumbnail Studio helpers', () => {
  it('ofrece tres aspect ratios y cuatro plantillas', () => {
    expect(THUMBNAIL_ASPECTS.map((aspect) => aspect.id)).toEqual(['16:9', '9:16', '1:1']);
    expect(THUMBNAIL_TEMPLATES).toHaveLength(4);
    expect(thumbnailAspect('9:16').height).toBe(1920);
  });

  it('calcula el recorte cover sin deformar', () => {
    expect(coverRect(1920, 1080, 1280, 720)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1920,
      sh: 1080,
    });
    const vertical = coverRect(1920, 1080, 1080, 1920);
    expect(vertical.sw).toBe(607.5);
    expect(vertical.sx).toBeGreaterThan(0);
  });

  it('deja una zona segura proporcional', () => {
    expect(safeArea(1000, 1000)).toEqual({ x: 60, y: 70, width: 880, height: 860 });
  });

  it('corta texto por palabras y agrega elipsis', () => {
    const lines = wrapLines('uno dos tres cuatro cinco seis', 9, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[lines.length - 1]).toMatch(/…$/);
    expect(wrapLines('   ', 10)).toEqual([]);
  });

  it('genera un nombre seguro y formatea el peso', () => {
    expect(thumbnailFileName('Mi Mini: Ñandú / 2026', 1280, 720)).toBe(
      'mi-mini-nandu-2026-1280x720',
    );
    expect(thumbnailFileName('   ', 1080, 1080)).toBe('miniatura-1080x1080');
    expect(formatThumbnailBytes(1_048_576)).toBe('1.00 MB');
  });
});

describe('variantes de miniatura', () => {
  it('devuelve la plantilla actual y dos alternativas únicas', () => {
    const variants = thumbnailVariants('split');
    expect(variants).toHaveLength(3);
    expect(variants[0]).toBe('split');
    expect(new Set(variants).size).toBe(3);
    expect(variants).toContain('bold-bottom');
    expect(variants).toContain('minimal');
  });
});
