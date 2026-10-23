import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(join(tmpdir(), 'editoria-rules-'));
const bundle = join(work, 'platform-rules.mjs');

try {
  await build({
    entryPoints: [join(root, 'apps/desktop/src/state/platform-rules.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  });
  const module = await import(pathToFileURL(bundle).href);
  const packs = module.BUILTIN_RULE_PACKS;
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new Error('No se encontraron packs de reglas para exportar.');
  }
  const document = {
    schema: 'editor-ia.platform-rules.v1',
    generatedAt: new Date().toISOString().slice(0, 10),
    packs,
  };
  const target = join(root, 'data', 'platform-rules.json');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Reglas exportadas: ${target} (${packs.length} packs)`);
} finally {
  await rm(work, { recursive: true, force: true });
}
