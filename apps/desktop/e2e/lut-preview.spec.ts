import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

interface LutHarnessResult {
  readonly webgl: boolean;
  readonly invertDiff: number;
  readonly halfDiff: number;
  readonly curveDiff: number;
  readonly gradedDiff: number;
  readonly denoiseBefore: number;
  readonly denoiseAfter: number;
  readonly denoiseReduction: number;
  readonly vignetteCenter: number;
  readonly vignetteCorner: number;
  readonly vignetteGrayCenter: number;
  readonly vignetteGrayCorner: number;
  readonly vignetteGrayMid: number;
  readonly vignetteGraySide: number;
  readonly plainCenter: number;
  readonly plainCorner: number;
}

/** Muestrea el FFmpeg empaquetado con la misma fórmula `vignette` del export. */
function ffmpegVignetteGray(): {
  center: number;
  corner: number;
  mid: number;
  side: number;
} | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ffmpeg = path.join(here, '..', 'src-tauri', 'resources', 'ffmpeg', 'ffmpeg.exe');
  if (!existsSync(ffmpeg)) return null;
  const raw = execFileSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=256x144:d=1',
      // El shader trabaja en RGB: se fuerza el mismo formato para comparar la
      // fórmula espacial; la cadena del export opera en YUV (ver límites).
      '-vf',
      'format=rgb24,vignette=PI/3',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 1_000_000 },
  );
  const at = (x: number, y: number): number => raw[(y * 256 + x) * 3] ?? 0;
  return {
    center: at(128, 72),
    corner: at(10, 10),
    mid: at(40, 30),
    side: at(48, 72),
  };
}


/**
 * Verificación real del shader LUT en Chrome: la salida WebGL2 debe coincidir
 * con la interpolación trilineal de JS (la misma que usan los tests unitarios)
 * y el grade del clip debe aplicarse antes del LUT, como en el export.
 */
test('el shader LUT coincide con la interpolación JS y aplica el grade antes', async ({
  page,
}) => {
  await page.goto('/e2e/lut-harness/index.html');
  await expect(page.locator('#status')).not.toHaveText('running', { timeout: 60_000 });
  const result = await page.evaluate(
    () => (window as unknown as { __lutHarness?: LutHarnessResult }).__lutHarness ?? null,
  );
  expect(result, 'el harness debe publicar sus mediciones').not.toBeNull();
  const measured = result as LutHarnessResult;
  expect(measured.webgl, 'Chrome debe exponer WebGL2').toBe(true);
  // Un paso de 8 bits por redondeo del texture RGBA8 es aceptable.
  expect(measured.invertDiff).toBeLessThanOrEqual(2);
  expect(measured.halfDiff).toBeLessThanOrEqual(2);
  expect(measured.curveDiff).toBeLessThanOrEqual(2);
  expect(measured.gradedDiff).toBeLessThanOrEqual(2);
  // El bilateral baja la desviación del ruido sin destruir el borde de color.
  expect(measured.denoiseBefore).toBeGreaterThan(10);
  expect(measured.denoiseAfter).toBeGreaterThan(0);
  expect(measured.denoiseReduction).toBeGreaterThan(0.25);
  expect(measured.denoiseReduction).toBeLessThan(0.95);
  // La viñeta oscurece el borde y deja el centro casi intacto.
  expect(measured.plainCorner).toBeGreaterThan(200);
  expect(measured.vignetteCorner).toBeLessThan(measured.plainCorner * 0.8);
  expect(measured.vignetteCenter).toBeGreaterThan(measured.plainCenter * 0.9);
  // Paridad real del factor espacial con vf_vignette (PI/3 = fuerza 0,5).
  const reference = ffmpegVignetteGray();
  expect(reference, 'el FFmpeg empaquetado debe estar disponible').not.toBeNull();
  for (const [sample, expected] of [
    [measured.vignetteGrayCenter, reference?.center ?? 0],
    [measured.vignetteGrayCorner, reference?.corner ?? 0],
    [measured.vignetteGrayMid, reference?.mid ?? 0],
    [measured.vignetteGraySide, reference?.side ?? 0],
  ] as const) {
    expect(Math.abs(sample - expected)).toBeLessThanOrEqual(2);
  }
});

/**
 * El componente real debe montar su canvas, cargar el `.cube` por el servicio
 * del proyecto y quedar `ready` con una imagen. Sin WebGL2 el estado seguiría
 * en `waiting` y la imagen original quedaría visible.
 */
