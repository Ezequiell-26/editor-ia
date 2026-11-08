import { test, expect } from '@playwright/test';
import { enterApp, clickNav } from './helpers';

// Auditoría visual temporal de la fase 2 de CSS splitting.
// Compara screenshots de TODAS las vistas navegables entre el app.css
// monolítico (baseline 3a22c73) y el split por entries. NO commitear.
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
