#!/usr/bin/env node
/**
 * Genera el catálogo de iconos Lottie MIT de react-useanimations.
 *
 * Fuente: https://github.com/useAnimations/react-useanimations (MIT).
 * El catálogo fija SHA-256 y tamaño de cada archivo para que la descarga en
 * caliente pueda verificarse antes de guardarse en la caché local.
 *
 * Uso: node scripts/generate-motion-catalog.mjs
 * No se ejecuta en build ni en CI: el catálogo generado se versiona.
 */
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = 'useAnimations/react-useanimations';
const REF = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'apps/desktop/src/features/motion/library');
const ASSET_DIR = path.join(OUT_DIR, 'assets');

/** @type {readonly {name:string,id:string,label:string,category:string,tags:readonly string[],bundled:boolean}[]} */
const ICONS = [
  { name: 'checkCircle', id: 'check-circle', label: 'Check en círculo', category: 'estado', tags: ['ok', 'confirmado', 'listo'], bundled: true },
  { name: 'alertCircle', id: 'alert-circle', label: 'Alerta', category: 'estado', tags: ['aviso', 'error', 'atención'], bundled: true },
  { name: 'heart', id: 'heart', label: 'Corazón', category: 'estado', tags: ['me gusta', 'amor', 'like'], bundled: true },
  { name: 'star', id: 'star', label: 'Estrella', category: 'estado', tags: ['favorito', 'rating'], bundled: true },
  { name: 'zap', id: 'zap', label: 'Rayo', category: 'general', tags: ['energía', 'rápido'], bundled: true },
  { name: 'clock', id: 'clock', label: 'Reloj', category: 'tiempo', tags: ['tiempo', 'hora'], bundled: true },
  { name: 'mail', id: 'mail', label: 'Correo', category: 'comunicación', tags: ['email', 'contacto'], bundled: true },
  { name: 'settings', id: 'settings', label: 'Ajustes', category: 'sistema', tags: ['engranaje', 'config'], bundled: true },
  { name: 'download', id: 'download', label: 'Descarga', category: 'sistema', tags: ['bajar', 'guardar'], bundled: true },
  { name: 'upload', id: 'upload', label: 'Subida', category: 'sistema', tags: ['subir', 'enviar'], bundled: true },
  { name: 'arrowRight', id: 'arrow-right', label: 'Flecha derecha', category: 'general', tags: ['siguiente', 'dirección'], bundled: true },
  { name: 'gift', id: 'gift', label: 'Regalo', category: 'general', tags: ['sorteo', 'premio'], bundled: true },
  { name: 'smile', id: 'smile', label: 'Sonrisa', category: 'estado', tags: ['feliz', 'emoji'], bundled: false },
  { name: 'info', id: 'info', label: 'Información', category: 'estado', tags: ['dato', 'ayuda'], bundled: false },
  { name: 'check', id: 'check', label: 'Check', category: 'estado', tags: ['ok', 'tick'], bundled: false },
  { name: 'lock', id: 'lock', label: 'Candado', category: 'estado', tags: ['seguro', 'privado'], bundled: false },
  { name: 'messageCircle', id: 'message-circle', label: 'Mensaje', category: 'comunicación', tags: ['chat', 'comentario'], bundled: false },
  { name: 'send', id: 'send', label: 'Enviar', category: 'comunicación', tags: ['avión', 'publicar'], bundled: false },
  { name: 'users', id: 'users', label: 'Usuarios', category: 'comunicación', tags: ['equipo', 'comunidad'], bundled: false },
  { name: 'share', id: 'share', label: 'Compartir', category: 'comunicación', tags: ['redes', 'social'], bundled: false },
  { name: 'link', id: 'link', label: 'Enlace', category: 'comunicación', tags: ['url', 'cadena'], bundled: false },
  { name: 'globe', id: 'globe', label: 'Globo', category: 'comunicación', tags: ['mundo', 'web'], bundled: false },
  { name: 'camera', id: 'camera', label: 'Cámara', category: 'media', tags: ['foto', 'grabar'], bundled: false },
  { name: 'video', id: 'video', label: 'Video', category: 'media', tags: ['film', 'clip'], bundled: false },
  { name: 'image', id: 'image', label: 'Imagen', category: 'media', tags: ['foto', 'cuadro'], bundled: false },
  { name: 'music', id: 'music', label: 'Música', category: 'media', tags: ['nota', 'audio'], bundled: false },
  { name: 'bookmark', id: 'bookmark', label: 'Marcador', category: 'media', tags: ['guardar', 'favorito'], bundled: false },
  { name: 'barChart', id: 'bar-chart', label: 'Barras', category: 'datos', tags: ['gráfico', 'estadística'], bundled: false },
  { name: 'pieChart', id: 'pie-chart', label: 'Torta', category: 'datos', tags: ['gráfico', 'porcentaje'], bundled: false },
  { name: 'trendingUp', id: 'trending-up', label: 'Tendencia', category: 'datos', tags: ['subida', 'crecimiento'], bundled: false },
  { name: 'activity', id: 'activity', label: 'Actividad', category: 'datos', tags: ['pulso', 'métrica'], bundled: false },
  { name: 'target', id: 'target', label: 'Objetivo', category: 'datos', tags: ['meta', 'diana'], bundled: false },
  { name: 'layers', id: 'layers', label: 'Capas', category: 'datos', tags: ['stack', 'niveles'], bundled: false },
  { name: 'cpu', id: 'cpu', label: 'CPU', category: 'datos', tags: ['chip', 'proceso'], bundled: false },
  { name: 'calendar', id: 'calendar', label: 'Calendario', category: 'tiempo', tags: ['fecha', 'agenda'], bundled: false },
  { name: 'wifi', id: 'wifi', label: 'WiFi', category: 'sistema', tags: ['red', 'señal'], bundled: false },
  { name: 'battery', id: 'battery', label: 'Batería', category: 'sistema', tags: ['energía', 'carga'], bundled: false },
  { name: 'sun', id: 'sun', label: 'Sol', category: 'general', tags: ['día', 'clima'], bundled: false },
  { name: 'moon', id: 'moon', label: 'Luna', category: 'general', tags: ['noche', 'clima'], bundled: false },
  { name: 'award', id: 'award', label: 'Premio', category: 'general', tags: ['medalla', 'logro'], bundled: false },
  { name: 'chevronRight', id: 'chevron-right', label: 'Chevron', category: 'general', tags: ['siguiente', 'flecha'], bundled: false },
  { name: 'youtube', id: 'youtube', label: 'YouTube', category: 'marcas', tags: ['marca', 'video', 'red social', 'cta'], bundled: false },
  { name: 'instagram', id: 'instagram', label: 'Instagram', category: 'marcas', tags: ['marca', 'red social', 'foto'], bundled: false },
  { name: 'twitter', id: 'twitter', label: 'X (Twitter)', category: 'marcas', tags: ['marca', 'red social', 'post'], bundled: false },
  { name: 'facebook', id: 'facebook', label: 'Facebook', category: 'marcas', tags: ['marca', 'red social'], bundled: false },
  { name: 'linkedin', id: 'linkedin', label: 'LinkedIn', category: 'marcas', tags: ['marca', 'red social', 'profesional'], bundled: false },
  { name: 'twitch', id: 'twitch', label: 'Twitch', category: 'marcas', tags: ['marca', 'stream', 'directo'], bundled: false },
  { name: 'github', id: 'github', label: 'GitHub', category: 'marcas', tags: ['marca', 'código', 'repo'], bundled: false },
  { name: 'figma', id: 'figma', label: 'Figma', category: 'marcas', tags: ['marca', 'diseño', 'ui'], bundled: false },
  { name: 'slack', id: 'slack', label: 'Slack', category: 'marcas', tags: ['marca', 'equipo', 'chat'], bundled: false },
  { name: 'discord', id: 'discord', label: 'Discord', category: 'marcas', tags: ['marca', 'comunidad', 'chat'], bundled: false },
  { name: 'telegram', id: 'telegram', label: 'Telegram', category: 'marcas', tags: ['marca', 'chat', 'canal'], bundled: false },
  { name: 'behance', id: 'behance', label: 'Behance', category: 'marcas', tags: ['marca', 'portafolio', 'diseño'], bundled: false },
];

