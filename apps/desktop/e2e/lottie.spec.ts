import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { enterApp } from './helpers';

const fixture = path.resolve(process.cwd(), 'e2e', 'fixtures', 'lottie-sample.json');
const animationData = JSON.parse(readFileSync(fixture, 'utf8')) as unknown;

test('la preview Lottie rasteriza la animación con alfa real', async ({ page }) => {
  await enterApp(page);
  await page.locator('.sidebar button[aria-label="Motion"]').click();
  await expect(page.getByRole('heading', { name: 'Lottie (.json)' })).toBeVisible();

  await page.setInputFiles('input[aria-label="Archivo Lottie"]', fixture);
  await expect(page.getByText(/Original: 200×200 px/)).toBeVisible();
  await expect(page.getByText(/60 frames/)).toBeVisible();

  const canvas = page.locator('[aria-label="Previsualización Lottie"] canvas');
  await expect(canvas).toBeVisible();

  const measure = () =>
    canvas.evaluate((node) => {
      const element = node as HTMLCanvasElement;
      const context = element.getContext('2d');
      if (!context) return null;
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      let opaque = 0;
      let transparent = 0;
      let red = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] ?? 0;
        if (alpha > 240) {
          opaque += 1;
          if ((pixels[index] ?? 0) > 200 && (pixels[index + 1] ?? 255) < 60) red += 1;
        } else if (alpha === 0) {
          transparent += 1;
        }
      }
      return { width: element.width, height: element.height, opaque, transparent, red };
    });

  await expect.poll(async () => (await measure())?.red ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);

  const result = await measure();
  expect(result).not.toBeNull();
  expect(result!.width).toBeGreaterThan(0);
  expect(result!.opaque).toBeGreaterThan(0);
  expect(result!.transparent).toBeGreaterThan(result!.width * result!.height * 0.5);
});

test('el rasterizador de conversión produce PNG con alfa y frames distintos', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({
    type: 'module',
    content: `
      import { createLottieRasterizer, parseLottieDocument, planLottieExport } from '/src/features/motion/lottie.ts';
      window.__olyviaLottie = { createLottieRasterizer, parseLottieDocument, planLottieExport };
    `,
  });
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __olyviaLottie?: unknown }).__olyviaLottie),
  );

  const result = await page.evaluate(async (raw) => {
    type Rasterizer = {
      frameCount: number;
      renderFrame(index: number): Promise<string>;
      dispose(): void;
    };
    const api = (
      window as unknown as {
        __olyviaLottie: {
          parseLottieDocument(value: unknown): { width: number; height: number };
          planLottieExport(
            document: unknown,
            options: { fps: number },
          ): { frameCount: number; width: number; height: number };
          createLottieRasterizer(document: unknown, plan: unknown): Promise<Rasterizer>;
        };
      }
    ).__olyviaLottie;
    const document = api.parseLottieDocument(raw);
    const plan = api.planLottieExport(document, { fps: 30 });
    const rasterizer = await api.createLottieRasterizer(document, plan);
    const frames: {
      index: number;
      width: number;
      height: number;
      opaque: number;
      transparent: number;
      centroidX: number;
      base64: number;
    }[] = [];
    for (const index of [0, 30, 59]) {
      const base64 = await rasterizer.renderFrame(index);
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = window.document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('sin contexto 2D');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0;
      let transparent = 0;
      let sumX = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3] ?? 0;
        if (alpha > 240) {
          opaque += 1;
          sumX += (i / 4) % canvas.width;
        } else if (alpha === 0) {
          transparent += 1;
        }
      }
      frames.push({
        index,
        width: image.width,
        height: image.height,
        opaque,
        transparent,
        centroidX: opaque ? sumX / opaque : 0,
        base64: base64.length,
      });
    }
    rasterizer.dispose();
    return { frameCount: plan.frameCount, width: plan.width, height: plan.height, frames };
  }, animationData);

  expect(result.frameCount).toBe(60);
  expect(result.width).toBe(200);
  expect(result.height).toBe(200);
  const [first, middle, last] = result.frames;
  expect(first).toBeDefined();
  expect(middle).toBeDefined();
  expect(last).toBeDefined();
  expect(first!.width).toBe(200);
  expect(first!.opaque).toBeGreaterThan(3000);
  expect(first!.transparent).toBeGreaterThan(30000);
  expect(first!.base64).toBeGreaterThan(100);
  expect(first!.centroidX).toBeCloseTo(49.5, 0);
  expect(middle!.centroidX).toBeGreaterThan(first!.centroidX + 30);
  expect(last!.centroidX).toBeGreaterThan(middle!.centroidX + 30);
});
