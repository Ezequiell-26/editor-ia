import { expect, type Page } from '@playwright/test';

/**
 * En el navegador la app arranca en el lanzador. Los tests del shell entran con
 * Tutorial, que es una acción real de la pantalla y no requiere backend ni
 * crear un proyecto. Ajustes ya no entra al shell: abre su ventana flotante
 * sobre el lanzador.
 */
export async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.start-window')).toBeVisible();
  await page.getByRole('button', { name: 'Tutorial' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

/** Entra al shell y abre la ventana de Configuración. */
export async function enterSettings(page: Page): Promise<void> {
  await enterApp(page);
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
}
