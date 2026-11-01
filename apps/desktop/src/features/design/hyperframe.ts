import {
  hyperframePreviewVideoUrl,
  openDesignUrl,
  type HyperframeEntry,
  type HyperframePreviewEntry,
} from './open-design';
import type { MountedDesign } from './rasterize';
import { renderDesignToVideo, type DesignVideoResult } from './video';

/**
 * HyperFrames sin Chrome ni GSAP: las composiciones incluidas son HTML con
 * animaciones CSS y fuentes locales. Se les inlinean las fuentes como data URLs
 * y se capturan con SVG foreignObject, que conserva tipografía y estado de la
 * animación mejor que un clon de html2canvas.
 */
export function localizeHyperframeFonts(
  html: string,
  fontsCss: string,
  fontBaseUrl: string,
): string {
  const localizedFonts = fontsCss.replace(
    /url\((['"]?)(?:\.\/)?fonts\//g,
    `url($1${fontBaseUrl}`,
  );
  return embedFontsStyle(html, localizedFonts);
}

function embedFontsStyle(html: string, fontsCss: string): string {
  const withoutLink = html.replace(/<link[^>]*fonts\.css[^>]*>/gi, '');
  const styleTag = `<style data-olyvia-hyperframe-fonts>${fontsCss}</style>`;
  if (/<\/head>/i.test(withoutLink)) {
    return withoutLink.replace(/<\/head>/i, `${styleTag}</head>`);
  }
  return `${styleTag}${withoutLink}`;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Las fuentes se convierten a data URLs para que el SVG de captura sea
 * autocontenido y conserve la tipografía exacta.
 */
async function inlineFontData(
  fontsCss: string,
  sourceBaseUrl: string,
  fetcher: typeof fetch,
): Promise<string> {
  const matches = [
    ...new Set(
      [...fontsCss.matchAll(/url\((['"]?)((?:[^)'"]*\/)?fonts\/[^)'"]+)\)/g)].map(
        (match) => match[2]!,
      ),
    ),
  ];
  const replacements = new Map<string, string>();
  await Promise.all(
    matches.map(async (path) => {
      try {
        const response = await fetcher(`${sourceBaseUrl}${path.replace(/^\.\//, '')}`);
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        const extension = path.toLowerCase().endsWith('.woff2') ? 'woff2' : 'woff';
        replacements.set(path, `data:font/${extension};base64,${toBase64(buffer)}`);
      } catch {
        // Si una fuente no está disponible se conserva la URL local.
      }
    }),
  );
  let output = fontsCss;
  for (const [path, dataUrl] of replacements) {
    output = output.split(path).join(dataUrl);
  }
  return output;
}

export function assertSafeHyperframe(html: string): void {
  if (/<script\b/i.test(html)) {
    throw new Error('La composición usa scripts; no se puede renderizar sin ejecutarlos.');
  }
  if (/(?:src|href)\s*=\s*["']https?:/i.test(html)) {
    throw new Error('La composición carga recursos remotos; no se renderiza fuera de línea.');
  }
}

export async function loadHyperframeHtml(
  entry: HyperframeEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const [htmlResponse, fontsResponse] = await Promise.all([
    fetcher(openDesignUrl(entry.html)),
    fetcher(openDesignUrl(`hyperframes/${entry.id}/source/fonts.css`)),
  ]);
  if (!htmlResponse.ok) {
    throw new Error(`No se pudo abrir la composición ${entry.id} (HTTP ${htmlResponse.status}).`);
  }
  if (!fontsResponse.ok) {
    throw new Error(`No se pudieron abrir las fuentes de ${entry.id} (HTTP ${fontsResponse.status}).`);
  }
  const html = await htmlResponse.text();
  assertSafeHyperframe(html);
  const fontsCss = await fontsResponse.text();
  const sourceBase = openDesignUrl(`hyperframes/${entry.id}/source/`);
  const embedded = await inlineFontData(fontsCss, sourceBase, fetcher);
  return embedFontsStyle(html, embedded);
}

const VISUAL_PROPERTIES = [
  'opacity',
  'transform',
  'transform-origin',
  'filter',
  'clip-path',
  'color',
  'background-color',
  'background-image',
  'box-shadow',
  'text-shadow',
  'border-color',
  'border-width',
  'border-style',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-align',
  'white-space',
  'text-decoration',
  'width',
  'height',
  'left',
  'top',
  'right',
  'bottom',
  'position',
  'margin',
  'padding',
  'display',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'z-index',
  'border-radius',
  'overflow',
  'mix-blend-mode',
] as const;

function bakeComputedStyles(source: Document, target: HTMLElement): void {
  const originals = [...source.body.querySelectorAll('*')];
  const clones = [...target.querySelectorAll('*')];
  const window = source.defaultView;
  if (!window) return;
  for (let index = 0; index < originals.length; index += 1) {
    const clone = clones[index] as HTMLElement | undefined;
    if (!clone) break;
    const computed = window.getComputedStyle(originals[index]!);
    for (const property of VISUAL_PROPERTIES) {
      clone.style.setProperty(
        property,
        computed.getPropertyValue(property),
        'important',
      );
    }
  }
}

/**
 * Captura un frame exacto con SVG foreignObject. A diferencia de html2canvas,
 * el SVG conserva las fuentes embebidas y el estado visual de las animaciones.
 */
export async function captureHyperframeFrame(
  mounted: MountedDesign,
  animationTimeMs: number,
): Promise<HTMLCanvasElement> {
  const source = mounted.frameDocument;
  const view = mounted.frameWindow;
  for (const animation of source.getAnimations()) {
    try {
      animation.pause();
      animation.currentTime = animationTimeMs;
    } catch {
      // Una animación cancelada no debe romper la captura.
    }
  }
  await new Promise<void>((resolve) => {
    view.requestAnimationFrame(() => resolve());
  });

  const styles = [...source.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .join(String.fromCharCode(10));
  const wrapper = source.createElement('div') as HTMLDivElement;
  wrapper.setAttribute(
    'style',
    `position:relative;width:${mounted.width}px;height:${mounted.height}px;overflow:hidden`,
  );
  wrapper.append(...source.body.cloneNode(true).childNodes);
  bakeComputedStyles(source, wrapper);

  const fontStyle = source.createElement('style');
  fontStyle.textContent = `${styles}\n*,*::before,*::after{animation:none!important;transition:none!important}`;
  const body = source.createElement('body');
  body.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const bodyComputed = view.getComputedStyle(source.body);
  const bodyStyle = [
    'margin:0',
    `width:${mounted.width}px`,
    `height:${mounted.height}px`,
    'overflow:hidden',
    `background:${bodyComputed.backgroundColor}`,
    `font-family:${bodyComputed.fontFamily}`,
    `color:${bodyComputed.color}`,
  ].join(';');
  body.setAttribute('style', bodyStyle);
  body.append(fontStyle, wrapper);

  const serialized = new XMLSerializer().serializeToString(body);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mounted.width}" height="${mounted.height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch {
    throw new Error('El navegador no pudo rasterizar la composición HyperFrames.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = mounted.width;
  canvas.height = mounted.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el frame del HyperFrame.');
  context.drawImage(image, 0, 0, mounted.width, mounted.height);
  return canvas;
}

export async function fetchHyperframePreviewBase64(
  entry: HyperframePreviewEntry,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(hyperframePreviewVideoUrl(entry));
  if (!response.ok) {
    throw new Error(
      `No se pudo abrir el preview ${entry.id} (HTTP ${response.status}).`,
    );
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 200 * 1024 * 1024) {
    throw new Error('El preview supera los 200 MB.');
  }
  return toBase64(buffer);
}

export async function renderHyperframeToVideo(
  entry: HyperframeEntry,
  options: { readonly durationSeconds?: number; readonly fps?: number } = {},
): Promise<DesignVideoResult> {
  const durationSeconds = Math.min(
    entry.durationSec,
    Math.max(1, options.durationSeconds ?? Math.min(5, entry.durationSec)),
  );
  const fps = Math.min(30, Math.max(10, Math.round(options.fps ?? 15)));
  const html = await loadHyperframeHtml(entry);
  return renderDesignToVideo(html, 'page', {
    width: entry.width,
    height: entry.height,
    durationSeconds,
    fps,
    frameCapture: captureHyperframeFrame,
  });
}
