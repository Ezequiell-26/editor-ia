import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * El build multi-entrada agrega `crossorigin` a los tags de script/stylesheet.
 * Con el protocolo propio de Tauri eso puede dejar la ventana en blanco: el
 * tag se vuelve un pedido CORS que el handler de assets no responde.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/\s+crossorigin(?==|\s|>)/g, ''),
    },
  };
}

export default defineConfig({
  // Rutas relativas: el protocolo de assets de Tauri no resuelve `/assets/...`.
  base: './',
  plugins: [react(), stripCrossorigin()],
  build: {
    outDir: 'dist',
    // Los mapas no se publican: filtraban fuente y engordaban el instalador.
    sourcemap: false,
    // Cada build parte de cero; antes se acumulaban cientos de assets viejos
    // dentro del bundle comercial.
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('@tauri-apps')) {
              return 'vendor-tauri';
            }
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
