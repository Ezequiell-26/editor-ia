import { expect, type Page } from '@playwright/test';

/**
 * En el navegador la app arranca en la pantalla de inicio (Montaje). Los tests
 * del shell entran por el botón Ajustes, que es una acción real de la pantalla
 * y no requiere crear un proyecto.
 *
 * Ajustes abre una ventana flotante: se cierra al entrar para que el resto de
 * los tests trabaje sobre el shell sin un modal bloqueando los clics.
 */
export async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.start-window')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Configuración' });
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
}

/** Entra al shell y abre la ventana de Configuración. */
export async function enterSettings(page: Page): Promise<void> {
  await enterApp(page);
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
}
