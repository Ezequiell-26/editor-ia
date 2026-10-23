import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de la interfaz. Corre contra el servidor de Vite (dev) y usa el Chrome
 * del sistema: no descarga navegadores.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1360, height: 820 },
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
