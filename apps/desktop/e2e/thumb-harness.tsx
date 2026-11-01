import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/styles/flat.css';
import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createEmptyProject,
  type Asset,
  type ChromaKey,
  type ClipEffects,
} from '@editor-ia/project-schema';
import { ProjectProvider } from '../src/state/project-store';
import { Preview } from '../src/features/editor/Preview';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateClip,
  updateProjectSettings,
} from '../src/state/project-actions';
import type { DesktopService } from '../src/services/project-service';

/**
 * Genera una miniatura animada por efecto: un video con ruido, el efecto
 * representativo y el `Preview` real. `scripts/generate-effect-thumbs.mjs`
 * toma capturas del `.preview-look` y las codifica.
 */

const EFFECT = new URLSearchParams(window.location.search).get('effect') ?? '';

const WHEELS: Partial<ClipEffects> = {
  lift: { r: 0.3, g: 0.1, b: -0.2 },
  offset: { r: 0.1, g: 0, b: 0.2 },
  gain: { r: 0.2, g: -0.1, b: 0.05 },
  gamma: { r: 0.3, g: 0, b: 0 },
  brightness: 0.15,
};

const SPECS: Record<string, { effects?: Partial<ClipEffects>; chromaKey?: ChromaKey }> = {
  brightness: { effects: { brightness: 0.5 } },
  contrast: { effects: { contrast: 1.8 } },
  saturation: { effects: { saturation: 0.15 } },
  temperature: { effects: { temperature: 0.8 } },
  shadows: { effects: { shadows: 0.8 } },
  highlights: { effects: { highlights: -0.7 } },
  fade: { effects: { fade: 0.7 } },
  blur: { effects: { blur: 8 } },
  hueRotate: { effects: { hueRotateDeg: 120 } },
  hsl: { effects: { hsl: { hue: 100, saturation: 0.6, intensity: 0.2 } } },
  colorWheels: { effects: WHEELS },
  colorMatch: { effects: { colorMatch: { r: 1.3, g: 1, b: 0.7, strength: 0.9 } } },
  vignette: { effects: { vignette: 0.85 } },
  sharpen: { effects: { sharpen: 2.5 } },
  glow: { effects: { glow: { intensity: 0.9, radius: 28, threshold: 0.5 } } },
  motionBlur: { effects: { motionBlur: { frames: 8, intensity: 0.9 } } },
  denoise: { effects: { denoise: 0.9 } },
  grain: { effects: { grain: 0.8 } },
  lut: { effects: { lutFile: 'luts/invert.cube', lutIntensity: 1 } },
  curves: { effects: { curves: { red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } } },
  chromaKey: { chromaKey: { color: '#00ff00', similarity: 0.28, blend: 0.1 } },
};

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

const SOURCE: Asset = {
  id: '22222222-2222-4222-8222-222222222222',
  label: 'Fuente',
  kind: 'video',
  source: { type: 'local', path: 'e2e/lut-harness/preview-source.mp4' },
  status: 'ready',
  integrity: { sha256: 'b'.repeat(64), bytes: 753368 },
  rights: {
    license: { id: 'owned', commercialUse: 'allowed' },
    provenance: { origin: 'generated', acquiredAt: new Date().toISOString() },
  },
  media: { width: 320, height: 180, durationFrames: 90, frameRate: { num: 30, den: 1 } },
} as Asset;

function buildProject() {
  let project = ensureDelivery(createEmptyProject(`Thumb ${EFFECT}`));
  project = updateProjectSettings(project, { width: 320, height: 180 });
  project = addAsset(project, SOURCE);
  const added = addClipFromAsset(project, SOURCE, {
    atFrame: 0,
    durationFrames: 90,
  });
  project = added.project;
  const spec = SPECS[EFFECT];
  if (spec?.effects) {
    project = updateClip(project, added.clipId, { effects: spec.effects });
  }
  if (spec?.chromaKey) {
    project = updateClip(project, added.clipId, { chromaKey: spec.chromaKey });
  }
  return project;
}

function Harness() {
  const project = useMemo(buildProject, []);
  const service = useMemo(
    () =>
      ({
        mediaUrl: () => '/e2e/lut-harness/preview-source.mp4',
        readProjectText: async () => CUBE,
      }) as unknown as DesktopService,
    [],
  );
  const opened = useMemo(
    () => ({
      project,
      label: 'thumb.editoria.json',
      path: 'C:\\tmp\\thumb.editoria.json',
      root: 'C:\\tmp',
    }),
    [project],
  );

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + 15_000;
    const attempt = () => {
      if (cancelled) return;
      const video = document.querySelector<HTMLVideoElement>('video.preview-media');
      if (!video || video.readyState < 2) {
        if (Date.now() > deadline) {
          document.getElementById('status')!.textContent = 'error: sin video';
        } else {
          setTimeout(attempt, 100);
        }
        return;
      }
      video.muted = true;
      video.loop = true;
      void video.play().catch(() => {});
      if (video.currentTime > 0.4) {
        document.getElementById('status')!.textContent = 'ready';
        (window as unknown as { __thumbReady: boolean }).__thumbReady = true;
        return;
      }
      setTimeout(attempt, 100);
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ width: 320, height: 180, position: 'relative' }}>
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Preview />
      </ProjectProvider>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
