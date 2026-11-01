import { describe, expect, it } from 'vitest';
import { parseLottieDocument } from '../lottie';
import { BUNDLED_MOTION_JSON } from './bundled';
import { MOTION_LIBRARY, MOTION_LIBRARY_VERSION } from './catalog';

const RAW_PREFIX = 'https://raw.githubusercontent.com/useAnimations/react-useanimations/';

describe('catálogo de motions MIT', () => {
  it('incluye el catálogo curado con ids únicos y versión', () => {
    expect(MOTION_LIBRARY.length).toBeGreaterThanOrEqual(45);
    expect(MOTION_LIBRARY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ids = new Set(MOTION_LIBRARY.map((item) => item.id));
    expect(ids.size).toBe(MOTION_LIBRARY.length);
  });

  it('sólo apunta al repo allowlisted por HTTPS y con hash SHA-256', () => {
    for (const item of MOTION_LIBRARY) {
      expect(item.fileUrl.startsWith(RAW_PREFIX), item.id).toBe(true);
      expect(item.fileUrl.endsWith(`/icons/${item.fileUrl.split('/').pop()}`)).toBe(true);
      expect(item.sha256, item.id).toMatch(/^[0-9a-f]{64}$/);
      expect(item.bytes, item.id).toBeGreaterThan(0);
      expect(item.bytes, item.id).toBeLessThanOrEqual(512 * 1024);
      expect(item.license, item.id).toBe('MIT');
      expect(item.author, item.id).toBe('useAnimations');
      expect(item.source, item.id).toBe(
        'https://github.com/useAnimations/react-useanimations',
      );
      expect(item.durationSeconds, item.id).toBeGreaterThan(0);
    }
  });

  it('empaqueta 12 iconos que coinciden con el mapa offline', () => {
    const bundled = MOTION_LIBRARY.filter((item) => item.bundled);
    expect(bundled).toHaveLength(12);
    expect(Object.keys(BUNDLED_MOTION_JSON).sort()).toEqual(
      bundled.map((item) => item.id).sort(),
    );
  });

  it('incluye marcas para CTAs', () => {
    const brands = MOTION_LIBRARY.filter((item) => item.category === 'marcas');
    expect(brands.length).toBeGreaterThanOrEqual(8);
    expect(brands.map((item) => item.id)).toContain('ua-youtube');
  });

  it('cada asset empaquetado parsea con el motor de la app', () => {
    for (const [id, text] of Object.entries(BUNDLED_MOTION_JSON)) {
      const document = parseLottieDocument(JSON.parse(text) as unknown);
      expect(document.layerCount, id).toBeGreaterThan(0);
      expect(document.width, id).toBe(32);
      expect(document.height, id).toBe(32);
    }
  });
});
