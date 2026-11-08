import { test, expect } from '@playwright/test';
import { enterApp, clickNav } from './helpers';

// Regresión visual de la fase 2 de CSS splitting: screenshots pixel-perfect
// (maxDiffPixelRatio 0) de TODAS las vistas navegables contra los snapshots
// commiteados en css-audit.spec.ts-snapshots/. Si un cambio de CSS es
// intencional, regenerar con `playwright test css-audit --update-snapshots`
// y revisar el diff de imágenes antes de commitear.
const VIEWS = [
  'Inicio', 'Proyectos', 'Guion', 'Medios', 'Producción', 'Editor',
  'Descargar', 'Creador', 'Laboratorio', 'Aprender',
  'Director', 'AI Hub', 'MCP',
];

for (const label of VIEWS) {
  test(`css-audit · ${label}`, async ({ page }) => {
    await enterApp(page);
    await clickNav(page, label);
    await expect(page.locator('main.content')).not.toBeEmpty();
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot(`${label}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0,
    });
  });
}
