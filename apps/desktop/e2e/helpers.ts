import { expect, type Page } from '@playwright/test';

/**
 * En el navegador la app arranca en la pantalla de inicio (Montaje). Los tests
 * del shell entran por el botón Ajustes, que es una acción real de la pantalla
 * y no requiere crear un proyecto.
 */
export async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.start-window')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
