import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      'extensions/**',
      // Los specs de Playwright se ejecutan con `npm run test:e2e`; Vitest no
      // puede resolver su runner y los reportaba como archivos fallidos.
      'apps/desktop/e2e/**',
      '.tmp-vitest/**',
      // Worktrees locales de experimentos: duplican la suite sin node_modules.
      '.worktrees/**',
      // Los worktrees de seguridad viven dentro de .git y duplicaban la suite
      // (incluidos specs de Playwright que Vitest no puede ejecutar).
      '**/.git/**',
    ],
  },
});
