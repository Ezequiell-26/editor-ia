#!/usr/bin/env node
// Empaqueta el servidor MCP del proyecto con esbuild (ya presente por Vite).
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'apps', 'project-mcp', 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  logLevel: 'info',
});
