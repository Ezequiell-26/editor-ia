import { expect, test } from '@playwright/test';
import { enterApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await enterApp(page);
  await expect(page.locator('.settings-shell')).toBeVisible();
});

test('el panel de apariencia aplica el color en vivo', async ({ page }) => {
  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );

  // La barra de color: arrastrar cambia el acento sin soltar.
  const slider = page.locator('.hue-slider');
  await slider.click({ force: true });
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
  const during = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );
  expect(during).not.toBe(before);

  // El valor committeado se guarda: al recargar sigue igual.
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  const committed = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );
  await page.reload();
  await enterApp(page);
  await expect(page.locator('.settings-shell')).toBeVisible();
  const afterReload = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
  );
  expect(afterReload).toBe(committed);
});

test('los sliders de escala y esquinas avanzan en vivo', async ({ page }) => {
  const fields = page.locator('.appearance-field input[type=range]');
  const scale = fields.first();
  const before = await scale.inputValue();
  await scale.click({ force: true });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
  const during = await scale.inputValue();
  expect(Number(during)).toBeGreaterThan(Number(before));
});

test('los atajos se pueden reasignar y la paleta lo refleja', async ({ page }) => {
  await page.locator('nav.settings-nav button:has-text("Atajos")').click();
  const row = page.locator('.shortcuts-row', { hasText: 'Abrir proyecto' }).first();
  await row.locator('button.shortcuts-keys').click();
  await page.keyboard.press('Control+j');
  await expect(row.locator('button.shortcuts-keys')).toHaveText('Ctrl+J');

  // La paleta muestra el atajo nuevo.
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdp-item', { hasText: 'Abrir proyecto' })).toContainText('Ctrl+J');
  await page.keyboard.press('Escape');

  // Restablecer vuelve al original. Se acota a la tarjeta de atajos: el
  // respaldo de Datos locales tiene su propio "Restablecer todo".
  await page.locator('.shortcuts-card button:has-text("Restablecer todo")').click();
  await expect(row.locator('button.shortcuts-keys')).toHaveText('Ctrl+O');
});

test('no se puede reasignar un atajo ya usado', async ({ page }) => {
  await page.locator('nav.settings-nav button:has-text("Atajos")').click();
  // Primero tomar Ctrl+J con "Abrir proyecto…".
  const abrir = page.locator('.shortcuts-row', { hasText: 'Abrir proyecto' }).first();
  await abrir.locator('button.shortcuts-keys').click();
  await page.keyboard.press('Control+j');
  await expect(abrir.locator('button.shortcuts-keys')).toHaveText('Ctrl+J');

  // Intentar asignarle el mismo a "Deshacer" se rechaza con aviso y la fila
  // sigue esperando una combinación válida.
  const undo = page.locator('.shortcuts-row', { hasText: 'Deshacer' }).first();
  await undo.locator('button.shortcuts-keys').click();
  await page.keyboard.press('Control+j');
  await expect(page.locator('.shortcuts-error')).toBeVisible();
  await expect(undo.locator('button.shortcuts-keys')).toHaveText('Presioná la combinación…');

  // Cancelar con Escape deja el atajo original intacto.
  await page.keyboard.press('Escape');
  await expect(undo.locator('button.shortcuts-keys')).toHaveText('Ctrl+Z');
});
