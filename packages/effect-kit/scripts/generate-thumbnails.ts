import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_EFFECTS } from '../src/catalog/index.ts';
import type { EffectCategory, EffectManifest } from '../src/types.ts';

/**
 * Genera los thumbnails SVG del catálogo de efectos.
 *
 * `EffectBrowser` pide `/thumbnails/effects/<manifest.id>.svg` para cada
 * manifiesto del registro (video, transición y audio). Este script emite un
 * SVG determinista por manifiesto — gradiente de la categoría, motivo según
 * la naturaleza del efecto y variación de tono por id — para que ninguna
 * tarjeta quede con la imagen rota. Se corre con
 * `npm run thumbnails:effects` y los archivos generados se commitean.
 *
 * Son previews representativos, no renders del shader: la fidelidad real la
 * muestra el preview GPU del estudio.
 */

const TARGET_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'desktop',
  'public',
  'thumbnails',
  'effects',
);

const WIDTH = 320;
const HEIGHT = 180;

/** Tono base por categoría; el id lo corre unos grados para no repetir. */
const CATEGORY_HUE: Readonly<Record<EffectCategory, number>> = {
  color: 330,
  light: 45,
  blur: 205,
  stylize: 160,
  glitch: 280,
  retro: 25,
  impact: 350,
  keying: 120,
  distort: 190,
  audio: 210,
  space: 260,
  texture: 35,
  transmission: 15,
  utility: 220,
  voice: 300,
};

const AUDIO_CATEGORIES: ReadonlySet<EffectCategory> = new Set([
  'audio',
  'space',
  'texture',
  'transmission',
  'utility',
  'voice',
]);

/** Hash determinista chico (FNV-1a de 32 bits) para variar tono y motivo. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hueOf(manifest: EffectManifest): number {
  return (CATEGORY_HUE[manifest.category] + (hashId(manifest.id) % 40) - 20 + 360) % 360;
}

function hsl(hue: number, saturation: number, lightness: number, alpha = 1): string {
  return alpha === 1
    ? `hsl(${hue} ${saturation}% ${lightness}%)`
    : `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

/** Motivo por categoría para efectos de video. */
function videoMotif(category: EffectCategory, hue: number): string {
  const ink = hsl(hue, 70, 92);
  switch (category) {
    case 'blur':
      return `
    <circle cx="160" cy="90" r="58" fill="${ink}" opacity="0.35" filter="url(#soft)" />
    <circle cx="160" cy="90" r="30" fill="${ink}" opacity="0.5" filter="url(#soft)" />`;
    case 'glitch':
      return `
    <rect x="60" y="50" width="90" height="80" fill="${ink}" opacity="0.55" />
    <rect x="170" y="50" width="90" height="80" fill="${ink}" opacity="0.35" />
    <rect x="70" y="105" width="180" height="8" fill="${ink}" opacity="0.8" />
    <rect x="130" y="60" width="60" height="60" fill="none" stroke="${ink}" stroke-width="3" />`;
    case 'retro':
      return `
    ${Array.from({ length: 9 }, (_, i) => `<rect x="0" y="${20 + i * 18}" width="320" height="3" fill="#000" opacity="0.18" />`).join('\n    ')}
    <rect x="70" y="45" width="180" height="90" rx="6" fill="none" stroke="${ink}" stroke-width="4" opacity="0.8" />`;
    case 'impact':
      return `
    <path d="M160 20 L172 78 L232 50 L196 96 L250 110 L186 118 L206 168 L160 132 L114 168 L134 118 L70 110 L124 96 L88 50 L148 78 Z" fill="${ink}" opacity="0.75" />`;
    case 'keying':
      return `
    <defs><pattern id="check" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="${hsl(hue, 30, 80)}" /><rect width="12" height="12" fill="${hsl(hue, 30, 60)}" /><rect x="12" y="12" width="12" height="12" fill="${hsl(hue, 30, 60)}" />
    </pattern></defs>
    <rect width="320" height="180" fill="url(#check)" />
    <rect x="95" y="40" width="130" height="100" fill="${ink}" opacity="0.65" />`;
    case 'distort':
      return `
    <path d="M0 90 Q80 20 160 90 T320 90" fill="none" stroke="${ink}" stroke-width="5" opacity="0.8" />
    <path d="M0 110 Q80 180 160 110 T320 110" fill="none" stroke="${ink}" stroke-width="5" opacity="0.55" />
    <circle cx="160" cy="90" r="18" fill="${ink}" opacity="0.7" />`;
    case 'stylize':
      return `
    ${Array.from({ length: 6 }, (_, i) => `<circle cx="${50 + i * 44}" cy="90" r="${10 + (i % 3) * 5}" fill="${ink}" opacity="0.5" />`).join('\n    ')}`;
    case 'light':
      return `
    <circle cx="160" cy="90" r="70" fill="${ink}" opacity="0.5" filter="url(#glow)" />
    <circle cx="160" cy="90" r="26" fill="${ink}" opacity="0.9" />`;
    case 'color':
    default:
      return `
    <circle cx="115" cy="85" r="46" fill="${hsl(0, 80, 60)}" opacity="0.55" />
    <circle cx="205" cy="85" r="46" fill="${hsl(120, 70, 55)}" opacity="0.45" />
    <circle cx="160" cy="110" r="46" fill="${hsl(240, 75, 60)}" opacity="0.45" />`;
  }
}

/** Motivo de transición: dos mitades y una franja de mezcla. */
function transitionMotif(hue: number): string {
  return `
    <rect width="160" height="180" fill="${hsl(hue, 45, 30)}" />
    <rect x="160" width="160" height="180" fill="${hsl(hue + 40, 55, 45)}" />
    <path d="M110 0 L210 0 L170 180 L70 180 Z" fill="${hsl(hue, 80, 70)}" opacity="0.85" />`;
}

/** Motivo de audio: barras de onda deterministas por hash del id. */
function audioMotif(id: string, hue: number): string {
  const bars = Array.from({ length: 24 }, (_, i) => {
    const h = 18 + ((hashId(`${id}:${i}`) % 70) + i * 7) % 90;
    return `<rect x="${12 + i * 12.5}" y="${90 - h / 2}" width="7" height="${h}" rx="3.5" fill="${hsl(hue, 75, 62)}" opacity="${0.45 + (i % 5) * 0.1}" />`;
  }).join('\n    ');
  return `
    <line x1="12" y1="90" x2="308" y2="90" stroke="${hsl(hue, 60, 80)}" stroke-width="1.5" opacity="0.6" />
    ${bars}`;
}

function motifFor(manifest: EffectManifest, hue: number): string {
  if (manifest.kind === 'transition') return transitionMotif(hue);
  if (manifest.kind === 'audio' || AUDIO_CATEGORIES.has(manifest.category)) {
    return audioMotif(manifest.id, hue);
  }
  return videoMotif(manifest.category, hue);
}

function svgFor(manifest: EffectManifest): string {
  const hue = hueOf(manifest);
  const hue2 = (hue + 50) % 360;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${hsl(hue, 45, 16)};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${hsl(hue2, 50, 26)};stop-opacity:1" />
    </linearGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" />
    </filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="10" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  ${motifFor(manifest, hue)}
</svg>
`;
}

mkdirSync(TARGET_DIR, { recursive: true });
let written = 0;
for (const manifest of ALL_EFFECTS) {
  writeFileSync(join(TARGET_DIR, `${manifest.id}.svg`), svgFor(manifest), 'utf-8');
  written += 1;
}
console.log(`Thumbnails: ${written} SVG en ${TARGET_DIR}`);
