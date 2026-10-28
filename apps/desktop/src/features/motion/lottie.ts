/**
 * Lottie real dentro de Olyvia: parseo, plan de export y rasterizado por frame.
 *
 * El motor es `lottie-web` (MIT, JavaScript puro): no hay WASM y su único
 * `eval` vive en el intérprete de expresiones, que se rechaza al importar para
 * que la CSP de la app (`script-src 'self'`, sin `unsafe-eval`) siga intacta.
 * El rasterizado usa el renderer de canvas y devuelve PNG RGBA por frame; el
 * canal alfa es real y lo conserva el codificador VP9 del backend.
 */

export const LOTTIE_MAX_SIDES = { width: 1920, height: 1080 } as const;
export const LOTTIE_MAX_FRAMES = 900;
export const LOTTIE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const LOTTIE_MAX_SECONDS = 300;
const LOTTIE_MAX_LAYERS = 2000;

export class LottieParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LottieParseError';
  }
}

export interface LottieDocument {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly width: number;
  readonly height: number;
  /** Frames por segundo declarados por la animación. */
  readonly fps: number;
  readonly inFrame: number;
  readonly outFrame: number;
  readonly durationSeconds: number;
  readonly layerCount: number;
}

export interface LottieExportPlan {
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  /** `true` cuando la animación se recorta por el tope de frames. */
  readonly trimmed: boolean;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new LottieParseError(`${label} debe ser un número mayor que cero.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new LottieParseError(`${label} debe ser un número mayor o igual a cero.`);
  }
  return value;
}

function evenSide(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/**
 * lottie-web evalúa las expresiones con `eval`; la CSP de Olyvia
 * (`script-src 'self'`, sin unsafe-eval) las bloquea. Se detectan antes de
 * cargar para no prometer una animación que el motor no puede ejecutar.
 */
function usesExpressions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(usesExpressions);
  const record = value as Record<string, unknown>;
  if (typeof record.x === 'string') return true;
  return Object.values(record).some(usesExpressions);
}

/**
 * Valida lo mínimo que necesita el rasterizador: tamaño, tasa, rango y capas.
 * No valida cada shape: lottie-web reporta los datos inválidos al cargar y el
 * panel muestra ese error en vez de inventar una animación.
 */
export function parseLottieDocument(value: unknown): LottieDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LottieParseError('El archivo no es un Lottie JSON válido.');
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.layers) || raw.layers.length === 0) {
    throw new LottieParseError('El Lottie no declara capas (`layers`).');
  }
  if (usesExpressions(raw.layers)) {
    throw new LottieParseError(
      'El Lottie usa expresiones y la app no las ejecuta por seguridad (CSP sin eval). Exportá la animación sin expresiones.',
    );
  }
  if (raw.layers.length > LOTTIE_MAX_LAYERS) {
    throw new LottieParseError(
      `El Lottie tiene demasiadas capas (${raw.layers.length}); el tope es ${LOTTIE_MAX_LAYERS}.`,
    );
  }
  const width = positiveNumber(raw.w, 'El ancho (`w`)');
  const height = positiveNumber(raw.h, 'El alto (`h`)');
  if (width > 8192 || height > 8192) {
    throw new LottieParseError('El Lottie supera 8192 px de lado.');
  }
  const fps = positiveNumber(raw.fr, 'La tasa (`fr`)');
  if (fps > 120) {
    throw new LottieParseError('La tasa del Lottie supera 120 fps.');
  }
  const inFrame =
    raw.ip === undefined ? 0 : nonNegativeNumber(raw.ip, 'El frame inicial (`ip`)');
  const outFrame = positiveNumber(raw.op, 'El frame final (`op`)');
  if (outFrame <= inFrame) {
    throw new LottieParseError('El frame final (`op`) debe ser mayor que el inicial (`ip`).');
  }
  const durationSeconds = (outFrame - inFrame) / fps;
  if (durationSeconds > LOTTIE_MAX_SECONDS) {
    throw new LottieParseError(
      `El Lottie dura ${durationSeconds.toFixed(1)} s; el tope es ${LOTTIE_MAX_SECONDS} s.`,
    );
  }
  return {
    raw,
    width,
    height,
    fps,
    inFrame,
    outFrame,
    durationSeconds,
    layerCount: raw.layers.length,
  };
}

/**
 * Ajusta el Lottie al tamaño de salida (máximo 1920×1080, lados pares) y a la
 * tasa del proyecto. `fps` fuera de 1..60 se recorta; los frames se limitan a
 * `LOTTIE_MAX_FRAMES` y `trimmed` avisa cuando se pierde el final.
 */
export function planLottieExport(
  document: LottieDocument,
  options: { readonly fps?: number; readonly maxFrames?: number } = {},
): LottieExportPlan {
  const maxFrames = Math.max(1, Math.min(LOTTIE_MAX_FRAMES, options.maxFrames ?? LOTTIE_MAX_FRAMES));
  const requested = Number.isFinite(options.fps) ? (options.fps as number) : document.fps;
  const fps = Math.max(1, Math.min(60, Math.round(requested)));
  const scale = Math.min(LOTTIE_MAX_SIDES.width / document.width, LOTTIE_MAX_SIDES.height / document.height, 1);
  const width = evenSide(document.width * scale);
  const height = evenSide(document.height * scale);
  const wanted = Math.max(1, Math.round(document.durationSeconds * fps));
  const frameCount = Math.min(wanted, maxFrames);
  return {
    width,
    height,
    fpsNum: fps,
    fpsDen: 1,
    frameCount,
    durationSeconds: frameCount / fps,
    trimmed: frameCount < wanted,
  };
}

/** Frame de la animación que corresponde al frame de salida `index`. */
export function lottieFrameAt(document: LottieDocument, plan: LottieExportPlan, index: number): number {
  const clamped = Math.max(0, Math.min(plan.frameCount - 1, index));
  return document.inFrame + (clamped / plan.fpsNum) * document.fps;
}

export interface LottieRasterizer {
  readonly frameCount: number;
  /** PNG RGBA codificado en base64 para enviar por IPC. */
  renderFrame(index: number): Promise<string>;
  dispose(): void;
}

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
