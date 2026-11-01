import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../src/state/project-store';
import { EffectOverlay } from '../../src/features/editor/EffectOverlay';
import type { DesktopService } from '../../src/services/project-service';

/** Invierte cada canal con una rampa 1D: blanco→negro, rojo→cian. */
const CUBE = 'LUT_1D_SIZE 2\n1 1 1\n0 0 0\n';

function sourceDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
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

if (new URLSearchParams(window.location.search).get('fallback') === '1') {
  const original = HTMLCanvasElement.prototype.getContext;
  (
    HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string, ...args: unknown[]) => unknown;
    }
  ).getContext = function (id: string, ...args: unknown[]) {
    if (id === 'webgl2' || id === 'webgl') return null;
    return (
      original as unknown as (
        this: HTMLCanvasElement,
        id: string,
        ...rest: unknown[]
      ) => unknown
    ).call(this, id, ...args);
  };
}

function Harness() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const project = useMemo(() => createEmptyProject('Harness LUT 1D'), []);
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
      label: 'lut1d.editoria.json',
      path: 'C:\\tmp\\lut1d.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );
  useEffect(() => {
    document.getElementById('lut1d-status')!.textContent = ready ? 'ready' : 'waiting';
    if (!ready) return;
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
    const samples = {
      white: at(20, 20),
      black: at(60, 20),
      red: at(100, 20),
      gray: at(140, 20),
    };
    (window as unknown as { __lut1dHarness: unknown }).__lut1dHarness = samples;
    document.getElementById('lut1d-samples')!.textContent = JSON.stringify(samples);
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
        dataClipId="clip-lut1d"
        gradeFilter=""
        clipLutFile="media/luts/invert1d.cube"
        clipIntensity={1}
        lookLutFile={undefined}
        lookIntensity={1}
        motionBlur={undefined}
        denoise={undefined}
        vignette={undefined}
        playing={false}
        onReadyChange={setReady}
      />
    </ProjectProvider>
  );
}

const app = document.getElementById('app')!;
createRoot(app).render(<Harness />);
