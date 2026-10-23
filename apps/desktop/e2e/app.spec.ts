import { expect, test } from '@playwright/test';
import { enterApp } from './helpers';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await enterApp(page);
  // El diálogo de bienvenida sólo aparece en la app nativa; en el navegador no.
  await page.keyboard.press('Escape').catch(() => {});
});

test('la app arranca con el shell completo', async ({ page }) => {
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.app-statusbar')).toBeVisible();
  await expect(page).toHaveTitle(/Editor IA/);
});

test('la barra lateral navega por todas las vistas', async ({ page }) => {
  const views = [
    'Inicio',
    'Proyectos',
    'Director',
    'Producción',
    'Fábrica',
    'Editor',
    'Guion',
    'Medios',
    'Descargar',
    'Aprender',
  ];
  for (const label of views) {
    await page.locator(`.sidebar button[aria-label="${label}"]`).click();
    await expect(page.locator(`.sidebar button[aria-label="${label}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Cada vista renderiza contenido propio.
    await expect(page.locator('main.content')).not.toBeEmpty();
  }

  // Ajustes no es una vista: abre su propia ventana y no cambia el rail.
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
  await expect(page.locator('main.content')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
});

test('los iconos del rail quedan centrados', async ({ page }) => {
  const offsets = await page.evaluate(() => {
    const nav = document.querySelector('.sidebar');
    if (!nav) return [];
    return [...nav.querySelectorAll('button')]
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector('.nav-icon')?.getBoundingClientRect();
        if (!icon) return null;
        return icon.left + icon.width / 2 - (rect.left + rect.width / 2);
      })
      .filter((value): value is number => value !== null);
  });
  expect(offsets.length).toBeGreaterThan(5);
  for (const offset of offsets) {
    expect(Math.abs(offset)).toBeLessThan(1);
  }
});

test('la ruta de producción marca el paso actual y guía el siguiente', async ({ page }) => {
  await page.locator('.sidebar button[aria-label="Proyectos"]').click();
  await expect(page.locator('.pipeline-bar')).toBeVisible();
  await expect(page.locator('.pipeline-title')).toContainText('paso 1 de 6');
  await expect(page.locator('.pipeline-step')).toHaveCount(6);
  await expect(page.locator('.pipeline-step.current')).toContainText('Proyecto');
  await expect(page.locator('.pipeline-next')).toHaveText('Siguiente: Proyecto');

  await page.locator('.pipeline-next').click();
  await expect(page.locator('.pipeline-bar')).toBeVisible();

  // En Inicio la ruta se explica completa y la franja no estorba.
  await page.locator('.sidebar button[aria-label="Inicio"]').click();
  await expect(page.locator('.pipeline-guide')).toBeVisible();
  await expect(page.locator('.pipeline-guide-step')).toHaveCount(6);
  await expect(page.locator('.pipeline-guide-step.current')).toContainText('Proyecto');
  await expect(page.locator('.pipeline-bar')).toHaveCount(0);

  // Las herramientas no llevan franja: no hay ruta que seguir ahí.
  await page.locator('.sidebar button[aria-label="Convertir"]').click();
  await expect(page.locator('.pipeline-bar')).toHaveCount(0);
});
