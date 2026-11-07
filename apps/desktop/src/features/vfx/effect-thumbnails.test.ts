import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_EFFECTS } from '@editor-ia/effect-kit';
import { FALLBACK_VISUAL_CATALOG } from '../visuals/visuals';

/**
 * `EffectBrowser` pide `/thumbnails/effects/<manifest.id>.svg` por cada
 * manifiesto del registro y `VisualsView` hace lo propio con presets y
 * transiciones del catálogo visual. Si el catálogo crece sin regenerar los
 * SVG (`packages/effect-kit/scripts/generate-thumbnails.ts` y
 * `apps/desktop/scripts/generate-thumbnails.js`), la tarjeta queda con la
 * imagen rota. Este test es la puerta de cobertura.
 *
 * `import.meta.url` no es fiable en vitest (vite lo reescribe según el grafo
 * de módulos), así que el directorio público se ubica subiendo desde
 * `process.cwd()` — funciona tanto con `vitest` en apps/desktop como con la
 * suite serial desde la raíz del repo.
 */

function findPublicDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const nested = join(dir, 'apps', 'desktop', 'public', 'thumbnails');
    if (existsSync(nested)) return join(dir, 'apps', 'desktop', 'public');
    const direct = join(dir, 'public', 'thumbnails');
    if (existsSync(direct)) return join(dir, 'public');
    dir = dirname(dir);
  }
  throw new Error('No se encontró apps/desktop/public/thumbnails');
}

const PUBLIC = findPublicDir();

function thumbExists(relative: string): boolean {
  return existsSync(join(PUBLIC, relative));
}

describe('thumbnails del catálogo', () => {
  it('todo manifiesto de effect-kit tiene su SVG', () => {
    const missing = ALL_EFFECTS.filter(
      (manifest) => !thumbExists(`thumbnails/effects/${manifest.id}.svg`),
    ).map((manifest) => manifest.id);
    expect(missing).toEqual([]);
  });

  it('todo preset del catálogo visual tiene su SVG', () => {
    const missing = FALLBACK_VISUAL_CATALOG.presets.filter(
      (preset) => !thumbExists(`thumbnails/presets/${preset.id}.svg`),
    ).map((preset) => preset.id);
    expect(missing).toEqual([]);
  });

  it('toda transición del catálogo visual tiene su SVG', () => {
    const missing = FALLBACK_VISUAL_CATALOG.transitions.filter(
      (item) => !thumbExists(`thumbnails/transitions/${item.id}.svg`),
    ).map((item) => item.id);
    expect(missing).toEqual([]);
  });
});
