import { expect, type Page } from '@playwright/test';

/**
 * UN SOLO EDITOR: la app ya no pasa por el launcher — arranca directo en el
 * shell (editor vacío con herramientas). El gestor de proyectos sigue
 * accesible desde el botón «Inicio» del topbar. Ajustes abre su ventana
 * flotante sobre el shell.
 */
export async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  // El workspace monta después de resolver los estilos de la vista y sus
  // efectos (atajos de teclado incluidos) ya corrieron: esperar a él evita
  // la carrera en la que un Ctrl+K inmediato se pierde antes del listener.
  await expect(page.locator('.editor-workspace')).toBeVisible();
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
