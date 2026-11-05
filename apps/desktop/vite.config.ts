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
    // Umbral de aviso por chunk (va en `build`, no en `output`: ahi Rollup lo
    // ignora con "Unknown output options"). 300 kB marca los dos grandes que
    // quedan por dividir: `main` y `vendor-emojibase`.
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
      },
      output: {
        // Chunking explícito (autorizado por el Lead): separa vendors de terceros
        // y paquetes compartidos del bundle de la aplicación. El objetivo es que
        // `main` quede con código propio (cacheable por release) y que los
        // vendors se carguen en paralelo; además los paquetes pesados que sólo
        // usan vistas lazy (emojibase/lottie/effect-kit) no contaminan el
        // arranque. Ver docs/CSS-PERF-NOTES.md §5.2.
        manualChunks(id, { getModuleInfo }) {
          if (id.includes('node_modules')) {
            // React core separado
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            // Tauri API
            if (id.includes('@tauri-apps')) {
              return 'vendor-tauri';
            }
            // Lottie - pesado (~200KB), solo se usa en motion view
            if (id.includes('lottie-web')) {
              return 'vendor-lottie';
            }
            // Emojis (~100KB), lazy loaded en text view
            if (id.includes('emojibase')) {
              return 'vendor-emojibase';
            }
            // Search library
            if (id.includes('minisearch')) {
              return 'vendor-search';
            }
            // Zod schema validation
            if (id.includes('zod')) {
              return 'vendor-zod';
            }
            // Date-fns (locale-specific imports)
            if (id.includes('date-fns')) {
              return 'vendor-dates';
            }
            // Three.js / WebGL (si existe)
            if (id.includes('three')) {
              return 'vendor-3d';
            }
          }
          if (id.includes('/packages/project-schema/')) {
            return 'vendor-schema';
          }
          if (id.includes('/packages/effect-kit/')) {
            return 'vendor-effect';
          }
          // Optimización: chunks grandes > 50KB separados
          const module = getModuleInfo(id);
          if (module && module.size > 50000) {
            return `chunk-${module.id.split('/').pop()?.replace('.js', '')}`;
          }
          return undefined;
        },
        inlineDynamicImports: false,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Las herramientas de edición escriben con rename atómico y dejan carpetas
    // temporales `.archivo.<pid>.<uuid>.tmpdir/` dentro de `src/styles`. En
    // Windows el watcher de Vite puede quedar con EBUSY sobre ese temporal y
    // tumbar el servidor entero; no hace falta vigilarlos. Lo mismo pasa con
    // binarios de Rust/FFmpeg que otras herramientas abren (avdevice-63.dll):
    // nada de `src-tauri/**`, `target*/**` ni DLLs necesita HMR.
    watch: {
      ignored: [
        '**/.*.tmpdir/**',
        '**/*.tmp',
        '**/*.tmpdir/**',
        '**/src-tauri/**',
        '**/target/**',
        '**/target-*/**',
        '**/*.dll',
        '**/dist/**',
      ],
    },
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
