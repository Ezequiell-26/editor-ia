import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/styles/flat.css';
import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createEmptyProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider } from '../src/state/project-store';
import { Preview } from '../src/features/editor/Preview';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateClip,
  updateProjectSettings,
} from '../src/state/project-actions';
import {
  colorBalancePixel,
  colorWheelsUniforms,
  sampleGamma,
} from '../src/features/editor/color-wheels-preview';
import { toneCurveTable } from '../src/features/editor/tone-curve';
import {
  applyHslMatrix,
  applySelectiveHsl,
  hslColorMask,
  hslMatrixRows,
} from '../src/features/editor/hsl-matrix';
import type { DesktopService } from '../src/services/project-service';

/**
 * Integración real de `Preview` + `EffectOverlay`: un clip de imagen blanco
 * con ruedas/brillo o curvas. Comprueba el `gradeFilter` y el pase shader que
 * usa la app (no sólo el componente aislado).
 */

const CASE = new URLSearchParams(window.location.search).get('case') ?? 'wheels';

const IMAGE_ASSET: Asset = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Blanco',
  kind: 'image',
  source: { type: 'local', path: 'white.svg' },
  status: 'ready',
  integrity: { sha256: 'a'.repeat(64), bytes: 128 },
  rights: {
    license: { id: 'owned', commercialUse: 'allowed' },
    provenance: { origin: 'generated', acquiredAt: new Date().toISOString() },
  },
  media: { width: 320, height: 180 },
} as Asset;

const GRAY_ASSET: Asset = {
  ...IMAGE_ASSET,
  id: '33333333-3333-4333-8333-333333333333',
  label: 'Gris',
  source: { type: 'local', path: 'gray.svg' },
};

const RED_ASSET: Asset = {
  ...IMAGE_ASSET,
  id: '44444444-4444-4444-8444-444444444444',
  label: 'Rojo',
  source: { type: 'local', path: 'red.svg' },
};

const DARK_ASSET: Asset = {
  ...IMAGE_ASSET,
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Gris oscuro',
  source: { type: 'local', path: 'dark.svg' },
};

const WHEELS = {
  lift: { r: 0.3, g: 0.1, b: -0.2 },
  offset: { r: 0.1, g: 0, b: 0.2 },
  gain: { r: 0.2, g: -0.1, b: 0.05 },
  gamma: { r: 0.3, g: 0, b: 0 },
  brightness: 0.15,
};

function expectedForWheels(input: typeof WHEELS): number[] {
  const wheels = colorWheelsUniforms(input)!;
  const base = colorBalancePixel([1, 1, 1], wheels.lift, wheels.offset, wheels.gain);
  return [0, 1, 2].map((channel) =>
    Math.round(
      (wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!) *
        255,
    ),
  );
}

