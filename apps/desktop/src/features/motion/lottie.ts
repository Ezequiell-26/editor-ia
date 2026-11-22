/**
 * Rasterizador Lottie con DOM: `lottie-web` (canvas) fuera de pantalla.
 *
 * El núcleo puro (parseo, plan, ZIP .lottie y el contrato `LottieRasterizer`)
 * vive en `state/lottie.ts`; este módulo sólo aporta la fábrica DOM que el
 * composition root registra vía `registerLottieRasterizer` para que tanto la
 * UI como el dispatcher MCP rastericen con el mismo código.
 */

import {
  lottieFrameAt,
  type LottieDocument,
  type LottieExportPlan,
  type LottieRasterizer,
} from '../../state/lottie';

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('el canvas no pudo producir el PNG del frame'));
    }, 'image/png');
  });
}

/**
 * Monta un canvas fuera de pantalla con el tamaño de salida y rasteriza frames
 * exactos con `goToAndStop`. Los subframes quedan habilitados para que una
 * animación de 30 fps muestreada a 60 fps no repita poses.
 */
export async function createLottieRasterizer(
  document: LottieDocument,
  plan: LottieExportPlan,
): Promise<LottieRasterizer> {
  const module = await import('lottie-web');
  const lottie = module.default;
  const container = window.document.createElement('div');
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${plan.width}px;height:${plan.height}px;pointer-events:none;`;
  container.setAttribute('aria-hidden', 'true');
  window.document.body.appendChild(container);
  let animation: ReturnType<typeof lottie.loadAnimation> | null = null;
  try {
    animation = lottie.loadAnimation({
      container,
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: document.raw,
      rendererSettings: { clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
    });
    const loaded = animation;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('el motor Lottie no terminó de cargar la animación (15 s)'));
      }, 15_000);
      loaded.addEventListener('DOMLoaded', () => {
        window.clearTimeout(timer);
        resolve();
      });
      loaded.addEventListener('data_failed', () => {
        window.clearTimeout(timer);
        reject(new Error('el motor Lottie no pudo interpretar el archivo'));
      });
    });
    loaded.setSubframe(true);
    const canvas = container.querySelector('canvas');
    if (!canvas) throw new Error('el motor Lottie no creó el canvas de render');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('el canvas Lottie no expone contexto 2D');
    return {
      frameCount: plan.frameCount,
      async renderFrame(index) {
        if (!Number.isInteger(index) || index < 0 || index >= plan.frameCount) {
          throw new Error(`frame fuera de rango: ${index}`);
        }
        loaded.goToAndStop(lottieFrameAt(document, plan, index), true);
        return blobToBase64(await canvasToBlob(canvas));
      },
      dispose() {
        loaded.destroy();
        container.remove();
      },
    };
  } catch (error) {
    animation?.destroy();
    container.remove();
    throw error;
  }
}