function usesExpressions(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(usesExpressions);
  if (typeof value.x === 'string') return true;
  return Object.values(value).some(usesExpressions);
}

function validate(json, name) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.layers) || json.layers.length === 0) {
    throw new Error(`${name}: no declara capas`);
  }
  if (usesExpressions(json.layers)) throw new Error(`${name}: usa expresiones (CSP sin eval)`);
  for (const key of ['w', 'h', 'fr', 'op']) {
    if (typeof json[key] !== 'number' || !Number.isFinite(json[key]) || json[key] <= 0) {
      throw new Error(`${name}: ${key} inválido`);
    }
  }
  const ip = typeof json.ip === 'number' ? json.ip : 0;
  if (json.op <= ip) throw new Error(`${name}: rango de frames inválido`);
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

async function main() {
  // Rehace la carpeta para que un id renombrado no deje assets huérfanos.
  await rm(ASSET_DIR, { recursive: true, force: true });
  await mkdir(ASSET_DIR, { recursive: true });
  const items = [];
  const skipped = [];
  for (const icon of ICONS) {
    const fileUrl = `${RAW}/icons/${icon.name}.json`;
    process.stdout.write(`descargando ${icon.name}… `);
    try {
      const text = await fetchText(fileUrl);
      const json = JSON.parse(text);
      validate(json, icon.name);
      const bytes = Buffer.byteLength(text);
      if (bytes > 512 * 1024) throw new Error(`${icon.name}: ${bytes} bytes supera el tope`);
      const sha256 = createHash('sha256').update(text).digest('hex');
      const durationSeconds = (json.op - (typeof json.ip === 'number' ? json.ip : 0)) / json.fr;
      items.push({
        ...icon,
        id: `ua-${icon.id}`,
        license: 'MIT',
        author: 'useAnimations',
        source: 'https://github.com/useAnimations/react-useanimations',
        fileUrl,
        sha256,
        bytes,
        width: json.w,
        height: json.h,
        fps: json.fr,
        durationSeconds: Number(durationSeconds.toFixed(3)),
        text,
      });
      console.log(`${bytes} B · ${json.w}×${json.h} · ${durationSeconds.toFixed(2)} s`);
    } catch (error) {
      if (/usa expresiones|no declara capas/i.test(error.message)) {
        console.log(`OMITIDO (${error.message})`);
        skipped.push(icon.name);
        continue;
      }
      throw error;
    }
  }

  const meta = items.map(({ text, ...item }) => item);
  const header = `/**
 * Catálogo generado por scripts/generate-motion-catalog.mjs — no editar a mano.
 *
 * Assets: react-useanimations (https://github.com/useAnimations/react-useanimations),
 * licencia MIT. Cada entrada fija SHA-256 y tamaño para verificar la descarga
 * antes de escribirla en la caché local.
 */
export type MotionLibraryCategory =
  | 'estado'
  | 'comunicación'
  | 'media'
  | 'datos'
  | 'tiempo'
  | 'sistema'
  | 'general'
  | 'marcas';

export interface MotionLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly category: MotionLibraryCategory;
  readonly tags: readonly string[];
  readonly license: 'MIT';
  readonly author: 'useAnimations';
  readonly source: string;
  readonly fileUrl: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly bundled: boolean;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
}

export const MOTION_LIBRARY_SOURCE = '${RAW}';
export const MOTION_LIBRARY_VERSION = '${new Date().toISOString().slice(0, 10)}';

export const MOTION_LIBRARY: readonly MotionLibraryItem[] = `;
  const catalog = `${header}${JSON.stringify(meta, null, 2)} as const;\n`;
  await writeFile(path.join(OUT_DIR, 'catalog.ts'), catalog, 'utf8');

  const bundledImports = items
    .filter((item) => item.bundled)
    .map((item, index) => `import icon${index} from './assets/${item.id}.json?raw';`)
    .join('\n');
  const bundledEntries = items
    .filter((item) => item.bundled)
    .map((item, index) => `  '${item.id}': icon${index},`)
    .join('\n');
  const bundled = `// Generado por scripts/generate-motion-catalog.mjs — no editar a mano.
// Los iconos empaquetados son MIT (react-useanimations) y funcionan sin red.
${bundledImports}

export const BUNDLED_MOTION_JSON: Readonly<Record<string, string>> = {
${bundledEntries}
};
`;
  await writeFile(path.join(OUT_DIR, 'bundled.ts'), bundled, 'utf8');

  for (const item of items.filter((entry) => entry.bundled)) {
    await writeFile(path.join(ASSET_DIR, `${item.id}.json`), item.text, 'utf8');
  }

  const license = await fetchText(`${RAW}/LICENSE`);
  await writeFile(path.join(OUT_DIR, 'useanimations-LICENSE.txt'), license, 'utf8');
  console.log(`\nCatálogo: ${items.length} iconos · ${items.filter((i) => i.bundled).length} empaquetados`);
  if (skipped.length > 0) console.log(`Omitidos por CSP: ${skipped.join(', ')}`);
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