test('la capa LUT monta y dibuja con una imagen y un .cube reales', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  const overlay = page.locator('canvas.effect-preview-canvas');
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box?.width).toBeCloseTo(320, 0);
  expect(box?.height).toBeCloseTo(180, 0);
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __overlayHarness?: Record<string, number[]> }).__overlayHarness ??
      null,
  );
  // El .cube invierte: blanco→negro, negro→blanco, rojo→cian y gris ~igual.
  expect(samples?.white?.slice(0, 3)).toEqual([0, 0, 0]);
  expect(samples?.black?.slice(0, 3)).toEqual([255, 255, 255]);
  expect(samples?.red?.slice(0, 2)).toEqual([0, 255]);
  expect(samples?.gray?.[0]).toBeGreaterThan(124);
  expect(samples?.gray?.[0]).toBeLessThan(131);
  await overlay.screenshot({ path: 'test-results/lut-overlay.png' });
});

/**
 * Los videos VP9 con alfa conservan el canal al pasar por WebGL y el color se
 * premultiplica para componer sin halos. El fixture es un rojo al 50 %.
 */
test('el LUT conserva el alfa de un video VP9 y compone correcto', async ({ page }) => {
  await page.goto('/e2e/lut-harness/alpha.html');
  await expect(page.locator('#status')).not.toHaveText('running', { timeout: 30_000 });
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __alphaProbe?: {
          draw2d: number[];
          glResult: number[] | null;
          compositeResult: number[] | null;
        };
      }).__alphaProbe ?? null,
  );
  expect(probe).not.toBeNull();
  expect(probe?.draw2d).toEqual([255, 0, 0, 127]);
  expect(probe?.glResult).toEqual([255, 0, 0, 127]);
  const composite = probe?.compositeResult;
  expect(composite?.[0]).toBeGreaterThanOrEqual(125);
  expect(composite?.[0]).toBeLessThanOrEqual(129);
  expect(composite?.[1]).toBeGreaterThanOrEqual(126);
  expect(composite?.[1]).toBeLessThanOrEqual(130);
  expect(composite?.[2]).toBe(0);
  expect(composite?.[3]).toBe(255);
});

/**
 * Motion blur real: un cuadro blanco se mueve sobre negro. La salida del
 * overlay acumula una estela con más píxeles y más ancho que el frame nítido.
 */
test('el motion blur acumula una estela real en la preview', async ({ page }) => {
  await page.goto('/e2e/lut-harness/motion.html');
  await expect(page.locator('#motion-status')).toHaveText('done', { timeout: 60_000 });
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __motionProbe?: {
          ready: boolean;
          sharpCount: number;
          blurCount: number;
          sharpWidth: number;
          blurWidth: number;
        };
      }).__motionProbe ?? null,
  );
  expect(probe?.ready).toBe(true);
  expect(probe?.sharpCount).toBeGreaterThan(30);
  expect(probe?.blurCount).toBeGreaterThan((probe?.sharpCount ?? 0) * 1.6);
  expect(probe?.blurWidth).toBeGreaterThan((probe?.sharpWidth ?? 0) + 8);
});

/**
 * Orden con motion blur: la curva se aplica a cada frame antes de acumular,
 * como el export. Dos seeks controlados (rojo y verde) dejan una sola
 * acumulación; con la curva por frame el centro es (255·(1−a), 255·a), y si
 * se aplicara después de acumular cada canal pasaría por la curva y el verde
 * subiría muy por encima de 255·a.
 */
test('el motion blur aplica la curva antes de acumular', async ({ page }) => {
  await page.goto('/e2e/lut-harness/motion.html?curve=1');
  await expect(page.locator('#motion-status')).toHaveText('done', { timeout: 60_000 });
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __motionProbe?: { ready: boolean; center?: number[]; expectedCenter?: number[] };
      }).__motionProbe ?? null,
  );
  expect(probe?.ready).toBe(true);
  const center = probe?.center ?? [];
  const want = probe?.expectedCenter ?? [];
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs((center[channel] ?? 0) - (want[channel] ?? 0))).toBeLessThanOrEqual(8);
  }
  expect(center[3]).toBe(255);
});

