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
  // `exact` evita que un proyecto reciente con «Tutorial» en el nombre compita
  // con el botón del footer del lanzador.
  await page.getByRole('button', { name: 'Tutorial', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

/** Entra al shell y abre la ventana de Configuración. */
export async function enterSettings(page: Page): Promise<void> {
  await enterApp(page);
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
}

/**
 * Abre el desplegable «Más» del rail (herramientas avanzadas: Director,
 * Automático, AI Hub, Nodos y MCP). El rail sólo muestra las vistas
 * principales; las secundarias viven acá. Las que ya son tabs del editor
 * (Texto, Multicámara, Mezcla, VFX, Motion, Efectos) no tienen puerta propia.
 */
export async function openSecondaryNav(page: Page): Promise<void> {
  const toggle = page.locator('.sidebar .nav-more > button').first();
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await toggle.click();
  await expect(page.locator('#sidebar-more-list')).toBeVisible();
}

/**
 * Navega a una vista por su aria-label, esté en el rail principal o dentro de
 * «Más». Mantiene intacta la semántica de aria-labels que usa la app.
 */
export async function clickNav(page: Page, label: string): Promise<void> {
  const rail = page.locator(`.sidebar > ul > li > button[aria-label="${label}"]`);
  if ((await rail.count()) > 0) {
    await rail.first().click();
    return;
  }
  await openSecondaryNav(page);
  await page.locator(`#sidebar-more-list button[aria-label="${label}"]`).first().click();
}
