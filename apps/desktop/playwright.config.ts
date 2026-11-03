import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de la interfaz. Corre contra el servidor de Vite (dev) y usa el Chrome
 * del sistema: no descarga navegadores.
 *
 * El script `dev` de `apps/desktop` escucha en el puerto 3000
 * (`vite --host 0.0.0.0 --port 3000`), que es el server que ya usa el equipo.
 * Antes el config apuntaba a 5173, un puerto que `dev` nunca abre: el
 * `reuseExistingServer` no encontraba nada y Playwright levantaba un segundo
 * Vite en 5173. Ahora baseURL y webServer apuntan a 3000 para reutilizar el
 * server existente; si no hay ninguno, Playwright ejecuta `npm run dev` (que
 * de todos modos usa 3000) y lo cierra al terminar.
 */
export default defineConfig({
  testDir: './e2e',
  // El primer test paga la compilación en frío de Vite: hay que darle margen.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1360, height: 820 },
    actionTimeout: 15_000,
    navigationTimeout: 90_000,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