/**
 * Orden del look global: clip LUT → grade del look → look LUT. Con dos LUT
 * invertidos y `brightness(0.5)` en medio, el blanco vuelve blanco; si el
 * grade se aplicara al final quedaría gris 128.
 */
test('el grade del look se aplica entre el LUT del clip y el del look', async ({ page }) => {
  await page.goto('/e2e/lut-harness/lookgrade.html');
  await expect(page.locator('#lookgrade-status')).toHaveText('ready', { timeout: 30_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as {
        __lookGradeHarness?: Record<string, number[]>;
      }).__lookGradeHarness ?? null,
  );
  expect(samples, 'el harness debe publicar sus muestras').not.toBeNull();
  expect(samples?.white?.[0]).toBeGreaterThanOrEqual(250);
  expect(samples?.white?.[1]).toBeGreaterThanOrEqual(250);
  expect(samples?.white?.[2]).toBeGreaterThanOrEqual(250);
  expect(samples?.black?.[0]).toBeGreaterThan(115);
  expect(samples?.black?.[0]).toBeLessThan(140);
  expect(samples?.red?.[0]).toBeGreaterThanOrEqual(250);
  expect(samples?.red?.[1]).toBeGreaterThan(115);
  expect(samples?.red?.[1]).toBeLessThan(140);
  expect(samples?.red?.[2]).toBeGreaterThan(115);
  expect(samples?.red?.[2]).toBeLessThan(140);
  expect(samples?.gray?.[0]).toBeGreaterThan(180);
  expect(samples?.gray?.[0]).toBeLessThan(205);
});

/**
 * El fallback 2D de imágenes (sin WebGL2) también respeta el orden del look:
 * clip LUT → grade → look LUT, con los mismos valores que la pasada WebGL.
 */
test('el fallback 2D conserva el orden del look', async ({ page }) => {
  await page.goto('/e2e/lut-harness/lookgrade.html?fallback=1');
  await expect(page.locator('#lookgrade-status')).toHaveText('ready', { timeout: 30_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as {
        __lookGradeHarness?: Record<string, number[]>;
      }).__lookGradeHarness ?? null,
  );
  expect(samples, 'el harness 2D debe publicar sus muestras').not.toBeNull();
  expect(samples?.white?.[0]).toBeGreaterThanOrEqual(250);
  expect(samples?.black?.[0]).toBeGreaterThan(115);
  expect(samples?.black?.[0]).toBeLessThan(140);
  expect(samples?.red?.[0]).toBeGreaterThanOrEqual(250);
  expect(samples?.red?.[1]).toBeGreaterThan(115);
  expect(samples?.red?.[1]).toBeLessThan(140);
  expect(samples?.gray?.[0]).toBeGreaterThan(180);
  expect(samples?.gray?.[0]).toBeLessThan(205);
});

/** LUT `.cube` 1D: la rampa se aplica por canal con el shader WebGL2. */
test('el componente aplica un .cube 1D por canal en WebGL', async ({ page }) => {
  await page.goto('/e2e/lut-harness/lut1d.html');
  await expect(page.locator('#lut1d-status')).toHaveText('ready', { timeout: 30_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __lut1dHarness?: Record<string, number[]> }).__lut1dHarness ??
      null,
  );
  expect(samples).not.toBeNull();
  expect(samples?.white?.slice(0, 3)).toEqual([0, 0, 0]);
  expect(samples?.black?.slice(0, 3)).toEqual([255, 255, 255]);
  expect(samples?.red?.slice(0, 2)).toEqual([0, 255]);
  expect(samples?.gray?.[0]).toBeGreaterThan(124);
  expect(samples?.gray?.[0]).toBeLessThan(131);
});

/** El fallback 2D también interpola la rampa 1D por canal. */
test('el fallback 2D aplica un .cube 1D por canal', async ({ page }) => {
  await page.goto('/e2e/lut-harness/lut1d.html?fallback=1');
  await expect(page.locator('#lut1d-status')).toHaveText('ready', { timeout: 30_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __lut1dHarness?: Record<string, number[]> }).__lut1dHarness ??
      null,
  );
  expect(samples).not.toBeNull();
  expect(samples?.white?.slice(0, 3)).toEqual([0, 0, 0]);
  expect(samples?.black?.slice(0, 3)).toEqual([255, 255, 255]);
  expect(samples?.red?.slice(0, 2)).toEqual([0, 255]);
  expect(samples?.gray?.[0]).toBeGreaterThan(124);
  expect(samples?.gray?.[0]).toBeLessThan(131);
});

