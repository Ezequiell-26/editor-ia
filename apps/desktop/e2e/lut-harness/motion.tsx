import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../src/state/project-store';
import { EffectOverlay } from '../../src/features/editor/EffectOverlay';
import { newestMotionBlurWeight } from '../../src/features/editor/motion-blur-preview';
import { curveTable } from '../../src/features/editor/curves-lut';
import type { DesktopService } from '../../src/services/project-service';

/**
 * Verificación real del motion blur: un cuadro blanco se mueve a 120 px/s
 * sobre negro. Se compara el frame nítido del video con la salida acumulada
 * del overlay; la estela debe sumar píxeles y ensanchar el rango horizontal.
 */

const CURVE_MODE = new URLSearchParams(window.location.search).get('curve') === '1';
const SOURCE = CURVE_MODE
  ? '/e2e/lut-harness/motion-colors.mp4'
  : '/e2e/lut-harness/motion.mp4';
const BLUR = { frames: 6, intensity: 0.8 };
/** Curva no lineal (0→0, 0.5→0.1, 1→1) para delatar el orden. */
const CURVE = {
  red: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.1 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.1 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.1 },
    { x: 1, y: 1 },
  ],
};

interface Probe {
  readonly ready: boolean;
  readonly sharpCount: number;
  readonly blurCount: number;
  readonly sharpWidth: number;
  readonly blurWidth: number;
  readonly center: number[];
  readonly expectedCenter?: number[];
}

