/**
 * Generador de thumbnails SVG placeholder
 * Crea previews visuales representativos para efectos, transiciones y presets
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colores temáticos por categoría
const COLORS = {
  blur: ['#667eea', '#764ba2'],
  color: ['#f093fb', '#f5576c'],
  distort: ['#4facfe', '#00f2fe'],
  sharpen: ['#43e97b', '#38f9d7'],
  creative: ['#fa709a', '#fee140'],
  transitions: ['#30cfd0', '#330867'],
  motion: ['#a8edea', '#fed6e3'],
  preset: ['#ff9a56', '#ff6a88'],
};

// Patrones SVG para diferentes efectos
const PATTERNS = {
  blur: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
      <filter id="blur">
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
      </filter>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <circle cx="160" cy="90" r="60" fill="white" opacity="0.3" filter="url(#blur)" />
  `,
  
  sharpen: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <path d="M 80 90 L 160 40 L 240 90 L 160 140 Z" fill="white" opacity="0.4" />
    <path d="M 80 90 L 160 40 L 240 90 L 160 140 Z" fill="none" stroke="white" stroke-width="2" />
  `,
  
  color: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="50%" style="stop-color:${color2};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color1};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <circle cx="80" cy="60" r="30" fill="rgba(255,255,255,0.3)" />
    <circle cx="240" cy="120" r="40" fill="rgba(255,255,255,0.2)" />
  `,
  
  distort: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <path d="M 0 90 Q 80 30 160 90 T 320 90" fill="none" stroke="white" stroke-width="3" opacity="0.5" />
    <path d="M 0 110 Q 80 170 160 110 T 320 110" fill="none" stroke="white" stroke-width="3" opacity="0.5" />
  `,
  
  transition: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="160" height="180" fill="${color1}" />
    <rect x="160" width="160" height="180" fill="${color2}" />
    <rect x="120" width="80" height="180" fill="url(#grad)" opacity="0.8" />
  `,
  
  motion: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <rect x="40" y="120" width="240" height="40" rx="4" fill="rgba(0,0,0,0.5)" />
    <text x="160" y="147" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">TÍTULO</text>
  `,
  
  preset: (color1, color2) => `
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect width="320" height="180" fill="url(#grad)" />
    <rect x="60" y="40" width="200" height="100" rx="8" fill="rgba(255,255,255,0.2)" filter="url(#glow)" />
  `,
};

// Definición de efectos a generar
const EFFECTS = [
  { id: 'blur', name: 'Blur', category: 'blur', pattern: 'blur' },
  { id: 'gaussian-blur', name: 'Gaussian Blur', category: 'blur', pattern: 'blur' },
  { id: 'motion-blur', name: 'Motion Blur', category: 'blur', pattern: 'blur' },
  { id: 'sharpen', name: 'Sharpen', category: 'sharpen', pattern: 'sharpen' },
  { id: 'unsharp-mask', name: 'Unsharp Mask', category: 'sharpen', pattern: 'sharpen' },
  { id: 'brightness', name: 'Brightness', category: 'color', pattern: 'color' },
  { id: 'contrast', name: 'Contrast', category: 'color', pattern: 'color' },
  { id: 'saturation', name: 'Saturation', category: 'color', pattern: 'color' },
  { id: 'hue', name: 'Hue', category: 'color', pattern: 'color' },
  { id: 'temperature', name: 'Temperature', category: 'color', pattern: 'color' },
  { id: 'vignette', name: 'Vignette', category: 'creative', pattern: 'color' },
  { id: 'sepia', name: 'Sepia', category: 'color', pattern: 'color' },
  { id: 'grayscale', name: 'Grayscale', category: 'color', pattern: 'color' },
  { id: 'lens-distortion', name: 'Lens Distortion', category: 'distort', pattern: 'distort' },
  { id: 'chromatic-aberration', name: 'Chromatic', category: 'distort', pattern: 'distort' },
];

const TRANSITIONS = [
  { id: 'dissolve', name: 'Dissolve' },
  { id: 'fade', name: 'Fade' },
  { id: 'wipe-left', name: 'Wipe Left' },
  { id: 'wipe-right', name: 'Wipe Right' },
  { id: 'wipe-up', name: 'Wipe Up' },
  { id: 'wipe-down', name: 'Wipe Down' },
  { id: 'zoom-in', name: 'Zoom In' },
  { id: 'zoom-out', name: 'Zoom Out' },
  { id: 'slide-left', name: 'Slide Left' },
  { id: 'slide-right', name: 'Slide Right' },
];

const MOTION_TEMPLATES = [
  { id: 'lower-third', name: 'Lower Third' },
  { id: 'title-card', name: 'Title Card' },
  { id: 'end-screen', name: 'End Screen' },
  { id: 'subscribe', name: 'Subscribe' },
  { id: 'intro', name: 'Intro' },
  { id: 'outro', name: 'Outro' },
];

const PRESETS = [
  { id: 'cinematic', name: 'Cinematic' },
  { id: 'vibrant', name: 'Vibrant' },
  { id: 'vintage', name: 'Vintage' },
  { id: 'cold', name: 'Cold' },
  { id: 'warm', name: 'Warm' },
  { id: 'dramatic', name: 'Dramatic' },
];

function generateSVG(pattern, colors, width = 320, height = 180) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${PATTERNS[pattern](colors[0], colors[1])}
</svg>`;
}

function saveSVG(path, content) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    console.log(`✓ Created: ${path}`);
  } catch (error) {
    console.error(`✗ Failed: ${path}`, error.message);
  }
}

// Generar thumbnails
console.log('🎨 Generando thumbnails SVG...\n');

const publicDir = join(__dirname, '..', 'public', 'thumbnails');

// Efectos
console.log('📦 Efectos:');
EFFECTS.forEach(effect => {
  const colors = COLORS[effect.category] || COLORS.creative;
  const svg = generateSVG(effect.pattern, colors);
  saveSVG(join(publicDir, 'effects', `${effect.id}.svg`), svg);
});

// Transiciones
console.log('\n🔄 Transiciones:');
TRANSITIONS.forEach(transition => {
  const svg = generateSVG('transition', COLORS.transitions);
  saveSVG(join(publicDir, 'transitions', `${transition.id}.svg`), svg);
});

// Motion Graphics
console.log('\n🎬 Motion Graphics:');
MOTION_TEMPLATES.forEach(template => {
  const svg = generateSVG('motion', COLORS.motion);
  saveSVG(join(publicDir, 'motion', `${template.id}.svg`), svg);
});

// Presets
console.log('\n🎨 Presets:');
PRESETS.forEach(preset => {
  const svg = generateSVG('preset', COLORS.preset);
  saveSVG(join(publicDir, 'presets', `${preset.id}.svg`), svg);
});

console.log('\n✨ Generación completada!');
console.log(`\n📊 Total generado:
  - ${EFFECTS.length} efectos
  - ${TRANSITIONS.length} transiciones
  - ${MOTION_TEMPLATES.length} motion templates
  - ${PRESETS.length} presets
  - Total: ${EFFECTS.length + TRANSITIONS.length + MOTION_TEMPLATES.length + PRESETS.length} thumbnails
`);
