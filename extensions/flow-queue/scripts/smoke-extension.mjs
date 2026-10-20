/**
 * End-to-end smoke test for the unpacked extension.
 *
 * It serves a fake `flow.google.com` page through Playwright routing, loads the
 * extension in a real Chrome, opens the side panel as a tab, and exercises the
 * same messages the panel uses. No Google account or network access needed.
 *
 * Run: node scripts/smoke-extension.mjs
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
const profile = mkdtempSync(join(tmpdir(), 'flowqueue-smoke-'));
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
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
  await flow.goto('https://flow.google.com/project/smoke', { waitUntil: 'domcontentloaded' });
  await flow.waitForSelector('textarea[placeholder="¿Qué quieres crear?"]');

  const manager = await context.newPage();
  await manager.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await manager.waitForFunction(() => {
    const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
    return (list?.shadowRoot?.querySelectorAll('extensions-item')?.length ?? 0) > 0;
  }, null, { timeout: 10_000 });
  const extensionId = await manager.evaluate(() => {
    const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
    return list?.shadowRoot?.querySelector('extensions-item')?.getAttribute('id') ?? null;
  });
  await manager.close();
  if (!extensionId) throw new Error('la extensión no apareció en chrome://extensions');
  console.log('extension id:', extensionId);

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

  const diagnostics = await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ['https://flow.google.com/*'] });
    const tab = tabs[0];
    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'FLOWQ_PING' });
    const model = await chrome.tabs.sendMessage(tab.id, {
      type: 'FLOWQ_APPLY_MODEL',
      model: 'Nano Banana 2',
    });
    const run = await chrome.tabs.sendMessage(tab.id, {
      type: 'FLOWQ_RUN_PROMPT',
      prompt: 'Un faro azul en un acantilado, ilustración plana',
      timeoutMs: 10_000,
    });
    return { ping, model, run };
  });

  await panel.fill('#prompts', 'Un faro\nUn bosque\nUn faro\nUn río\nUna ciudad');
  await panel.waitForTimeout(500);
  const promptCount = await panel.textContent('#prompt-count');
  const startDisabled = await panel.isDisabled('#start');
  const queueItems = await panel.locator('#queue-list li').count();
  const emptyWarning = (await panel.textContent('#log')).includes('no contiene prompts');
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: join(root, 'tests', 'smoke-panel.png'), fullPage: true });

  const result = {
    connected: true,
    diagnostics: diagnostics.ping.diagnostics,
    model: diagnostics.model,
    run: {
      ok: diagnostics.run.ok,
      hasDataUrl: diagnostics.run.image?.dataUrl?.startsWith('data:image/png'),
      width: diagnostics.run.image?.width,
      height: diagnostics.run.image?.height,
      prompt: diagnostics.run.prompt,
    },
    promptCount,
    startDisabled,
    queueItems,
    emptyWarning,
  };
  console.log(JSON.stringify(result, null, 2));

  if (!diagnostics.ping.diagnostics.ready) throw new Error('adapter not ready');
  if (!diagnostics.model.model?.verified) throw new Error('model was not verified');
  if (!diagnostics.run.ok) throw new Error(`run failed: ${diagnostics.run.error}`);
  if (!result.run.hasDataUrl) throw new Error('no image data URL');
  if (promptCount !== '4 prompts') throw new Error(`unexpected prompt count: ${promptCount}`);
  if (startDisabled) throw new Error('start button should be enabled');
  if (queueItems !== 4) throw new Error(`expected 4 queue rows, got ${queueItems}`);
  if (emptyWarning) throw new Error('empty prompt warning should not be logged on load');

  console.log('SMOKE_OK');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