/** El componente temporal del denoise mezcla un frame previo con umbral. */
test('el denoise temporal reduce ruido con un frame previo', async ({ page }) => {
  await page.goto('/e2e/lut-harness/temporal.html');
  await page.waitForFunction(
    () =>
      (window as unknown as { __temporalProbe?: unknown }).__temporalProbe !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __temporalProbe?: {
          webgl: boolean;
          control: number;
          temporal: number;
          temporal2: number;
          reduction: number;
          reduction2: number;
        };
      }).__temporalProbe ?? null,
  );
  expect(probe?.webgl).toBe(true);
  expect(probe?.control).toBeGreaterThan(5);
  expect(probe?.temporal).toBeLessThan((probe?.control ?? 0) * 0.92);
  expect(probe?.reduction).toBeGreaterThan(0.08);
  // El segundo frame anterior suma una muestra temporal extra.
  expect(probe?.temporal2).toBeLessThan(probe?.temporal ?? 0);
  expect(probe?.reduction2).toBeGreaterThan(probe?.reduction ?? 0);
});

/**
 * Orden del temporal: el export gradúa (curvas) antes de `atadenoise`. El
 * shader debe comparar y mezclar los píxeles ya graduados; con una curva de
 * escalón, mezclar antes de graduar se aleja decenas de niveles.
 */
test('el denoise temporal gradúa antes de mezclar', async ({ page }) => {
  await page.goto('/e2e/lut-harness/temporal.html?graded=1');
  await page.waitForFunction(
    () =>
      (window as unknown as { __temporalProbe?: unknown }).__temporalProbe !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __temporalProbe?: {
          webgl: boolean;
          graded: boolean;
          maxDiff: number;
          meanDiff: number;
          oldDiff: number;
        };
      }).__temporalProbe ?? null,
  );
  expect(probe?.webgl).toBe(true);
  expect(probe?.graded).toBe(true);
  expect(probe?.maxDiff).toBeLessThanOrEqual(2);
  expect(probe?.meanDiff).toBeLessThan(0.5);
  expect(probe?.oldDiff).toBeGreaterThan(30);
});

/** La integración de EffectOverlay reutiliza el historial temporal real. */
test('el historial temporal del overlay reduce el ruido del video en vivo', async ({ page }) => {
  await page.goto('/e2e/lut-harness/temporal-overlay.html');
  await page.waitForFunction(
    () =>
      (window as unknown as { __temporalOverlay?: unknown }).__temporalOverlay !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __temporalOverlay?: {
          spatial: number;
          temporal: number;
          reduction: number;
        };
      }).__temporalOverlay ?? null,
  );
  expect(probe?.spatial).toBeGreaterThan(1.5);
  expect(probe?.temporal).toBeLessThan((probe?.spatial ?? 0) * 0.95);
  expect(probe?.reduction).toBeGreaterThan(0.05);
});

/** El pase de curvas del shader coincide con la tabla JS y respeta canales. */
test('el shader aplica las curvas del clip antes del LUT', async ({ page }) => {
  await page.goto('/e2e/lut-harness/curves.html');
  await page.waitForFunction(
    () => (window as unknown as { __curves?: unknown }).__curves !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __curves?: {
          ok?: boolean;
          samples?: number[][];
          expected?: number[][];
        };
      }).__curves ?? null,
  );
  expect(probe?.ok).toBe(true);
  expect(probe?.samples).toHaveLength(4);
  for (let index = 0; index < 4; index += 1) {
    const got = probe?.samples?.[index] ?? [];
    const want = probe?.expected?.[index] ?? [];
    expect(Math.abs(got[0]! - want[0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(got[1]! - want[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(got[2]! - want[2]!)).toBeLessThanOrEqual(1);
    expect(got[3]).toBe(255);
  }
});

/** El chroma key calcula el alfa con la ventana 3×3 y el UV de FFmpeg. */
test('el shader aplica el chroma key y coincide con la referencia JS', async ({ page }) => {
  await page.goto('/e2e/lut-harness/chroma.html');
  await page.waitForFunction(
    () => (window as unknown as { __chroma?: unknown }).__chroma !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __chroma?: {
          ok?: boolean;
          samples?: Record<string, { rgba: number[]; expected: number }>;
        };
      }).__chroma ?? null,
  );
  expect(probe?.ok).toBe(true);
  expect(probe?.samples?.green?.rgba?.[3]).toBe(0);
  expect(probe?.samples?.red?.rgba?.[3]).toBe(255);
  expect(probe?.samples?.red?.rgba?.[0]).toBeGreaterThan(240);
  for (const name of ['green', 'red', 'edgeLeft', 'edgeRight']) {
    const sample = probe?.samples?.[name];
    expect(Math.abs((sample?.rgba?.[3] ?? 0) - (sample?.expected ?? 0))).toBeLessThanOrEqual(2);
  }
});

