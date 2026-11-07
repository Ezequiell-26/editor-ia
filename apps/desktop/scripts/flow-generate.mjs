#!/usr/bin/env node
/**
 * flow-generate.mjs — Genera imágenes en Google Flow vía CDP, sin dependencias.
 *
 * Conduce la sesión web embebida de Olyvia (o cualquier Chromium con
 * --remote-debugging-port) usando el Chrome DevTools Protocol puro:
 * WebSocket + fetch nativos de Node >= 22. No requiere npm install.
 *
 * Flujo probado en vivo:
 *   1. Localiza la pestaña de flow.google.com en /json/list (o la crea).
 *   2. Cierra diálogos/modales que tapen la UI (Escape + botones de cierre).
 *   3. Si no está en un proyecto, crea uno ("Proyecto nuevo").
 *   4. Escribe el prompt en el editor ProseMirror y envía (arrow_forward).
 *   5. Espera a que termine la generación (detecta "Generating/Pensando/%").
 *   6. Descarga las imágenes nuevas (img[src*="/asb/"]) como base64 y las
 *      guarda en --out con detección de formato por magic bytes.
 *
 * Uso:
 *   node flow-generate.mjs --cdp http://127.0.0.1:19223 \
 *     --prompt "un gato astronauta" --out "C:/media/flow" \
 *     [--timeout 600] [--reuse-project] [--url https://flow.google.com]
 *
 * Sale siempre con un JSON en stdout: {ok, files, url, error}.
 */

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { timeout: 600, reuseProject: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--cdp') { out.cdp = value; i += 1; }
    else if (key === '--prompt') { out.prompt = value; i += 1; }
    else if (key === '--out') { out.out = value; i += 1; }
    else if (key === '--url') { out.url = value; i += 1; }
    else if (key === '--timeout') { out.timeout = Number(value); i += 1; }
    else if (key === '--reuse-project') { out.reuseProject = true; }
    else if (key === '--help' || key === '-h') { out.help = true; }
  }
  return out;
}

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function fail(message, extra = {}) {
  emit({ ok: false, error: message, ...extra });
  process.exit(1);
}

if (args.help || !args.cdp || !args.prompt || !args.out) {
  emit({
    ok: false,
    error: 'faltan argumentos: --cdp <url> --prompt <texto> --out <dir> [--timeout s] [--reuse-project]',
  });
  process.exit(1);
}

const CDP = args.cdp.replace(/\/+$/, '');
const PROMPT = args.prompt.trim();
const OUT_DIR = args.out;
const TIMEOUT_MS = Math.max(60, args.timeout) * 1000;

if (PROMPT.length > 4000) fail('el prompt supera 4000 caracteres');

// ── HTTP helper sobre /json ──────────────────────────────────────────────

async function cdpJson(path, method = 'GET') {
  const response = await fetch(`${CDP}${path}`, { method });
  if (!response.ok) throw new Error(`CDP ${path} → HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function findOrCreateTarget() {
  const list = await cdpJson('/json/list');
  const pages = (Array.isArray(list) ? list : []).filter(
    (t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string',
  );
  const flowHome = pages.find((t) => /flow\.google\.com\/?(\?|$)/.test(t.url) && !t.url.includes('/project/'));
  const flowProject = pages.find((t) => t.url.includes('flow.google.com/project/'));
  const chosen = flowProject || flowHome || pages.find((t) => t.url.includes('flow.google.com'));
  if (chosen) return chosen;
  // No hay pestaña de Flow: crear una nueva.
  const url = args.url || 'https://flow.google.com';
  const created = await cdpJson(`/json/new?${encodeURIComponent(url)}`, 'PUT');
  return created;
}

// ── WebSocket CDP mínimo ─────────────────────────────────────────────────

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout conectando CDP websocket')), 15000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`websocket CDP: ${e.message || 'error'}`)); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.message || 'error'}`));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 30000);
    });
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'excepción JS';
      throw new Error(`evaluate: ${desc}`.slice(0, 500));
    }
    return result.result?.value;
  }

  async key(keyName, code, windowsVirtualKeyCode) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', {
        type,
        key: keyName,
        code,
        windowsVirtualKeyCode,
      });
    }
  }

  close() {
    try { this.ws?.close(); } catch { /* noop */ }
  }
}

