import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../src/state/project-store';
import { EffectOverlay } from '../../src/features/editor/EffectOverlay';
import type { DesktopService } from '../../src/services/project-service';

/**
 * Benchmark de la preview real: mide los frames presentados por el video
 * (`requestVideoFrameCallback`) con y sin la capa de efectos. El clip de
 * 1080p60 lo genera `scripts/bench-preview-effects.mjs`.
 */

const params = new URLSearchParams(window.location.search);
const caseName = params.get('case') ?? 'none';
const useLut = caseName.includes('lut');
const useDenoise = caseName.includes('denoise');
// `denoise-spatial` mide la misma escena sin el pase temporal, en la misma
// corrida y con el mismo Chrome: la diferencia es atribuible al pase.
const useTemporalDenoise = !caseName.includes('spatial');
const useVignette = caseName.includes('vignette');
const useMotionBlur = caseName.includes('motionblur');
const effectActive = useLut || useDenoise || useVignette || useMotionBlur;

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

const CUBE = invertCube();

function rendererName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'sin WebGL2';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'desconocido';
  }
}

function Harness() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(!effectActive);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const project = useMemo(() => createEmptyProject('Bench preview'), []);
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
      label: 'bench.editoria.json',
      path: 'C:\\tmp\\bench.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (!playing || !ready) return;
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    const stamps: number[] = [];
    let start = 0;
    let startedWall = 0;
    let endedWall = 0;
    const finish = (): void => {
      if (stopped) return;
      stopped = true;
      endedWall = Date.now();
      const intervals = stamps.slice(1).map((value, index) => value - stamps[index]!);
      intervals.sort((a, b) => a - b);
      const elapsed = stamps.length > 1 ? (stamps[stamps.length - 1]! - stamps[0]!) / 1000 : 0;
      const fps = elapsed > 0 ? (stamps.length - 1) / elapsed : 0;
      const p95 = intervals.length
        ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * 0.95))]
        : 0;
      const result = {
        case: caseName,
        fps: Math.round(fps * 10) / 10,
        frames: stamps.length,
        elapsed: Math.round(elapsed * 1000) / 1000,
        p95Ms: Math.round((p95 ?? 0) * 100) / 100,
        maxMs: Math.round((intervals[intervals.length - 1] ?? 0) * 100) / 100,
        renderer: rendererName(),
        width: video.videoWidth,
        height: video.videoHeight,
        // Ventana de pared para que el muestreador de CPU/RAM/GPU recorte
        // exactamente los mismos 4 s que el FPS.
        startedAt: startedWall,
        endedAt: endedWall,
      };
      (window as unknown as { __bench: unknown }).__bench = result;
      const status = document.getElementById('status')!;
      status.textContent = `done\n${JSON.stringify(result)}`;
    };
    const tick = (now: number): void => {
      if (stopped) return;
      if (start === 0) {
        start = now;
        startedWall = Date.now();
      }
      stamps.push(now);
      if (now - start < 4000) {
        video.requestVideoFrameCallback(tick);
      } else {
        finish();
      }
    };
    // El primer frame puede tardar (decode/carga del MP4): se descarta un
    // warm-up de 1,5 s para no mezclar la latencia inicial con el FPS estable.
    const warmup = window.setTimeout(() => {
      if (stopped) return;
      start = 0;
      stamps.length = 0;
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(tick);
      } else {
        const loop = (now: number): void => {
          if (stopped) return;
          if (start === 0) {
            start = now;
            startedWall = Date.now();
          }
          stamps.push(now);
          if (now - start < 4000) requestAnimationFrame(loop);
          else finish();
        };
        requestAnimationFrame(loop);
      }
    }, 1500);
    return () => {
      stopped = true;
      window.clearTimeout(warmup);
    };
  }, [playing, ready]);

  return (
    <ProjectProvider service={service} initial={{ project, opened }}>
      <div id="frame">
        <video
          ref={videoRef}
          src="/e2e/lut-harness/bench.mp4"
          muted
          playsInline
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onError={() => setError('no se pudo cargar bench.mp4')}
          style={effectActive && ready ? { opacity: 0 } : undefined}
        />
        {effectActive ? (
          <EffectOverlay
            sourceRef={videoRef}
            sourceKind="video"
            sourceKey="bench.mp4"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            dataClipId="bench"
            gradeFilter=""
            clipLutFile={useLut ? 'media/luts/invert.cube' : undefined}
            clipIntensity={1}
            lookLutFile={undefined}
            lookIntensity={1}
            motionBlur={useMotionBlur ? { frames: 8, intensity: 0.8 } : undefined}
            denoise={useDenoise ? 0.8 : undefined}
            temporalDenoise={useTemporalDenoise}
            vignette={useVignette ? 0.8 : undefined}
            playing={playing}
            onReadyChange={setReady}
          />
        ) : null}
      </div>
      {error ? <div id="error">{error}</div> : null}
    </ProjectProvider>
  );
}

const frame = document.getElementById('frame')!;
createRoot(frame).render(<Harness />);