/** El componente real aplica el chroma key y deja ver el fondo. */
test('la capa de efectos dibuja el chroma key del clip', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?chroma=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __overlayHarness?: Record<string, number[]> }).__overlayHarness ??
      null,
  );
  expect(samples?.green?.[3]).toBe(0);
  expect(samples?.red?.[3]).toBe(255);
  expect(samples?.red?.[0]).toBeGreaterThan(240);
});

/** Las ruedas de color del shader coinciden con la referencia JS. */
test('el shader aplica las ruedas de color y la gamma', async ({ page }) => {
  await page.goto('/e2e/lut-harness/wheels.html');
  await page.waitForFunction(
    () => (window as unknown as { __wheels?: unknown }).__wheels !== undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __wheels?: { ok?: boolean; samples?: number[][]; expected?: number[][] };
      }).__wheels ?? null,
  );
  expect(probe?.ok).toBe(true);
  expect(probe?.samples).toHaveLength(4);
  for (let pixel = 0; pixel < 4; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const got = probe?.samples?.[pixel]?.[channel] ?? 0;
      const want = probe?.expected?.[pixel]?.[channel] ?? 0;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
    }
  }
});

/** El componente real aplica las ruedas de color del clip. */
test('la capa de efectos dibuja las ruedas de color', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?wheels=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const probe = await page.evaluate(() => ({
    samples: (window as unknown as { __overlayHarness?: Record<string, number[]> })
      .__overlayHarness,
    expected: (window as unknown as { __overlayExpected?: Record<string, number[]> })
      .__overlayExpected,
  }));
  for (const key of ['white', 'black', 'red', 'gray']) {
    for (let channel = 0; channel < 3; channel += 1) {
      const got = probe.samples?.[key]?.[channel] ?? 0;
      const want = probe.expected?.[key]?.[channel] ?? 0;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
    }
  }
});

/** El LUT del look no debe reaplicar curvas/ruedas/chroma del clip. */
test('el LUT del look no duplica los efectos del clip', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?look=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __overlayHarness?: Record<string, number[]> }).__overlayHarness ??
      null,
  );
  // Clip: curva roja invertida (blanco→cian). Look: brightness(0.8) y LUT
  // invertido → (255, 51, 51). Si la segunda pasada reaplicara la curva, el
  // blanco quedaría (0, 204, 204).
  expect(Math.abs((samples?.white?.[0] ?? 0) - 255)).toBeLessThanOrEqual(3);
  expect(Math.abs((samples?.white?.[1] ?? 0) - 51)).toBeLessThanOrEqual(3);
  expect(Math.abs((samples?.white?.[2] ?? 0) - 51)).toBeLessThanOrEqual(3);
});

/** Las ruedas del look se aplican entre el grade y el LUT del look. */
test('la capa de efectos dibuja las ruedas del look', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?lookwheels=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const probe = await page.evaluate(() => ({
    samples: (window as unknown as { __overlayHarness?: Record<string, number[]> })
      .__overlayHarness,
    expected: (window as unknown as { __overlayExpected?: Record<string, number[]> })
      .__overlayExpected,
  }));
  for (const key of ['white', 'black', 'red', 'gray']) {
    for (let channel = 0; channel < 3; channel += 1) {
      const got = probe.samples?.[key]?.[channel] ?? 0;
      const want = probe.expected?.[key]?.[channel] ?? 0;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
    }
  }
});

