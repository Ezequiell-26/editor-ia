import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../src/state/project-store';
import { EffectOverlay } from '../../src/features/editor/EffectOverlay';
import type { DesktopService } from '../../src/services/project-service';
import {
  colorBalancePixel,
  colorWheelsUniforms,
  sampleGamma,
} from '../../src/features/editor/color-wheels-preview';

/**
 * Monta el componente real (no sólo el shader) con una imagen conocida y un
 * `.cube` invertido. El estado pasa a `ready` cuando WebGL2 dibujó el frame;
 * si el canvas no aparece o queda vacío, la imagen original sigue visible.
 */

function invertCube(): string {
  const lines = ['LUT_3D_SIZE 2'];
  for (let blue = 0; blue < 2; blue += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let red = 0; red < 2; red += 1) {
        lines.push([1 - red, 1 - green, 1 - blue].join(' '));
      }
    }
  }
  return lines.join('\n');
}

const PARAMS = new URLSearchParams(window.location.search);
const CURVES_MODE = PARAMS.get('curves') === '1';
const CHROMA_MODE = PARAMS.get('chroma') === '1';
const WHEELS_MODE = PARAMS.get('wheels') === '1';
const LOOK_WHEELS_MODE = PARAMS.get('lookwheels') === '1';
const LOOK_ALL_MODE = PARAMS.get('lookall') === '1';
const LOOK_GRADE_ONLY_MODE = PARAMS.get('lookgrade') === '1';
const LOOK_MODE = PARAMS.get('look') === '1';
const RED_INVERT = {
  red: [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ],
};
const GREEN_KEY = { color: '#00ff00', similarity: 0.3, blend: 0.1 };
const WHEEL_INPUT = {
  lift: { r: 0.3, g: 0.1, b: -0.2 },
  offset: { r: 0.1, g: 0, b: 0.2 },
  gain: { r: 0.2, g: -0.1, b: 0.05 },
  gamma: { r: 0.3, g: 0, b: 0 },
  brightness: 0.15,
};

function sourceDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
  if (CHROMA_MODE) {
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(120, 50, 80, 80);
    return canvas.toDataURL('image/png');
  }
  const gradient = ctx.createLinearGradient(0, 0, 320, 180);
  gradient.addColorStop(0, '#e23b3b');
  gradient.addColorStop(0.5, '#3bd47a');
  gradient.addColorStop(1, '#3b6ce2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 320, 180);
  const patches: [number, number, string][] = [
    [8, 8, '#ffffff'],
    [48, 8, '#000000'],
    [88, 8, '#ff0000'],
    [128, 8, '#808080'],
  ];
  for (const [x, y, color] of patches) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 24, 24);
  }
  return canvas.toDataURL('image/png');
}

const SOURCE = sourceDataUrl();
const CUBE = invertCube();

function Harness() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const project = useMemo(() => createEmptyProject('Harness LUT'), []);
  const service = useMemo(
    () =>
      ({
        readProjectText: async () => CUBE,
      }) as unknown as DesktopService,
    [],
  );
  const opened = useMemo(
    () => ({
      project,
      label: 'harness.editoria.json',
      path: 'C:\\tmp\\harness.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );
  useEffect(() => {
    document.getElementById('overlay-status')!.textContent = ready ? 'ready' : 'waiting';
    if (!ready) return;
    // El canvas conserva el buffer (preserveDrawingBuffer) para que scopes y
    // capturas lo puedan leer; acá se comprueba que el LUT realmente se aplicó.
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.effect-preview-canvas');
    if (!canvas) return;
    const readback = document.createElement('canvas');
    readback.width = canvas.width;
    readback.height = canvas.height;
    const ctx = readback.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0);
    const at = (x: number, y: number): number[] =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    const samples = CHROMA_MODE
      ? {
          green: at(20, 20),
          red: at(160, 90),
        }
      : {
          white: at(20, 20),
          black: at(60, 20),
          red: at(100, 20),
          gray: at(140, 20),
        };
    if (WHEELS_MODE || LOOK_WHEELS_MODE) {
      const wheels = colorWheelsUniforms(WHEEL_INPUT)!;
      const expectedFor = (rgb: [number, number, number]): number[] => {
        const base = colorBalancePixel(
          [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
          wheels.lift,
          wheels.offset,
          wheels.gain,
        );
        return [0, 1, 2].map((channel) =>
          Math.round(
            (wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!) *
              255,
          ),
        );
      };
      (window as unknown as { __overlayExpected: unknown }).__overlayExpected = {
        white: expectedFor([255, 255, 255]),
        black: expectedFor([0, 0, 0]),
        red: expectedFor([255, 0, 0]),
        gray: expectedFor([128, 128, 128]),
      };
    }
    if (LOOK_ALL_MODE) {
      const wheels = colorWheelsUniforms(WHEEL_INPUT)!;
      const base = colorBalancePixel([1, 1, 1], wheels.lift, wheels.offset, wheels.gain);
      const after = [0, 1, 2].map((channel) =>
        wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!,
      );
      // Orden del export: ruedas/gamma → grade 0.8 → LUT invert.
      (window as unknown as { __overlayExpected: unknown }).__overlayExpected = {
        white: after.map((value) => Math.round((1 - value * 0.8) * 255)),
      };
    }
    if (LOOK_GRADE_ONLY_MODE) {
      // Curva roja invertida (blanco → cian) y grade 0.8 sin LUT del look.
      (window as unknown as { __overlayExpected: unknown }).__overlayExpected = {
        white: [0, 204, 204],
      };
    }
    (window as unknown as { __overlayHarness: unknown }).__overlayHarness = samples;
    document.getElementById('overlay-samples')!.textContent = JSON.stringify(samples);
  }, [ready]);
  return (
    <ProjectProvider service={service} initial={{ project, opened }}>
      <img
        ref={imageRef}
        src={SOURCE}
        alt="original"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      />
      <EffectOverlay
        sourceRef={imageRef}
        sourceKind="image"
        sourceKey={SOURCE}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        dataClipId="clip-lut"
        gradeFilter=""
        clipLutFile={CURVES_MODE || CHROMA_MODE || WHEELS_MODE || LOOK_WHEELS_MODE || LOOK_ALL_MODE || LOOK_GRADE_ONLY_MODE || LOOK_MODE ? undefined : 'media/luts/invert.cube'}
        clipIntensity={1}
        lookGradeFilter={LOOK_MODE || LOOK_ALL_MODE || LOOK_GRADE_ONLY_MODE ? 'brightness(0.8)' : ''}
        lookLutFile={LOOK_MODE || LOOK_ALL_MODE ? 'media/luts/invert.cube' : undefined}
        lookIntensity={1}
        motionBlur={undefined}
        denoise={undefined}
        vignette={undefined}
        curves={CURVES_MODE || LOOK_MODE || LOOK_GRADE_ONLY_MODE ? RED_INVERT : undefined}
        chromaKey={CHROMA_MODE ? GREEN_KEY : undefined}
        colorWheels={WHEELS_MODE ? WHEEL_INPUT : undefined}
        lookColorWheels={LOOK_WHEELS_MODE || LOOK_ALL_MODE ? WHEEL_INPUT : undefined}
        playing={false}
        onReadyChange={setReady}
      />
    </ProjectProvider>
  );
}

const original = document.getElementById('original')!;
const originalImage = document.createElement('img');
originalImage.src = SOURCE;
originalImage.alt = 'original';
original.appendChild(originalImage);

const app = document.getElementById('app')!;
createRoot(app).render(<Harness />);