function brightStats(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 40,
): { count: number; spread: number } {
  let count = 0;
  let min = width;
  let max = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance =
        0.2126 * (data[offset] ?? 0) +
        0.7152 * (data[offset + 1] ?? 0) +
        0.0722 * (data[offset + 2] ?? 0);
      if (luminance > threshold) {
        count += 1;
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return { count, spread: max >= min ? max - min : 0 };
}

function Harness(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const project = useMemo(() => createEmptyProject('Harness blur'), []);
  const service = useMemo(
    () => ({ readProjectText: async () => '' }) as unknown as DesktopService,
    [],
  );
  const opened = useMemo(
    () => ({
      project,
      label: 'motion.editoria.json',
      path: 'C:\\tmp\\motion.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );

  useEffect(() => {
    if (CURVE_MODE) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      void video
        .play()
        .then(() => {
          if (cancelled) return;
          pauseTimer = setTimeout(() => {
            video.pause();
            if (cancelled) return;
            readTimer = setTimeout(() => {
              if (cancelled) return;
              const canvas = document.querySelector<HTMLCanvasElement>(
                'canvas.effect-preview-canvas',
              );
              const sharpCanvas = document.createElement('canvas');
              sharpCanvas.width = video.videoWidth || 160;
              sharpCanvas.height = video.videoHeight || 90;
              const sharpContext = sharpCanvas.getContext('2d');
              if (!canvas || !sharpContext) {
                document.getElementById('motion-status')!.textContent = 'missing canvas';
                return;
              }
              // El canvas del overlay puede ser WebGL: se copia a un canvas 2D.
              const readback = document.createElement('canvas');
              readback.width = canvas.width;
              readback.height = canvas.height;
              const blurContext = readback.getContext('2d');
              if (!blurContext) {
                document.getElementById('motion-status')!.textContent = 'missing readback';
                return;
              }
              blurContext.drawImage(canvas, 0, 0);
              sharpContext.drawImage(video, 0, 0);
              const sharp = brightStats(
                sharpContext.getImageData(0, 0, sharpCanvas.width, sharpCanvas.height).data,
                sharpCanvas.width,
                sharpCanvas.height,
              );
              const blurData = blurContext.getImageData(0, 0, canvas.width, canvas.height).data;
              const blurred = brightStats(blurData, canvas.width, canvas.height);
              const center = Array.from(
                blurContext.getImageData(
                  Math.floor(canvas.width / 2),
                  Math.floor(canvas.height / 2),
                  1,
                  1,
                ).data,
              );
              const probe: Probe = {
                ready,
                sharpCount: sharp.count,
                blurCount: blurred.count,
                sharpWidth: sharp.spread,
                blurWidth: blurred.spread,
                center,
              };
              (window as unknown as { __motionProbe: unknown }).__motionProbe = probe;
              document.getElementById('motion-probe')!.textContent = JSON.stringify(probe);
              document.getElementById('motion-status')!.textContent = 'done';
            }, 250);
          }, 800);
        })
        .catch((error) => {
          document.getElementById('motion-status')!.textContent = `play error: ${String(error)}`;
        });
    };
    if (video.readyState >= 2) start();
    else video.addEventListener('loadeddata', start, { once: true });
    return () => {
      cancelled = true;
      clearTimeout(pauseTimer);
      clearTimeout(readTimer);
    };
  }, [ready]);

  /**
   * Orden con motion blur: dos seeks controlados (rojo → verde) dan una sola
   * acumulación con el peso de `tmix`. Si la curva se aplica por frame, el
   * resultado es (255·(1−a), 255·a); si se aplica después de acumular, cada
   * canal pasa por la curva y el verde sube muy por encima de 255·a.
   */
  useEffect(() => {
    if (!CURVE_MODE) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const seekTo = (time: number): Promise<void> =>
      new Promise((resolve) => {
        const onSeeked = (): void => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = time;
      });
    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const videoCenter = (): number[] => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 160;
      canvas.height = video.videoHeight || 90;
      const context = canvas.getContext('2d');
      if (!context) return [0, 0, 0, 255];
      context.drawImage(video, 0, 0);
      return Array.from(
        context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data,
      );
    };
    const run = async (): Promise<void> => {
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true });
        });
      }
      if (cancelled) return;
      await seekTo(0.02); // frame rojo
      await wait(300);
      const redSource = videoCenter();
      await seekTo(0.12); // frame verde: una acumulación
      await wait(300);
      if (cancelled) return;
      const greenSource = videoCenter();
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.effect-preview-canvas');
      if (!canvas) {
        document.getElementById('motion-status')!.textContent = 'missing canvas';
        return;
      }
      const readback = document.createElement('canvas');
      readback.width = canvas.width;
      readback.height = canvas.height;
      const context = readback.getContext('2d');
      if (!context) {
        document.getElementById('motion-status')!.textContent = 'missing readback';
        return;
      }
      context.drawImage(canvas, 0, 0);
      const center = Array.from(
        context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data,
      );
      const table = curveTable(CURVE.red);
      const graded = (source: number[], channel: number): number => {
        const value = (source[channel] ?? 0) / 255;
        if (!table) return value;
        const position = Math.min(1, Math.max(0, value)) * (table.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(table.length - 1, lower + 1);
        const fraction = position - lower;
        const a = table[lower] ?? 0;
        const b = table[upper] ?? 0;
        return (a + (b - a) * fraction) / 255;
      };
      const alpha = newestMotionBlurWeight(BLUR.frames, BLUR.intensity);
      const expected = [0, 1, 2].map((channel) => {
        const previous = graded(redSource, channel);
        const current = graded(greenSource, channel);
        return Math.round((previous * (1 - alpha) + current * alpha) * 255);
      });
      const probe: Probe = {
        ready: true,
        sharpCount: 0,
        blurCount: 0,
        sharpWidth: 0,
        blurWidth: 0,
        center,
        expectedCenter: [...expected, 255],
      };
      (window as unknown as { __motionProbe: unknown }).__motionProbe = probe;
      document.getElementById('motion-probe')!.textContent = JSON.stringify(probe);
      document.getElementById('motion-status')!.textContent = 'done';
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ProjectProvider service={service} initial={{ project, opened }}>
      <video
        ref={videoRef}
        src={SOURCE}
        muted
        playsInline
        preload="auto"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      />
      <EffectOverlay
        sourceRef={videoRef}
        sourceKind="video"
        sourceKey={SOURCE}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        dataClipId="clip-blur"
        gradeFilter=""
        clipLutFile={undefined}
        clipIntensity={1}
        lookLutFile={undefined}
        lookIntensity={1}
        motionBlur={BLUR}
        curves={CURVE_MODE ? CURVE : undefined}
        denoise={undefined}
        vignette={undefined}
        playing={!CURVE_MODE}
        onReadyChange={setReady}
      />
    </ProjectProvider>
  );
}

createRoot(document.getElementById('app')!).render(<Harness />);