/** Ruedas del look → grade del look → LUT del look, como el export. */
test('el look compone ruedas, grade y LUT en orden', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?lookall=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const probe = await page.evaluate(() => ({
    samples: (window as unknown as { __overlayHarness?: Record<string, number[]> })
      .__overlayHarness,
    expected: (window as unknown as { __overlayExpected?: Record<string, number[]> })
      .__overlayExpected,
  }));
  for (let channel = 0; channel < 3; channel += 1) {
    const got = probe.samples?.white?.[channel] ?? 0;
    const want = probe.expected?.white?.[channel] ?? 0;
    expect(Math.abs(got - want)).toBeLessThanOrEqual(3);
  }
});

/** El grade del look sin LUT se devuelve al canvas visible. */
test('el grade del look sin LUT se dibuja en el canvas', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?lookgrade=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const probe = await page.evaluate(() => ({
    samples: (window as unknown as { __overlayHarness?: Record<string, number[]> })
      .__overlayHarness,
    expected: (window as unknown as { __overlayExpected?: Record<string, number[]> })
      .__overlayExpected,
  }));
  // Blanco → curva roja invertida (cian) → grade 0.8, sin LUT del look.
  for (let channel = 0; channel < 3; channel += 1) {
    const got = probe.samples?.white?.[channel] ?? 0;
    const want = probe.expected?.white?.[channel] ?? 0;
    expect(Math.abs(got - want)).toBeLessThanOrEqual(3);
  }
});

