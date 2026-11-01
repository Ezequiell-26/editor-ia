import { expect, test } from '@playwright/test';

/** Three.js renderiza dos frames distintos en WebGL real y hornea un MP4 VP9. */
test('la escena 3D renderiza frames y hornea un video', async ({ page }) => {
  await page.goto('/e2e/three-harness/index.html');
  await page.waitForFunction(
    () =>
      (window as unknown as { __threeProbe?: unknown }).__threeProbe !== undefined,
    null,
    { timeout: 60_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __threeProbe?: {
          ok?: boolean;
          webgl?: boolean;
          encoded?: boolean;
          pixelsFirst?: number;
          pixelsLast?: number;
          diff?: number;
          encodedBytes?: number;
          videoWidth?: number;
          videoHeight?: number;
          fps?: number;
          duration?: number;
          reason?: string;
        };
      }).__threeProbe ?? null,
  );
  console.log('three probe', JSON.stringify(probe));
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.webgl).toBe(true);
  expect(probe?.encoded).toBe(true);
  expect(probe?.pixelsFirst ?? 0).toBeGreaterThan(1000);
  expect(probe?.pixelsLast ?? 0).toBeGreaterThan(1000);
  expect(probe?.diff ?? 0).toBeGreaterThan(100_000);
  expect(probe?.encodedBytes ?? 0).toBeGreaterThan(2_000);
  expect(probe?.videoWidth).toBe(320);
  expect(probe?.videoHeight).toBe(180);
  expect(probe?.fps).toBe(12);
  expect(probe?.duration).toBe(1);
  expect(probe?.ok).toBe(true);
});
