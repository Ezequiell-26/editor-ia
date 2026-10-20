/**
 * Full queue smoke test: loads the extension, runs one prompt through the side
 * panel, and verifies the downloaded PNG and manifest. Playwright redirects
 * downloads into a temporary directory, so the user's Downloads folder is not
 * touched.
 *
 * Run:
 *   PLAYWRIGHT_BROWSERS_PATH=... PLAYWRIGHT_PACKAGE_JSON=... \
 *   node scripts/smoke-download.mjs
 */
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const localRequire = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = localRequire('playwright'));
} catch {
  const fallback = process.env.PLAYWRIGHT_PACKAGE_JSON;
  if (!fallback) {
    throw new Error(
      'Instalá playwright (npm i -D playwright) o definí PLAYWRIGHT_PACKAGE_JSON apuntando a su package.json.',
    );
  }
  ({ chromium } = createRequire(fallback)('playwright'));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = root;
const fixture = readFileSync(join(root, 'tests', 'fixture-extension.html'), 'utf8');
const profile = mkdtempSync(join(tmpdir(), 'flowqueue-download-profile-'));
const downloads = mkdtempSync(join(tmpdir(), 'flowqueue-downloads-'));

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  acceptDownloads: true,
  downloadsPath: downloads,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 900 },
});

try {
  await context.route('https://flow.google.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  const flow = await context.newPage();
  await flow.goto('https://flow.google.com/project/download-smoke', {
    waitUntil: 'domcontentloaded',
  });
  await flow.waitForSelector('textarea[placeholder="¿Qué quieres crear?"]');

  const manager = await context.newPage();
  await manager.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await manager.waitForFunction(() => {
    const list = document
      .querySelector('extensions-manager')
      ?.shadowRoot?.querySelector('extensions-item-list');
    return (list?.shadowRoot?.querySelectorAll('extensions-item')?.length ?? 0) > 0;
  }, null, { timeout: 10_000 });
  const extensionId = await manager.evaluate(() => {
    const list = document
      .querySelector('extensions-manager')
      ?.shadowRoot?.querySelector('extensions-item-list');
    return list?.shadowRoot?.querySelector('extensions-item')?.getAttribute('id') ?? null;
  });
  await manager.close();
  if (!extensionId) throw new Error('la extensión no cargó');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel.html`, {
    waitUntil: 'domcontentloaded',
  });
  await panel.click('#connect');
  await panel.waitForFunction(
    () => document.querySelector('#connection-text')?.textContent?.includes('Conectado'),
    null,
    { timeout: 10_000 },
  );
  await panel.fill('#prompts', 'Un faro de prueba para el smoke de descarga');
  await panel.check('#skip-model');
  await panel.waitForTimeout(350);
  if (await panel.isDisabled('#start')) throw new Error('el botón Iniciar cola está deshabilitado');

  await panel.click('#start');
  await panel.waitForFunction(
    () => document.querySelector('#log')?.textContent?.includes('Manifiesto:'),
    null,
    { timeout: 30_000 },
  );
  await panel.waitForFunction(
    () => document.querySelector('#log')?.textContent?.includes('Configuración de Flow omitida'),
    null,
    { timeout: 5_000 },
  );
  await panel.waitForTimeout(1_500);

  const files = listFiles(downloads).map((file) => relative(downloads, file).replaceAll('\\', '/'));
  let imageBytes = null;
  let manifest = null;
  let manifestSavedAs = null;
  for (const file of files) {
    const bytes = readFileSync(join(downloads, file));
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG') {
      imageBytes = bytes.length;
      continue;
    }
    const text = bytes.toString('utf8').trim();
    if (text.startsWith('{') && text.includes('editor-ia.flow-queue')) {
      manifest = JSON.parse(text);
      manifestSavedAs = file;
    }
  }
  if (!imageBytes) throw new Error(`no se descargó un PNG; archivos: ${files.join(', ')}`);
  if (!manifest) throw new Error(`no se descargó el manifiesto; archivos: ${files.join(', ')}`);
  if (manifest.prompts?.[0]?.status !== 'downloaded') {
    throw new Error('el manifiesto no marca el prompt como descargado');
  }
  if (!/^flow-queue\/.+\/001_.+\.png$/.test(manifest.prompts?.[0]?.file ?? '')) {
    throw new Error(`el manifiesto apunta a una ruta inesperada: ${manifest.prompts?.[0]?.file}`);
  }

  console.log(
    JSON.stringify(
      {
        intendedImage: manifest.prompts[0].file,
        imageBytes,
        manifestSavedAs,
        promptStatus: manifest.prompts[0].status,
        playwrightSavedFiles: files,
        note: 'Playwright guarda las descargas con nombres UUID; la ruta de flow-queue queda en el manifiesto.',
      },
      null,
      2,
    ),
  );
  console.log('SMOKE_DOWNLOAD_OK');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(downloads, { recursive: true, force: true });
}
