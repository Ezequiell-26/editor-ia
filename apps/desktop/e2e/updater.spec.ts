import { expect, test } from '@playwright/test';

test('la ventana de actualizaciones informa el estado real, sin releases ficticias', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.start-window')).toBeVisible();

  // El lanzador no anuncia una actualización inexistente.
  await expect(page.locator('.start-update-chip')).toHaveCount(0);

  await page.locator('.start-version-btn').click();

  const dialog = page.getByRole('dialog', { name: 'Actualizaciones de Olyvia' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Versión instalada: v0.1.0')).toBeVisible();
  await expect(dialog.getByText('Sin canal de actualizaciones configurado')).toBeVisible();
  await expect(dialog.getByText(/Firma: local autofirmada/)).toBeVisible();
  await expect(dialog.getByText(/Endpoint de releases: sin definir/)).toBeVisible();

  // Sin controles que prometan una descarga o un canal que no existen.
  await expect(dialog.getByRole('button', { name: /descargar/i })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Beta/ })).toHaveCount(0);
  await expect(dialog.locator('.updater-btn--primary')).toHaveCount(0);

  // La caja entra en el viewport y no desborda en horizontal.
  const box = await dialog.locator('.updater-dialog').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeGreaterThan(120);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1360);
  expect(box.y + box.height).toBeLessThanOrEqual(820);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.start-version-btn')).toBeFocused();
});