// ── Utilidades de página ─────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissDialogs(client, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    const clicked = await client.evaluate(`(() => {
      const dialogs = document.querySelectorAll('mat-dialog-container, [role="dialog"], .cdk-overlay-container mat-dialog-container');
      for (const d of dialogs) {
        const btns = d.querySelectorAll('button');
        for (const b of btns) {
          const t = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
          if (/cerrar|close|entendido|ok|aceptar|got it|dismiss/.test(t)) { b.click(); return 'btn:' + t.slice(0, 30); }
        }
        const x = d.querySelector('button.mat-mdc-icon-button, button[aria-label*="lose" i], button[aria-label*="errar" i]');
        if (x) { x.click(); return 'icon'; }
      }
      return null;
    })()`).catch(() => null);
    if (!clicked) {
      // Escape como tecla real por si el diálogo no tiene botón visible.
      await client.key('Escape', 'Escape', 27).catch(() => {});
      await sleep(400);
      const still = await client.evaluate(
        `!!document.querySelector('mat-dialog-container, [role="dialog"]')`,
      ).catch(() => false);
      if (!still) return;
    }
    await sleep(600);
  }
}

async function ensureProject(client) {
  const state = await client.evaluate(`(() => ({
    path: location.pathname,
    hasNew: [...document.querySelectorAll('button, [role="button"]')].some(
      (el) => /proyecto nuevo|new project/i.test(el.innerText || el.getAttribute('aria-label') || '')
    ),
  }))()`);
  if (state.path.includes('/project/')) return state.path;
  if (!state.hasNew) return state.path; // ya en otra vista de Flow; seguimos igual
  const clicked = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => /proyecto nuevo|new project/i.test(b.innerText || b.getAttribute('aria-label') || '')
    );
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) return state.path;
  // Esperar a que la URL cambie a /project/<id>.
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    const path = await client.evaluate('location.pathname').catch(() => '');
    if (typeof path === 'string' && path.includes('/project/')) return path;
  }
  return state.path;
}

function collectImageSrcsExpr() {
  return `(() => {
    const out = [];
    document.querySelectorAll('img').forEach((el) => {
      const s = el.src || el.currentSrc || '';
      if (s.includes('/asb/')) out.push(s);
    });
    return [...new Set(out)];
  })()`;
}

async function pageStatus(client) {
  return client.evaluate(`(() => {
    const t = document.body ? document.body.innerText.slice(0, 4000) : '';
    const generating = /Generating|Generando|Creando|Pensando|\\d+%/.test(t);
    const imgs = document.querySelectorAll('img[src*="/asb/"]').length;
    const promptEmpty = !document.querySelector('[role="textbox"]')
      || (document.querySelector('[role="textbox"]').innerText || '').trim().length === 0;
    return { generating, imgs, promptEmpty, url: location.href };
  })()`);
}

async function submitPrompt(client) {
  // Enfocar el editor y escribir como si fuera el usuario (ProseMirror).
  const focused = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]')].find(
      (e) => { const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 10; }
    );
    if (!el) return false;
    el.focus();
    el.click();
    return true;
  })()`);
  if (!focused) throw new Error('no se encontró el cuadro de prompt de Flow');
  await sleep(400);
  // Limpiar restos de prompts anteriores en el cuadro.
  await client.evaluate(`(() => {
    const el = document.querySelector('[role="textbox"]');
    if (!el) return;
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
  })()`).catch(() => {});
  await sleep(300);
  await client.send('Input.insertText', { text: PROMPT });
  await sleep(800);
  // Enviar: primero Enter (el chat de Flow envía con Enter); si el texto
  // sigue en el cuadro, click en el botón submit con icono arrow_forward.
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  // Verificar que el envío pegó: el cuadro se vacía o aparece el estado de
  // generación ("Pensando…", "Generating", botón stop). Puede tardar unos
  // segundos en reflejarse en el DOM.
  for (let i = 0; i < 10; i += 1) {
    await sleep(1200);
    const state = await client.evaluate(`(() => {
      const t = document.body ? document.body.innerText.slice(0, 4000) : '';
      const generating = /Generating|Generando|Creando|Pensando|\\d+%/.test(t);
      const el = document.querySelector('[role="textbox"], textarea, [contenteditable="true"]');
      const pending = el ? (el.innerText || el.value || '').trim().length : -1;
      return { generating, pending };
    })()`).catch(() => null);
    if (state && (state.generating || state.pending === 0)) return;
  }
  // Fallback: click en el botón submit con icono arrow_forward (innerText,
  // aria-label o textContent del mat-icon).
  const sent = await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[type="submit"], button')];
    const send = btns.find((b) => /arrow_forward/i.test(
      (b.innerText || '') + (b.getAttribute('aria-label') || '') + (b.textContent || '')
    ));
    if (!send) return false;
    send.click();
    return true;
  })()`);
  if (!sent) throw new Error('no se pudo enviar el prompt a Flow');
  await sleep(2000);
}

async function downloadImages(client, srcs) {
  if (srcs.length === 0) return [];
  const b64list = await client.evaluate(`(async () => {
    const srcs = ${JSON.stringify(srcs)};
    const out = [];
    for (const src of srcs) {
      try {
        const resp = await fetch(src, { credentials: 'include' });
        if (!resp.ok) { out.push({ src, error: 'HTTP ' + resp.status }); continue; }
        const buf = await resp.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        out.push({ src, b64: btoa(bin), size: bytes.length });
      } catch (e) {
        out.push({ src, error: String(e).slice(0, 200) });
      }
    }
    return out;
  })()`, { awaitPromise: true });
  return Array.isArray(b64list) ? b64list : [];
}

function detectExt(buffer) {
  if (buffer.length > 12 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.length > 4 && buffer.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return 'bin';
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const target = await findOrCreateTarget();
  if (!target.webSocketDebuggerUrl) fail('la pestaña de Flow no expone websocket CDP');

  // Esperar a que la página cargue lo suficiente.
  await sleep(2500);

  const client = new CDPClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await dismissDialogs(client);
    const projectPath = args.reuseProject
      ? await client.evaluate('location.pathname').catch(() => '')
      : await ensureProject(client);
    if (typeof projectPath !== 'string' || !projectPath.includes('/project/')) {
      throw new Error(`Flow no abrió un proyecto (path: ${projectPath}). ¿Sesión activa?`);
    }

    // Baseline: imágenes ya presentes antes de generar.
    const baseline = new Set(await client.evaluate(collectImageSrcsExpr()).catch(() => []));

    await submitPrompt(client);

    // Polling hasta que termine la generación.
    const deadline = Date.now() + TIMEOUT_MS;
    let stable = 0;
    let lastCount = -1;
    let status = { generating: true, imgs: 0 };
    while (Date.now() < deadline) {
      await sleep(8000);
      status = await pageStatus(client).catch(() => ({ generating: true, imgs: 0 }));
      const done = !status.generating && status.imgs > baseline.size;
      if (done) {
        if (status.imgs === lastCount) {
          stable += 1;
          if (stable >= 2) break;
        } else {
          stable = 0;
          lastCount = status.imgs;
        }
      } else {
        stable = 0;
        lastCount = status.imgs;
      }
    }

    const allSrcs = await client.evaluate(collectImageSrcsExpr()).catch(() => []);
    const fresh = (Array.isArray(allSrcs) ? allSrcs : []).filter((s) => !baseline.has(s));
    const finalUrl = await client.evaluate('location.href').catch(() => '');

    if (fresh.length === 0) {
      fail('la generación terminó pero no aparecieron imágenes nuevas', {
        url: finalUrl,
        status,
      });
    }

    const downloaded = await downloadImages(client, fresh);
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const files = [];
    let idx = 0;
    for (const item of downloaded) {
      if (!item.b64) { files.push({ src: item.src, error: item.error || 'sin datos' }); continue; }
      const buffer = Buffer.from(item.b64, 'base64');
      const ext = detectExt(buffer);
      idx += 1;
      const name = `flow_${stamp}_${idx}.${ext}`;
      const filePath = path.join(OUT_DIR, name);
      fs.writeFileSync(filePath, buffer);
      files.push({ path: filePath, bytes: buffer.length, ext });
    }

    const okFiles = files.filter((f) => f.path);
    emit({
      ok: okFiles.length > 0,
      files: okFiles,
      failed: files.filter((f) => !f.path),
      url: finalUrl,
      projectPath: typeof projectPath === 'string' ? projectPath : null,
      generated: fresh.length,
      timedOut: Date.now() >= deadline,
      ...(okFiles.length === 0 ? { error: 'no se pudo descargar ninguna imagen' } : {}),
    });
    process.exit(okFiles.length > 0 ? 0 : 1);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
