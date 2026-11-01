import { expect, test } from '@playwright/test';

/** El rig 2D dibuja poses distintas y hornea un MP4 VP9 real. */
test('el personaje 2D dibuja frames y hornea un video', async ({ page }) => {
  await page.goto('/e2e/rig-harness/index.html');
  await page.waitForFunction(
    () => (window as unknown as { __rigProbe?: unknown }).__rigProbe !== undefined,
    null,
    { timeout: 60_000 },
  );
  const probe = await page.evaluate(
    () =>
      (window as unknown as {
        __rigProbe?: {
          ok?: boolean;
          drawn?: boolean;
          encoded?: boolean;
          brightFirst?: number;
          brightLast?: number;
          diff?: number;
          encodedBytes?: number;
          videoWidth?: number;
          videoHeight?: number;
          fps?: number;
          duration?: number;
          clip?: string;
          decoded?: boolean;
          decodedWidth?: number;
          decodedHeight?: number;
          decodedDuration?: number;
          decodedPixels?: number;
          reason?: string;
        };
      }).__rigProbe ?? null,
  );
  console.log('rig probe', JSON.stringify(probe));
  expect(probe?.reason ?? '').toBe('');
  expect(probe?.drawn).toBe(true);
  expect(probe?.encoded).toBe(true);
  expect(probe?.brightFirst ?? 0).toBeGreaterThan(800);
  expect(probe?.brightLast ?? 0).toBeGreaterThan(800);
  expect(probe?.diff ?? 0).toBeGreaterThan(20_000);
  expect(probe?.encodedBytes ?? 0).toBeGreaterThan(2_000);
  expect(probe?.videoWidth).toBe(320);
  expect(probe?.videoHeight).toBe(180);
  expect(probe?.fps).toBe(12);
  expect(probe?.duration).toBe(1);
  expect(probe?.clip).toBe('walk');
  expect(probe?.decoded).toBe(true);
  expect(probe?.decodedWidth).toBe(320);
  expect(probe?.decodedHeight).toBe(180);
  expect(probe?.decodedDuration ?? 0).toBeGreaterThan(0.8);
  expect(probe?.decodedPixels ?? 0).toBeGreaterThan(500);
  expect(probe?.ok).toBe(true);
});