/** Integración real de Preview: ruedas del look global. */
test('Preview aplica las ruedas del look', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=lookwheels');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 40_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0))).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** Integración real de Preview: ruedas + brillo en el shader. */
test('Preview aplica ruedas y brillo sin doble grade', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=wheels');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0))).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** Integración real de Preview: curvas del clip antes del LUT. */
test('Preview aplica las curvas del clip', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=curves');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: { ok?: boolean; sample?: number[]; reason?: string };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  expect(probe?.sample?.[0]).toBeLessThan(4);
  expect(probe?.sample?.[1]).toBeGreaterThan(251);
  expect(probe?.sample?.[2]).toBeGreaterThan(251);
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * Integración real de Preview: el brillo va al shader cuando el overlay ya
 * está activo (aquí, por las curvas), así el resultado coincide con el export
 * aditivo y no con la aproximación CSS multiplicativa.
 */
test('Preview aplica el brillo en el shader junto a las curvas', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=brightness');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  // Gris 128 + curva roja invertida + brillo aditivo: (216, 217, 217).
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * El brillo como único efecto también usa el pase exacto fuera del perfil
 * eficiente: `colorbalance` con los tres rangos en +0,5, no el CSS 192.
 */
test('Preview usa el pase exacto para el brillo solo', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=brightnessonly');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  expect(probe?.expected?.[0]).toBeGreaterThan(200);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** El shader aplica ruedas y gamma antes de las curvas, como el export. */
test('Preview aplica ruedas y gamma antes de la curva', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=wheelscurves');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * La temperatura del clip usa el colorbalance de sombras del export y ya no
 * la aproximación sepia: el gris central coincide con la referencia JS.
 */
test('Preview aplica la temperatura con colorbalance', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=temperature');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * El contraste va después de ruedas/gamma, como el export; la fórmula es la
 * misma que CSS, así que el orden se prueba con ruedas + contraste sobre gris.
 */
test('Preview aplica el contraste después de las ruedas', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=wheelscontrast');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * La saturación del shader usa luma BT.601 como `hue=s` del export, después
 * de ruedas/gamma; la de CSS (Rec.709) se omite cuando el shader la aplica.
 */
test('Preview aplica la saturación con luma BT.601', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=wheelssaturation');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/**
 * El giro de tono del shader rota Cb/Cr BT.601 como `hue=h` del export; la
 * matriz CSS es distinta (rojo+120°: FFmpeg 0/177/0 vs CSS 0/255/0).
 */
test('Preview aplica el giro de tono con la matriz BT.601', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=wheelsshue');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(3);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** HSL usa la matriz de huesaturation (colors=a) del export. */
for (const [mode, label] of [
  ['hsl', 'el HSL del clip'],
  ['lookhsl', 'el HSL del look'],
] as const) {
  test(`Preview aplica ${label} con la matriz de FFmpeg`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** HSL selectivo: huesaturation aplica la matriz sólo a los rangos elegidos. */
for (const [mode, label] of [
  ['hslselective', 'el rango rojo'],
  ['hslmasked', 'un rango que no incluye al rojo'],
  ['lookhslselective', 'el look con el rango rojo'],
] as const) {
  test(`Preview aplica HSL selectivo con ${label}`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** El colorMatch usa la ganancia por canal de colorchannelmixer. */
for (const [mode, label] of [
  ['match', 'el colorMatch del clip'],
  ['lookmatch', 'el colorMatch del look'],
] as const) {
  test(`Preview aplica ${label} como ganancia por canal`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** Sombras/luces/fade son una curva maestra, no brillo/contraste CSS. */
for (const [mode, label] of [
  ['tone', 'las sombras del clip'],
  ['looktone', 'las sombras del look'],
] as const) {
  test(`Preview aplica ${label} como curva maestra`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** El brillo del look usa colorbalance aditivo, no CSS multiplicativo. */
test('Preview aplica el brillo del look en el shader', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=lookbrightness');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** El grade del look usa las mismas etapas exactas del shader. */
test('Preview aplica la saturación del look en el shader', async ({ page }) => {
  await page.goto('/e2e/preview-harness.html?case=looksaturation');
  await page.waitForFunction(
    () =>
      (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
      undefined,
    null,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __previewHarness?: {
          ok?: boolean;
          sample?: number[];
          expected?: number[];
          reason?: string;
        };
      }).__previewHarness ?? null,
  );
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.ok).toBe(true);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
    ).toBeLessThanOrEqual(2);
  }
  expect(probe?.sample?.[3]).toBe(255);
});

/** Sin overlay previo, saturación y giro activan el pase exacto por sí solos. */
for (const [mode, label] of [
  ['saturation', 'saturación sola'],
  ['hue', 'giro de tono solo'],
] as const) {
  test(`Preview usa el shader para ${label}`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** Grayscale y sepia del shader van después de curvas, como el export. */
for (const [mode, label] of [
  ['wheelsgray', 'escala de grises'],
  ['wheelssepia', 'sepia'],
] as const) {
  test(`Preview aplica ${label} después de las curvas`, async ({ page }) => {
    await page.goto(`/e2e/preview-harness.html?case=${mode}`);
    await page.waitForFunction(
      () =>
        (window as unknown as { __previewHarness?: { ok?: boolean } }).__previewHarness !==
        undefined,
      null,
      { timeout: 30_000 },
    );
    const probe = await page.evaluate(
      () =>
        (window as unknown as {
          __previewHarness?: {
            ok?: boolean;
            sample?: number[];
            expected?: number[];
            reason?: string;
          };
        }).__previewHarness ?? null,
    );
    expect(probe?.reason ?? '').toBe('');
    expect(probe?.ok).toBe(true);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((probe?.sample?.[channel] ?? 0) - (probe?.expected?.[channel] ?? 0)),
      ).toBeLessThanOrEqual(2);
    }
    expect(probe?.sample?.[3]).toBe(255);
  });
}

/** El panel real reproduce la miniatura animada del efecto al hover. */
test('el panel de efectos reproduce la miniatura animada', async ({ page }) => {
  await page.goto('/e2e/effects-browser-harness.html');
  const card = page.locator('.effect-card').filter({ hasText: 'Brillo' }).first();
  await card.hover();
  const video = card.locator('video.effect-thumb-preview');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).readyState), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/effect-thumb-hover.png' });
  await page.mouse.move(2, 2);
  await expect(video).toHaveCount(0);
});

/** El componente real aplica las curvas del clip cuando no hay LUT. */
test('la capa de efectos dibuja las curvas del clip sin LUT', async ({ page }) => {
  await page.goto('/e2e/lut-harness/overlay.html?curves=1');
  await expect(page.locator('#overlay-status')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.locator('#overlay-samples')).not.toHaveText('', { timeout: 10_000 });
  const samples = await page.evaluate(
    () =>
      (window as unknown as { __overlayHarness?: Record<string, number[]> }).__overlayHarness ??
      null,
  );
  // Curva roja invertida: blanco→cian, negro→rojo, gris 128→(127,128,128).
  expect(samples?.white?.slice(0, 3)).toEqual([0, 255, 255]);
  expect(samples?.black?.slice(0, 3)).toEqual([255, 0, 0]);
  expect(samples?.gray?.[0]).toBeGreaterThan(124);
  expect(samples?.gray?.[0]).toBeLessThan(131);
  expect(samples?.gray?.[1]).toBeGreaterThan(124);
  expect(samples?.gray?.[2]).toBeGreaterThan(124);
});
