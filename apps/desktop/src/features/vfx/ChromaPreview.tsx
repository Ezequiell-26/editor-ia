import { useCallback, useEffect, useRef } from 'react';

export interface ChromaSettings {
  readonly color: string;
  readonly similarity: number;
  readonly blend: number;
  readonly spill: number;
}

type FrameSource = HTMLVideoElement | HTMLImageElement;

/** jsdom no implementa canvas; la vista se omite en tests y sigue en la app. */
const CANVAS_AVAILABLE =
  typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  if (value.length !== 6) return [0, 255, 0];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(red: number, green: number, blue: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function sourceSize(source: FrameSource): { width: number; height: number } | null {
  const width =
    source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const height =
    source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Elige la esquina más uniforme del frame y devuelve su color promedio. Sirve
 * tanto para una pantalla verde como para una pared de color parejo: en ambos
 * casos el fondo suele ser la zona de menor varianza del encuadre.
 */
export function sampleBackgroundColor(source: FrameSource | null): string | null {
  if (!CANVAS_AVAILABLE || !source || typeof document === 'undefined') return null;
  if (source instanceof HTMLVideoElement && source.readyState < 2) return null;
  const size = sourceSize(source);
  if (!size) return null;
  const patch = Math.max(4, Math.round(Math.min(size.width, size.height) * 0.08));
  const canvas = document.createElement('canvas');
  canvas.width = patch;
  canvas.height = patch;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const corners: Array<[number, number]> = [
    [0, 0],
    [size.width - patch, 0],
    [0, size.height - patch],
    [size.width - patch, size.height - patch],
  ];
  let best: { color: string; variance: number } | null = null;
  for (const [x, y] of corners) {
    try {
      context.drawImage(source, x, y, patch, patch, 0, 0, patch, patch);
      const { data } = context.getImageData(0, 0, patch, patch);
      let red = 0;
      let green = 0;
      let blue = 0;
      const count = data.length / 4;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index]!;
        green += data[index + 1]!;
        blue += data[index + 2]!;
      }
      red /= count;
      green /= count;
      blue /= count;
      let variance = 0;
      for (let index = 0; index < data.length; index += 4) {
        variance +=
          (data[index]! - red) ** 2 +
          (data[index + 1]! - green) ** 2 +
          (data[index + 2]! - blue) ** 2;
      }
      variance /= count;
      if (!best || variance < best.variance) {
        best = { color: toHex(red, green, blue), variance };
      }
    } catch {
      // Canvas contaminado o frame todavía no disponible: probá otra esquina.
    }
  }
  return best?.color ?? null;
}

/**
 * Clave de color pura sobre píxeles RGBA. Se usa en el canvas y en los tests:
 * deja alfa 0 en el fondo y suaviza el borde; el derrame sólo toca píxeles
 * semitransparentes de una pantalla verde/azul.
 */
export function applyChromaToPixels(
  data: Uint8ClampedArray,
  settings: ChromaSettings,
): void {
  const [keyRed, keyGreen, keyBlue] = hexToRgb(settings.color);
  const screen =
    keyGreen > keyRed && keyGreen > keyBlue
      ? 'green'
      : keyBlue > keyRed && keyBlue > keyGreen
        ? 'blue'
        : null;
  const similarity = Math.max(0.01, Math.min(1, settings.similarity));
  const inner = similarity * 0.22;
  const outer = inner + Math.max(0.02, Math.min(1, settings.blend) * 0.45);
  const spill = Math.max(0, Math.min(1, settings.spill));
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]!;
    const green = data[index + 1]!;
    const blue = data[index + 2]!;
    const distance =
      Math.sqrt(
        (red - keyRed) ** 2 + (green - keyGreen) ** 2 + (blue - keyBlue) ** 2,
      ) / 441.6729559300637;
    let alpha = 0;
    if (distance >= outer) alpha = 255;
    else if (distance > inner) {
      alpha = Math.round(((distance - inner) / (outer - inner)) * 255);
    }
    if (alpha > 0 && alpha < 255 && spill > 0 && screen) {
      if (screen === 'green') {
        const limit = (red + blue) / 2;
        if (green > limit) {
          data[index + 1] = green + (limit - green) * spill * 0.7;
        }
      } else {
        const limit = (red + green) / 2;
        if (blue > limit) {
          data[index + 2] = blue + (limit - blue) * spill * 0.7;
        }
      }
    }
    data[index + 3] = alpha;
  }
}

/**
 * Aproximación fiel de la clave de color del export sobre el frame actual.
 * Usa distancia RGB normalizada y un borde suave; el resultado se dibuja en un
 * canvas sobre un damero. No modifica el proyecto ni el MP4.
 */
export function ChromaPreview({
  source,
  active,
  settings,
  revision,
}: {
  readonly source: FrameSource | null;
  readonly active: boolean;
  readonly settings: ChromaSettings;
  readonly revision: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    if (!CANVAS_AVAILABLE) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    if (!active || !source) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (source instanceof HTMLVideoElement && source.readyState < 2) return;
    const size = sourceSize(source);
    if (!size) return;
    // La clave de la vista es una aproximación: 1280 px de ancho alcanzan y
    // evitan bloquear el hilo principal al mover los sliders en 4K.
    const scale = Math.min(1, 1280 / Math.max(size.width, size.height));
    const targetWidth = Math.max(1, Math.round(size.width * scale));
    const targetHeight = Math.max(1, Math.round(size.height * scale));
    const scratch = document.createElement('canvas');
    scratch.width = targetWidth;
    scratch.height = targetHeight;
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
    if (!scratchContext) return;
    let image: ImageData;
    try {
      scratchContext.drawImage(source, 0, 0, targetWidth, targetHeight);
      image = scratchContext.getImageData(0, 0, targetWidth, targetHeight);
    } catch {
      // La fuente no permite leer píxeles; se deja el medio original visible.
      return;
    }
    applyChromaToPixels(image.data, settings);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.putImageData(image, 0, 0);
  }, [active, source, settings.color, settings.similarity, settings.blend, settings.spill]);

  useEffect(() => {
    draw();
  }, [draw, revision]);

  useEffect(() => {
    if (!source) return;
    const listener = () => draw();
    source.addEventListener('seeked', listener);
    source.addEventListener('loadeddata', listener);
    return () => {
      source.removeEventListener('seeked', listener);
      source.removeEventListener('loadeddata', listener);
    };
  }, [source, draw]);

  return (
    <canvas
      ref={canvasRef}
      className={`vfx-chroma-canvas${active ? ' on' : ''}`}
      aria-hidden="true"
    />
  );
}
