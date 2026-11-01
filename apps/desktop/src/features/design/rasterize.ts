import html2canvas from 'html2canvas';
import type { DesignFormat } from '../../services/project-service';

/**
 * Rasteriza un diseño HTML autocontenido dentro del WebView2 de Olyvia.
 *
 * El diseño se monta en un iframe same-origin sin scripts, de modo que el CSS
 * global de Olyvia no se filtre y las media queries / vh se evalúen contra el
 * tamaño real del lienzo. Después html2canvas (MIT) dibuja el DOM computado.
 *
 * Límites honestos: no reproduce scripts, fuentes remotas ni imágenes
 * externas (el generador ya las prohíbe); el generador usa flexbox porque
 * html2canvas no reproduce CSS grid con fidelidad.
 */
export interface DesignPngResult {
  readonly dataUrl: string;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
}

export interface MountedDesign {
  readonly width: number;
  readonly height: number;
  readonly iframe: HTMLIFrameElement;
  readonly frameDocument: Document;
  readonly frameWindow: Window;
  dispose(): void;
}

export function designFormatSize(format: DesignFormat): { width: number; height: number } {
  switch (format) {
    case 'dashboard':
      return { width: 1440, height: 900 };
    case 'deck':
      return { width: 1280, height: 720 };
    case 'card':
      return { width: 1080, height: 1080 };
    case 'thumbnail':
      return { width: 1280, height: 720 };
    default:
      return { width: 1440, height: 900 };
  }
}

function waitForFrame(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('El diseño tardó demasiado en cargar.')),
      10_000,
    );
    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function waitForImages(doc: Document): Promise<void> {
  const images = [...doc.images];
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
          window.setTimeout(resolve, 3_000);
        }),
    ),
  );
}

function sanitize(html: string): { styles: string; body: string } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const node of parsed.querySelectorAll(
    'script, iframe, object, embed, link, meta[http-equiv]',
  )) {
    node.remove();
  }
  // Doble defensa: el HTML ya viene validado por Rust, pero nunca se monta
  // un atributo ejecutable ni una URL javascript:.
  for (const node of parsed.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  const styles = [...parsed.querySelectorAll('style')]
    .map((node) => node.textContent ?? '')
    .join('\n');
  for (const node of parsed.querySelectorAll('style')) node.remove();
  return { styles, body: parsed.body.innerHTML };
}

export async function mountDesign(
  html: string,
  format: DesignFormat,
  size?: { readonly width: number; readonly height: number },
): Promise<MountedDesign> {
  const { width, height } = size ?? designFormatSize(format);
  const { styles, body } = sanitize(html);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0;`;
  document.body.appendChild(iframe);
  const dispose = () => iframe.remove();
  try {
    const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}${styles}</style></head><body>${body}</body></html>`;
    const loaded = waitForFrame(iframe);
    iframe.srcdoc = documentHtml;
    await loaded;
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!frameDocument || !frameWindow) {
      throw new Error('No se pudo preparar el lienzo del diseño.');
    }
    if (frameDocument.fonts?.ready) await frameDocument.fonts.ready;
    await waitForImages(frameDocument);
    return { width, height, iframe, frameDocument, frameWindow, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function designBackground(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  if (!view) return '#ffffff';
  const isTransparent = (value: string | undefined) =>
    !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
  let color = view.getComputedStyle(element).backgroundColor;
  if (isTransparent(color)) color = view.getComputedStyle(element.ownerDocument.body).backgroundColor;
  if (isTransparent(color)) {
    color = view.getComputedStyle(element.ownerDocument.documentElement).backgroundColor;
  }
  return isTransparent(color) ? '#ffffff' : color;
}

export async function captureDesignElement(
  mounted: MountedDesign,
  element: HTMLElement,
  options: { readonly animationTimeMs?: number } = {},
): Promise<HTMLCanvasElement> {
  const animationTimeMs = options.animationTimeMs;
  if (animationTimeMs !== undefined) {
    // Las fuentes con font-display swap no se cargan hasta que el texto es
    // visible. Se fuerza su carga antes del clon para no capturar la tipografía
    // de respaldo.
    const families = new Set(
      [...mounted.frameDocument.fonts].map((face) => face.family),
    );
    await Promise.all(
      [...families].map((family) =>
        mounted.frameDocument.fonts.load(`16px "${family}"`).catch(() => undefined),
      ),
    );
    await mounted.frameDocument.fonts.ready;
  }
  const rendered = await html2canvas(element, {
    width: mounted.width,
    height: mounted.height,
    windowWidth: mounted.width,
    windowHeight: mounted.height,
    scrollX: 0,
    scrollY: 0,
    backgroundColor: null,
    scale: 1,
    logging: false,
    useCORS: false,
    allowTaint: false,
    // html2canvas clona el documento: las animaciones CSS del clon arrancan en
    // cero. Se pausan y se llevan al tiempo del frame dentro del clon para que
    // el video refleje la animación real y no el primer keyframe.
    ...(animationTimeMs === undefined
      ? {}
      : {
          onclone: (clonedDocument: Document) => {
            for (const animation of clonedDocument.getAnimations()) {
              try {
                animation.pause();
                animation.currentTime = animationTimeMs;
              } catch {
                // Una animación cancelada no debe romper la captura.
              }
            }
          },
        }),
  });
  const canvas = document.createElement('canvas');
  canvas.width = mounted.width;
  canvas.height = mounted.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el canvas del diseño.');
  // Una sección de deck suele ser transparente: se hereda el fondo del body
  // para no dejar texto claro sobre un lienzo blanco.
  context.fillStyle = designBackground(element);
  context.fillRect(0, 0, mounted.width, mounted.height);
  context.drawImage(rendered, 0, 0, mounted.width, mounted.height);
  return canvas;
}

export function captureDesignFrame(
  mounted: MountedDesign,
  animationTimeMs?: number,
): Promise<HTMLCanvasElement> {
  return captureDesignElement(
    mounted,
    mounted.frameDocument.body,
    animationTimeMs === undefined ? {} : { animationTimeMs },
  );
}

export async function renderDesignToPng(
  html: string,
  format: DesignFormat,
): Promise<DesignPngResult> {
  const mounted = await mountDesign(html, format);
  try {
    const canvas = await captureDesignFrame(mounted);
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      throw new Error('El diseño contiene un recurso que impide exportarlo como PNG.');
    }
    return {
      dataUrl,
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: mounted.width,
      height: mounted.height,
    };
  } finally {
    mounted.dispose();
  }
}
