import { expect, test } from '@playwright/test';
import { enterApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await enterApp(page);
});

test('la paleta de comandos se abre con Ctrl+K y filtra', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdp-panel')).toBeVisible();

  // Sin proyecto abierto, los comandos de archivo están deshabilitados y no
  // aparecen: la navegación sí está disponible.
  await page.locator('.cmdp-search input').fill('fabrica');
  const items = page.locator('.cmdp-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Fábrica');

  // Enter ejecuta el comando: navega a la Fábrica y cierra la paleta.
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdp-panel')).toHaveCount(0);
  await expect(page.locator('.sidebar button[aria-label="Fábrica"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('la paleta se cierra con Escape', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdp-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdp-panel')).toHaveCount(0);
});

test('las flechas mueven la selección dentro de la paleta', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdp-panel')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.cmdp-item').nth(1)).toHaveClass(/selected/);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.cmdp-item').nth(0)).toHaveClass(/selected/);
});
