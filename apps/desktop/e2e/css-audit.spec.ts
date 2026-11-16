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
    // AI Hub consulta el proveedor de forma async; sin Tauri el fetch rechaza
    // y aparece el aviso de error. Esperar a que ese estado asiente para que
    // el screenshot sea determinista.
    if (label === 'AI Hub') {
      await expect(page.locator('.localization-provider')).toContainText(
        'No se pudo leer el proveedor',
      );
    }
    // Esperar a que las webfonts asienten: si una fuente llega tarde, el wrap
    // del texto cambia y las tarjetas se recorren unos píxeles (diff fantasma).
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot(`${label}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0,
    });
  });
}
