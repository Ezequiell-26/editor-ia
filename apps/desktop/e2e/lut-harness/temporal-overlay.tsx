import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../src/state/project-store';
import { EffectOverlay } from '../../src/features/editor/EffectOverlay';
import type { DesktopService } from '../../src/services/project-service';

/**
 * Integración real del denoise temporal: dos videos reciben el mismo stream de
 * ruido de canvas; una capa usa sólo el filtro espacial y la otra agrega el
 * historial temporal de un frame. Se comparan las desviaciones.
 */

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d')!;
  const random = rng(7);
  const draw = () => {
    const image = context.createImageData(320, 180);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 128 + (random() - 0.5) * 32;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };
  draw();
  const stream = canvas.captureStream(30);
  window.setInterval(draw, 33);
  return stream;
}

function deviation(canvas: HTMLCanvasElement): number {
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const context = readback.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const data = context.getImageData(80, 60, 32, 32).data;
  const values: number[] = [];
  for (let index = 0; index < data.length; index += 4) values.push(data[index]!);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
}

function Layer({
  stream,
  temporal,
  onReady,
}: {
  readonly stream: MediaStream;
  readonly temporal: boolean;
  readonly onReady: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const project = useMemo(() => createEmptyProject('Temporal overlay'), []);
  const service = useMemo(
    () =>
      ({
        readProjectText: async () => '',
      }) as unknown as DesktopService,
    [],
  );
  const opened = useMemo(
    () => ({
      project,
      label: 'temporal.editoria.json',
      path: 'C:\\tmp\\temporal.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);
  return (
    <ProjectProvider service={service} initial={{ project, opened }}>
      <video ref={videoRef} muted playsInline style={{ opacity: 0 }} />
      <EffectOverlay
        sourceRef={videoRef}
        sourceKind="video"
        sourceKey="noise-stream"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        dataClipId={temporal ? 'temporal' : 'spatial'}
        gradeFilter=""
        clipLutFile={undefined}
        clipIntensity={1}
        lookLutFile={undefined}
        lookIntensity={1}
        motionBlur={undefined}
        denoise={0.8}
        vignette={undefined}
        temporalDenoise={temporal}
        playing
        onReadyChange={setReady}
      />
    </ProjectProvider>
  );
}

function Harness() {
  const [stream] = useState(() => noiseStream());
  const ready = useRef({ spatial: false, temporal: false });
  const [readyCount, setReadyCount] = useState(0);
  const measured = useRef(false);
  const mark = (key: 'spatial' | 'temporal') => {
    if (ready.current[key]) return;
    ready.current[key] = true;
    setReadyCount((value) => value + 1);
  };
  useEffect(() => {
    if (readyCount < 2 || measured.current) return;
    const timer = window.setTimeout(() => {
      const spatial = document.querySelector<HTMLCanvasElement>(
        '#spatial canvas.effect-preview-canvas',
      );
      const temporal = document.querySelector<HTMLCanvasElement>(
        '#temporal canvas.effect-preview-canvas',
      );
      if (!spatial || !temporal) {
        document.getElementById('status')!.textContent = 'sin canvas';
        return;
      }
      measured.current = true;
      const before = deviation(spatial);
      const after = deviation(temporal);
      const result = {
        spatial: Math.round(before * 100) / 100,
        temporal: Math.round(after * 100) / 100,
        reduction: before > 0 ? Math.round((1 - after / before) * 1000) / 1000 : 0,
      };
      (window as unknown as { __temporalOverlay: unknown }).__temporalOverlay = result;
      document.getElementById('status')!.textContent = JSON.stringify(result);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [readyCount]);
  return (
    <>
      <div id="spatial" className="frame">
        <Layer stream={stream} temporal={false} onReady={() => mark('spatial')} />
      </div>
      <div id="temporal" className="frame">
        <Layer stream={stream} temporal onReady={() => mark('temporal')} />
      </div>
    </>
  );
}

const root = document.getElementById('root')!;
createRoot(root).render(<Harness />);
