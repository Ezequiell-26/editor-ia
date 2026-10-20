import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(directory, name));

if (files.length === 0) {
  console.error('No se encontraron tests de la extensión.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