function buildProject(): { project: ReturnType<typeof ensureDelivery>; expected: number[] } {
  let project = ensureDelivery(createEmptyProject('Preview harness'));
  project = updateProjectSettings(project, { width: 320, height: 180 });
  const sourceAsset =
    CASE === 'brightness' ||
    CASE === 'brightnessonly' ||
    CASE === 'temperature' ||
    CASE === 'wheelscontrast' ||
    CASE === 'match' ||
    CASE === 'lookmatch'
      ? GRAY_ASSET
      : CASE === 'wheelssaturation' ||
          CASE === 'wheelsshue' ||
          CASE === 'wheelsgray' ||
          CASE === 'wheelssepia' ||
          CASE === 'saturation' ||
          CASE === 'hue' ||
          CASE === 'looksaturation' ||
          CASE === 'hsl' ||
          CASE === 'hslselective' ||
          CASE === 'hslmasked' ||
          CASE === 'lookhslselective' ||
          CASE === 'lookhsl'
        ? RED_ASSET
        : CASE === 'lookbrightness'
          ? GRAY_ASSET
          : CASE === 'tone' || CASE === 'looktone'
            ? DARK_ASSET
            : IMAGE_ASSET;
  project = addAsset(project, sourceAsset);
  const added = addClipFromAsset(project, sourceAsset, {
    atFrame: 0,
    durationFrames: 60,
  });
  project = added.project;
  if (CASE === 'curves') {
    project = updateClip(project, added.clipId, {
      effects: {
        curves: { red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
      },
    });
    return { project, expected: [0, 255, 255] };
  }
  if (CASE === 'brightness') {
    // El export aplica colorbalance (brillo aditivo) antes de las curvas:
    // gris 128 +0,5 en los tres rangos ≈ 217 y la curva roja invertida deja
    // rojo ≈ 38. El CSS multiplicativo daría (63, 192, 192).
    project = updateClip(project, added.clipId, {
      effects: {
        brightness: 0.5,
        curves: { red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
      },
    });
    const knobs: [number, number, number] = [0.5, 0.5, 0.5];
    const graded = colorBalancePixel([128 / 255, 128 / 255, 128 / 255], knobs, knobs, knobs);
    return {
      project,
      expected: [
        Math.round((1 - graded[0]) * 255),
        Math.round(graded[1] * 255),
        Math.round(graded[2] * 255),
      ],
    };
  }
  if (CASE === 'brightnessonly') {
    // Sin otros efectos el brillo también usa el pase exacto: con los tres
    // rangos en +0,5 la referencia es `colorbalance` del export, no el CSS
    // multiplicativo (que daría 192).
    project = updateClip(project, added.clipId, { effects: { brightness: 0.5 } });
    const knobs: [number, number, number] = [0.5, 0.5, 0.5];
    const base = colorBalancePixel([128 / 255, 128 / 255, 128 / 255], knobs, knobs, knobs);
    return { project, expected: base.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'wheelscurves') {
    // Ruedas + gamma antes de la curva, como el export: el rojo invertido se
    // calcula sobre el gris ya graduado por colorbalance.
    project = updateClip(project, added.clipId, {
      effects: { ...WHEELS, curves: { red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    });
    const graded = expectedForWheels(WHEELS);
    return { project, expected: [255 - graded[0]!, graded[1]!, graded[2]!] };
  }
  if (CASE === 'temperature') {
    // colorbalance de sombras del export: rs=t·0,25, bs=−t·0,25.
    project = updateClip(project, added.clipId, { effects: { temperature: 0.6 } });
    const lift: [number, number, number] = [0.15, 0, -0.15];
    const zeros: [number, number, number] = [0, 0, 0];
    const graded = colorBalancePixel([128 / 255, 128 / 255, 128 / 255], lift, zeros, zeros);
    return { project, expected: graded.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'wheelscontrast') {
    // Export: ruedas/gamma → contraste (colorlevels) sobre el gris graduado.
    project = updateClip(project, added.clipId, {
      effects: { ...WHEELS, contrast: 0.5 },
    });
    const wheels = colorWheelsUniforms(WHEELS)!;
    const base = colorBalancePixel(
      [128 / 255, 128 / 255, 128 / 255],
      wheels.lift,
      wheels.offset,
      wheels.gain,
    );
    const after = [0, 1, 2].map((channel) =>
      wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!,
    );
    const contrasted = after.map((value) =>
      Math.min(1, Math.max(0, 0.5 + 0.5 * (value - 0.5))),
    );
    return { project, expected: contrasted.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'wheelssaturation') {
    // Export: ruedas/gamma → saturación (hue=s, luma BT.601) sobre rojo.
    project = updateClip(project, added.clipId, {
      effects: { ...WHEELS, saturation: 0.5 },
    });
    const wheels = colorWheelsUniforms(WHEELS)!;
    const base = colorBalancePixel([1, 0, 0], wheels.lift, wheels.offset, wheels.gain);
    const after = [0, 1, 2].map((channel) =>
      wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!,
    );
    const luma = 0.299 * after[0]! + 0.587 * after[1]! + 0.114 * after[2]!;
    const saturated = after.map((value) =>
      Math.min(1, Math.max(0, luma + (value - luma) * 0.5)),
    );
    return { project, expected: saturated.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'wheelsshue') {
    // Export: ruedas/gamma → hue=h (rotación Cb/Cr BT.601) sobre rojo.
    project = updateClip(project, added.clipId, {
      effects: { ...WHEELS, hueRotateDeg: 120 },
    });
    const wheels = colorWheelsUniforms(WHEELS)!;
    const base = colorBalancePixel([1, 0, 0], wheels.lift, wheels.offset, wheels.gain);
    const after = [0, 1, 2].map((channel) =>
      wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!,
    );
    const luma = 0.299 * after[0]! + 0.587 * after[1]! + 0.114 * after[2]!;
    const cb = -0.168736 * after[0]! - 0.331264 * after[1]! + 0.5 * after[2]!;
    const cr = 0.5 * after[0]! - 0.418688 * after[1]! - 0.081312 * after[2]!;
    const angle = (120 * Math.PI) / 180;
    const rotatedCb = cb * Math.cos(angle) - cr * Math.sin(angle);
    const rotatedCr = cb * Math.sin(angle) + cr * Math.cos(angle);
    const hue = [
      luma + 1.402 * rotatedCr,
      luma - 0.344136 * rotatedCb - 0.714136 * rotatedCr,
      luma + 1.772 * rotatedCb,
    ].map((value) => Math.min(1, Math.max(0, value)));
    return { project, expected: hue.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'match' || CASE === 'lookmatch') {
    // colorchannelmixer del colorMatch: ganancia por canal sobre gris 128.
    const colorMatch = { r: 1.5, g: 0.5, b: 1.25, strength: 1 };
    project =
      CASE === 'lookmatch'
        ? ({ ...project, look: { colorMatch } } as ProjectDocument)
        : updateClip(project, added.clipId, { effects: { colorMatch } });
    return {
      project,
      expected: [
        Math.round(128 * 1.5),
        Math.round(128 * 0.5),
        Math.round(128 * 1.25),
      ],
    };
  }
  if (CASE === 'tone' || CASE === 'looktone') {
    // Curva maestra de sombras antes de las curvas; gris 64 (#404040).
    const tone = toneCurveTable({ shadows: 0.8 })!;
    const value = Math.round((tone[64]! / 255) * 255);
    project =
      CASE === 'looktone'
        ? ({ ...project, look: { shadows: 0.8 } } as ProjectDocument)
        : updateClip(project, added.clipId, { effects: { shadows: 0.8 } });
    return { project, expected: [value, value, value] };
  }
  if (CASE === 'lookbrightness') {
    // El brillo del look se aplica como colorbalance de sombras (aditivo).
    project = { ...project, look: { brightness: 0.5 } } as ProjectDocument;
    const knobs: [number, number, number] = [0.5, 0.5, 0.5];
    const graded = colorBalancePixel(
      [128 / 255, 128 / 255, 128 / 255],
      knobs,
      knobs,
      knobs,
    );
    return { project, expected: graded.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'hslselective' || CASE === 'hslmasked') {
    // Camino selectivo de huesaturation: rojo entra en `r`, no en `g`.
    const colors = CASE === 'hslselective' ? ['r'] : ['g'];
    const hsl = { hue: 90, saturation: 0.2, intensity: 0.1, colors };
    project = updateClip(project, added.clipId, { effects: { hsl } });
    return {
      project,
      expected: applySelectiveHsl(
        hslMatrixRows(hsl),
        hslColorMask(colors),
        [255, 0, 0],
      ),
    };
  }
  if (CASE === 'lookhslselective') {
    // La máscara selectiva también se aplica en el look global (por capa).
    const colors = ['r'];
    const hsl = { hue: 90, saturation: 0.2, intensity: 0.1, colors };
    project = { ...project, look: { hsl } } as ProjectDocument;
    return {
      project,
      expected: applySelectiveHsl(
        hslMatrixRows(hsl),
        hslColorMask(colors),
        [255, 0, 0],
      ),
    };
  }
  if (CASE === 'hsl' || CASE === 'lookhsl') {
    // huesaturation (colors=a) del clip o del look sobre rojo.
    const hsl = { hue: 30, saturation: 0.2, intensity: 0.1 };
    project =
      CASE === 'lookhsl'
        ? ({ ...project, look: { hsl } } as ProjectDocument)
        : updateClip(project, added.clipId, { effects: { hsl } });
    return { project, expected: applyHslMatrix(hslMatrixRows(hsl), [255, 0, 0]) };
  }
  if (CASE === 'looksaturation') {
    // Saturación del look en el shader, sin efectos en el clip.
    project = { ...project, look: { saturation: 0.5 } } as ProjectDocument;
    const source = [1, 0, 0];
    const luma = 0.299 * source[0]! + 0.587 * source[1]! + 0.114 * source[2]!;
    const out = source.map((value) => luma + (value - luma) * 0.5);
    return { project, expected: out.map((value) => Math.round(value * 255)) };
  }
  if (CASE === 'saturation' || CASE === 'hue') {
    // Sin ruedas: estos efectos deben activar el pase exacto por sí solos.
    const source = [1, 0, 0];
    if (CASE === 'saturation') {
      project = updateClip(project, added.clipId, { effects: { saturation: 0.5 } });
      const luma = 0.299 * source[0]! + 0.587 * source[1]! + 0.114 * source[2]!;
      const out = source.map((value) => luma + (value - luma) * 0.5);
      return { project, expected: out.map((value) => Math.round(value * 255)) };
    }
    project = updateClip(project, added.clipId, { effects: { hueRotateDeg: 120 } });
    const luma = 0.299 * source[0]! + 0.587 * source[1]! + 0.114 * source[2]!;
    const cb = -0.168736 * source[0]! - 0.331264 * source[1]! + 0.5 * source[2]!;
    const cr = 0.5 * source[0]! - 0.418688 * source[1]! - 0.081312 * source[2]!;
    const angle = (120 * Math.PI) / 180;
    const rotatedCb = cb * Math.cos(angle) - cr * Math.sin(angle);
    const rotatedCr = cb * Math.sin(angle) + cr * Math.cos(angle);
    const out = [
      luma + 1.402 * rotatedCr,
      luma - 0.344136 * rotatedCb - 0.714136 * rotatedCr,
      luma + 1.772 * rotatedCb,
    ];
    return {
      project,
      expected: out.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255)),
    };
  }
  if (CASE === 'wheelsgray' || CASE === 'wheelssepia') {
    // Export: ruedas/gamma → curvas (sin curvas) → grayscale/sepia.
    const gray = CASE === 'wheelsgray';
    project = updateClip(project, added.clipId, {
      effects: gray ? { ...WHEELS, grayscale: true } : { ...WHEELS, sepia: true },
    });
    const wheels = colorWheelsUniforms(WHEELS)!;
    const base = colorBalancePixel([1, 0, 0], wheels.lift, wheels.offset, wheels.gain);
    const after = [0, 1, 2].map((channel) =>
      wheels.gamma ? sampleGamma(wheels.gamma, channel, base[channel]!) : base[channel]!,
    );
    const expected = gray
      ? Array.from({ length: 3 }, () => {
          const luma = 0.299 * after[0]! + 0.587 * after[1]! + 0.114 * after[2]!;
          return Math.round(luma * 255);
        })
      : [
          after[0]! * 0.393 + after[1]! * 0.769 + after[2]! * 0.189,
          after[0]! * 0.349 + after[1]! * 0.686 + after[2]! * 0.168,
          after[0]! * 0.272 + after[1]! * 0.534 + after[2]! * 0.131,
        ].map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
    return { project, expected };
  }
  if (CASE === 'lookwheels') {
    project = { ...project, look: WHEELS } as ProjectDocument;
    return { project, expected: expectedForWheels(WHEELS) };
  }
  project = updateClip(project, added.clipId, { effects: WHEELS });
  return { project, expected: expectedForWheels(WHEELS) };
}

function Harness() {
  const { project, expected } = useMemo(buildProject, []);
  const service = useMemo(
    () =>
      ({
        mediaUrl: () =>
          CASE === 'brightness' ||
          CASE === 'brightnessonly' ||
          CASE === 'temperature' || CASE === 'wheelscontrast'
            ? '/e2e/fixtures/gray.svg'
            : CASE === 'wheelssaturation' ||
                CASE === 'wheelsshue' ||
                CASE === 'wheelsgray' ||
                CASE === 'wheelssepia' ||
                CASE === 'saturation' ||
                CASE === 'hue' ||
                CASE === 'looksaturation' ||
                CASE === 'hsl' ||
                CASE === 'hslselective' ||
                CASE === 'hslmasked' ||
                CASE === 'lookhslselective' ||
                CASE === 'lookhsl'
              ? '/e2e/fixtures/red.svg'
              : CASE === 'lookbrightness'
                ? '/e2e/fixtures/gray.svg'
                : CASE === 'tone' || CASE === 'looktone'
                  ? '/e2e/fixtures/dark.svg'
                  : CASE === 'match' || CASE === 'lookmatch'
                    ? '/e2e/fixtures/gray.svg'
                    : '/e2e/fixtures/white.svg',
      }) as unknown as DesktopService,
    [],
  );
  const opened = useMemo(
    () => ({ project, label: 'preview.editoria.json', path: 'C:\\tmp\\preview.editoria.json', root: 'C:\\tmp' }),
    [project],
  );

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + 40_000;
    const fail = (reason: string) => {
      if (cancelled) return;
      (window as unknown as { __previewHarness: unknown }).__previewHarness = {
        ok: false,
        reason,
      };
      document.getElementById('status')!.textContent = `error: ${reason}`;
    };
    const attempt = () => {
      if (cancelled) return;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.effect-preview-canvas');
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        if (Date.now() > deadline) fail('sin canvas dibujado');
        else requestAnimationFrame(attempt);
        return;
      }
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      if (!context) {
        fail('sin contexto 2D para leer');
        return;
      }
      context.drawImage(canvas, 0, 0);
      const sample = Array.from(
        context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data,
      );
      // Espera a que el shader (o el fallback) haya pintado algo.
      if ((sample[3] ?? 0) === 0) {
        if (Date.now() > deadline) fail('canvas vacío');
        else requestAnimationFrame(attempt);
        return;
      }
      (window as unknown as { __previewHarness: unknown }).__previewHarness = {
        ok: true,
        sample,
        expected,
        canvas: [canvas.width, canvas.height],
      };
      document.getElementById('status')!.textContent = 'done';
    };
    requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
    };
  }, [expected]);

  return (
    <div style={{ width: 640, height: 360, position: 'relative' }}>
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Preview />
      </ProjectProvider>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
