import { parsePrompts } from './lib/prompts.js';
import { QueueEngine } from './lib/queue.js';
import { manifestFileName, resultFileName, runIdFromDate } from './lib/naming.js';
import { buildManifest } from './lib/manifest.js';

const SETTINGS_KEY = 'flowq.settings.v1';
const REFERENCES_KEY = 'flowq.references.v1';
const PROMPTS_KEY = 'flowq.prompts.v1';
const RESULTS_KEY = 'flowq.results.v1';
const MAX_REFERENCES = 4;
const MAX_REFERENCE_BYTES = 6_000_000;
const MAX_REFERENCE_TOTAL_BYTES = 20_000_000;
const FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/*'];

const DEFAULT_SETTINGS = {
  model: 'Nano Banana 2.1',
  customModel: '',
  mode: 'image',
  aspect: '16:9',
  count: 1,
  delaySeconds: 5,
  timeoutSeconds: 180,
  continueOnError: false,
  referenceUse: 'style',
  skipModel: false,
  skipReferences: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  connect: $('connect'),
  connectionDot: $('connection-dot'),
  connectionText: $('connection-text'),
  diagnostics: $('diagnostics'),
  model: $('model'),
  modelCustom: $('model-custom'),
  mode: $('mode'),
  aspect: $('aspect'),
  count: $('count'),
  skipModel: $('skip-model'),
  skipReferences: $('skip-references'),
  refCount: $('ref-count'),
  dropzone: $('dropzone'),
  referenceInput: $('reference-input'),
  referenceGrid: $('reference-grid'),
  referenceUse: $('reference-use'),
  prompts: $('prompts'),
  promptCount: $('prompt-count'),
  promptFile: $('prompt-file'),
  clearPrompts: $('clear-prompts'),
  delay: $('delay'),
  timeout: $('timeout'),
  continueOnError: $('continue-on-error'),
  startSummary: $('start-summary'),
  start: $('start'),
  pause: $('pause'),
  stop: $('stop'),
  runId: $('run-id'),
  queueList: $('queue-list'),
  downloadManifest: $('download-manifest'),
  exportPrompts: $('export-prompts'),
  log: $('log'),
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  references: [],
  promptsText: '',
  prompts: [],
  promptWarnings: [],
  connectedTabId: null,
  diagnostics: null,
  queue: null,
  runId: null,
  results: [],
  lastRunStatus: null,
  logLines: [],
  busy: false,
};

const saveTimers = new Map();

function save(key, value, delay = 250) {
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  if (delay <= 0) {
    saveTimers.delete(key);
    void chrome.storage.local.set({ [key]: value });
    return;
  }
  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      void chrome.storage.local.set({ [key]: value });
    }, delay),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'error sin detalle');
}

function log(message) {
  const time = new Date().toLocaleTimeString('es-AR', { hour12: false });
  state.logLines.push(`[${time}] ${message}`);
  if (state.logLines.length > 200) state.logLines.splice(0, state.logLines.length - 200);
  els.log.textContent = state.logLines.join('\n');
  els.log.scrollTop = els.log.scrollHeight;
}

function setBadge(text, color = '#2f7df6') {
  void chrome.runtime.sendMessage({ type: 'FLOWQ_BADGE', text, color }).catch(() => {});
}

async function loadState() {
  const data = await chrome.storage.local.get([
    SETTINGS_KEY,
    REFERENCES_KEY,
    PROMPTS_KEY,
    RESULTS_KEY,
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] ?? {}) };
  state.references = Array.isArray(data[REFERENCES_KEY])
    ? data[REFERENCES_KEY].slice(0, MAX_REFERENCES)
    : [];
  state.promptsText = typeof data[PROMPTS_KEY] === 'string' ? data[PROMPTS_KEY] : '';
  state.results = Array.isArray(data[RESULTS_KEY]) ? data[RESULTS_KEY].slice(-1_000) : [];

  els.model.value = [...els.model.options].some(
    (option) => option.value === state.settings.model,
  )
    ? state.settings.model
    : '__custom';
  if (els.model.value === '__custom') {
    els.modelCustom.value = state.settings.customModel || state.settings.model || '';
    els.modelCustom.classList.remove('hidden');
  }
  els.referenceUse.value = state.settings.referenceUse || 'style';
  els.mode.value = state.settings.mode || 'image';
  els.aspect.value = state.settings.aspect || '16:9';
  els.count.value = String(state.settings.count || 1);
  els.delay.value = String(state.settings.delaySeconds ?? 5);
  els.timeout.value = String(state.settings.timeoutSeconds ?? 180);
  els.continueOnError.checked = Boolean(state.settings.continueOnError);
  els.skipModel.checked = Boolean(state.settings.skipModel);
  els.skipReferences.checked = Boolean(state.settings.skipReferences);
  els.prompts.value = state.promptsText;
  refreshPrompts({ persist: false });
  renderReferences();
  renderStartSummary();
  renderConnection();
  if (state.results.length > 0) {
    els.downloadManifest.disabled = true;
    log(`Última corrida guardada: ${state.results.length} imagen(es) descargada(s).`);
  }
}

function effectiveModel() {
  if (els.model.value === '__custom') return els.modelCustom.value.trim();
  return els.model.value;
}

function refreshPrompts({ persist = true } = {}) {
  const parsed = parsePrompts(els.prompts.value);
  state.prompts = parsed.prompts;
  state.promptWarnings = parsed.warnings;
  state.promptsText = els.prompts.value;
  els.promptCount.textContent = `${parsed.prompts.length} prompt${parsed.prompts.length === 1 ? '' : 's'}`;
  if (persist) save(PROMPTS_KEY, state.promptsText);
  if (parsed.duplicates > 0) {
    log(`${parsed.duplicates} prompt(s) duplicado(s) se omitirán.`);
  }
  for (const warning of parsed.warnings) {
    if (parsed.prompts.length === 0 && /no contiene prompts/i.test(warning)) continue;
    log(warning);
  }
  if (!state.queue) renderQueue();
  renderStartSummary();
}

function renderStartSummary() {
  const model = effectiveModel() || 'sin modelo';
  const total = state.prompts.length;
  const format = `${state.settings.mode === 'video' ? 'Video' : 'Imagen'} ${state.settings.aspect} x${state.settings.count}`;
  els.startSummary.textContent = `${total} prompt${total === 1 ? '' : 's'} · ${state.references.length} referencia${state.references.length === 1 ? '' : 's'} · ${model} · ${format}`;
  const running = state.queue
    ? ['running', 'paused'].includes(state.queue.state().status)
    : false;
  const ready = Boolean(state.diagnostics?.ready);
  els.start.disabled =
    state.busy ||
    running ||
    total === 0 ||
    !model ||
    !state.connectedTabId ||
    !ready;
  if (!state.connectedTabId) {
    els.start.title = 'Conectá una pestaña de Flow primero';
  } else if (!ready) {
    els.start.title = 'Flow no está listo: falta el cuadro de prompt o el botón de generar';
  } else if (total === 0) {
    els.start.title = 'Importá o escribí al menos un prompt';
  } else {
    els.start.title = 'Aplicar modelo, referencias y generar la cola';
  }
}

function renderConnection() {
  const diagnostics = state.diagnostics;
  const connected = Boolean(state.connectedTabId && diagnostics);
  els.connectionDot.className = connected ? `dot ${diagnostics.ready ? 'ok' : 'bad'}` : 'dot';
  if (!connected) {
    els.connectionText.textContent =
      'Abrí flow.google.com en una pestaña y conectala antes de iniciar la cola.';
    els.diagnostics.replaceChildren();
    renderStartSummary();
    return;
  }
  els.connectionText.textContent = diagnostics.ready
    ? 'Conectado a Flow. El cuadro de prompt y el botón de generar están disponibles.'
    : 'La pestaña está conectada, pero no encontré los controles de Flow. Revisá que estés dentro de un proyecto.';
  const chips = [
    { ok: diagnostics.hasPrompt, text: diagnostics.hasPrompt ? `Prompt: ${diagnostics.promptLabel || 'detectado'}` : 'Prompt: no detectado' },
    { ok: diagnostics.hasGenerate, text: diagnostics.hasGenerate ? `Generar: ${diagnostics.generateLabel}` : 'Generar: no detectado' },
    { ok: diagnostics.hasSettings, text: diagnostics.hasSettings ? `Formato: ${diagnostics.settingsLabel}` : 'Formato: no detectado' },
    { ok: diagnostics.hasImageInput, text: diagnostics.hasImageInput ? 'Input de imágenes: sí' : 'Input de imágenes: no' },
    { ok: true, text: `${diagnostics.resultImages} imagen(es) en el lienzo` },
  ];
  els.diagnostics.replaceChildren(
    ...chips.map((chip) => {
      const item = document.createElement('li');
      item.className = chip.ok ? 'ok' : 'bad';
      item.textContent = chip.text;
      return item;
    }),
  );
  renderStartSummary();
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  if (!tabs.length) return null;
  return tabs.find((tab) => tab.active) ?? tabs[tabs.length - 1];
}

async function ping(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'FLOWQ_PING' });
  } catch {
    return null;
  }
}

async function connect() {
  els.connect.disabled = true;
  els.connect.textContent = 'Conectando…';
  try {
    const tab = await findFlowTab();
    if (!tab?.id) {
      state.connectedTabId = null;
      state.diagnostics = null;
      renderConnection();
      log('No hay una pestaña de Flow abierta.');
      return false;
    }
    state.connectedTabId = tab.id;
    let response = await ping(tab.id);
    if (!response?.ok) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/content.js'],
        });
        await sleep(450);
        response = await ping(tab.id);
      } catch (error) {
        log(`No pude inyectar el puente: ${messageOf(error)}`);
      }
    }
    if (!response?.ok) {
      state.connectedTabId = null;
      state.diagnostics = null;
      renderConnection();
      log('La pestaña no respondió. Recargá Flow y volvé a conectar.');
      return false;
    }
    state.diagnostics = response.diagnostics;
    renderConnection();
    log(`Conectado a ${response.diagnostics.title || 'Flow'}.`);
    return true;
  } finally {
    els.connect.disabled = false;
    els.connect.textContent = 'Conectar pestaña';
  }
}

async function sendToTab(message) {
  if (!state.connectedTabId) throw new Error('conectá una pestaña de Flow primero');
  let response;
  try {
    response = await chrome.tabs.sendMessage(state.connectedTabId, message);
  } catch (error) {
    const text = messageOf(error);
    if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
      throw new Error('la pestaña de Flow se recargó; reconectala y reintentá');
    }
    throw new Error(text);
  }
  if (!response) throw new Error('la pestaña de Flow no respondió');
  if (!response.ok) throw new Error(response.error || 'la pestaña de Flow rechazó la operación');
  return response;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`no se pudo leer ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addReferenceFiles(files) {
  const incoming = [...files];
  if (incoming.length === 0) return;
  let totalBytes = state.references.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  for (const file of incoming) {
    if (state.references.length >= MAX_REFERENCES) {
      log(`Máximo ${MAX_REFERENCES} referencias; ${file.name} no se agregó.`);
      break;
    }
    if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
      log(`${file.name}: formato no admitido (usá PNG, JPG o WEBP).`);
      continue;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      log(`${file.name}: supera ${Math.round(MAX_REFERENCE_BYTES / 1_000_000)} MB.`);
      continue;
    }
    if (totalBytes + file.size > MAX_REFERENCE_TOTAL_BYTES) {
      log(`Las referencias superan ${Math.round(MAX_REFERENCE_TOTAL_BYTES / 1_000_000)} MB en total.`);
      break;
    }
    const dataUrl = await readFileAsDataUrl(file);
    state.references.push({
      id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
      name: file.name,
      type: file.type,
      bytes: file.size,
      dataUrl,
    });
    totalBytes += file.size;
  }
  save(REFERENCES_KEY, state.references, 0);
  renderReferences();
}

function renderReferences() {
  els.refCount.textContent = `${state.references.length}/${MAX_REFERENCES}`;
  const nodes = state.references.map((reference) => {
    const figure = document.createElement('figure');
    figure.className = 'reference';
    figure.title = `${reference.name} · ${Math.round((reference.bytes ?? 0) / 1024)} KB`;
    const image = document.createElement('img');
    image.src = reference.dataUrl;
    image.alt = reference.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Quitar ${reference.name}`);
    remove.addEventListener('click', () => {
      state.references = state.references.filter((item) => item.id !== reference.id);
      save(REFERENCES_KEY, state.references, 0);
      renderReferences();
    });
    figure.append(image, remove);
    return figure;
  });
  els.referenceGrid.replaceChildren(...nodes);
  renderStartSummary();
}

function renderQueue(snapshot) {
  const items = snapshot?.items ?? state.prompts.map((prompt, index) => ({
    index,
    prompt,
    status: 'pending',
    error: null,
  }));
  const glyph = { pending: '○', running: '◐', done: '✓', error: '✕' };
  const label = { pending: 'en espera', running: 'generando', done: 'lista', error: 'error' };
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement('li');
    row.className = item.status;
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = glyph[item.status] ?? '○';
    const text = document.createElement('span');
    text.className = 'prompt-text';
    text.textContent = item.prompt;
    text.title = item.error ? `${item.prompt}\n${item.error}` : item.prompt;
    const stateLabel = document.createElement('span');
    stateLabel.className = 'item-status';
    stateLabel.textContent = label[item.status] ?? item.status;
    row.append(status, text, stateLabel);
    fragment.append(row);
  }
  els.queueList.replaceChildren(fragment);
}

function renderQueueProgress(snapshot) {
  const total = snapshot.items.length;
  const done = snapshot.completedCount;
  els.promptCount.textContent = `${done}/${total} listos`;
  els.runId.textContent = state.runId || 'sin ejecución';
  setBadge(`${done}/${total}`, snapshot.status === 'paused' ? '#f0b64b' : '#2f7df6');
  const running = ['running', 'paused'].includes(snapshot.status);
  els.start.disabled = running || state.busy;
  els.pause.disabled = !running;
  els.stop.disabled = !running;
  els.pause.textContent = snapshot.status === 'paused' ? 'Reanudar' : 'Pausar';
  renderQueue(snapshot);
}

function statusLabel(status) {
  return (
    {
      idle: 'en espera',
      running: 'generando',
      paused: 'en pausa',
      stopped: 'detenida',
      completed: 'completada',
      'completed-with-errors': 'completada con errores',
      failed: 'falló',
    }[status] ?? status
  );
}

async function startQueue() {
  if (state.busy) return;
  if (!state.prompts.length) {
    log('No hay prompts para generar.');
    return;
  }
  const model = effectiveModel();
  if (!model) {
    log('Elegí un modelo de imagen.');
    return;
  }
  state.busy = true;
  renderStartSummary();
  try {
    const connected = await connect();
    if (!connected) throw new Error('no se pudo conectar con la pestaña de Flow');
    if (!state.diagnostics?.ready) {
      throw new Error('Flow no está listo: falta el cuadro de prompt o el botón de generar');
    }

    log(`Aplicando configuración "${model}" ${state.settings.aspect} x${state.settings.count}…`);
    if (state.settings.skipModel) {
      log('Configuración de Flow omitida: se usa la que ya está elegida en la página.');
    } else {
      const response = await sendToTab({
        type: 'FLOWQ_APPLY_SETTINGS',
        settings: {
          model,
          mode: state.settings.mode,
          aspect: state.settings.aspect,
          count: state.settings.count,
        },
      });
      const applied = response.settings;
      if (!applied?.verified) {
        throw new Error(
          `Flow no confirmó el modelo "${model}" (observado: ${applied?.observed || 'sin lectura'})`,
        );
      }
      log(
        `Flow: ${applied.mode === 'video' ? 'Video' : 'Imagen'} ${applied.aspect} x${applied.count} · ${applied.model}.`,
      );
    }

    if (state.references.length > 0) {
      if (state.settings.skipReferences) {
        log('Referencias omitidas: se usan las que ya están adjuntas en Flow.');
      } else {
        log(`Adjuntando ${state.references.length} referencia(s)…`);
        try {
          const response = await sendToTab({
            type: 'FLOWQ_SET_REFERENCES',
            images: state.references.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
          });
          log(`Referencias adjuntadas: ${response.references?.count ?? 0}.`);
        } catch (error) {
          throw new Error(
            `${messageOf(error)} — agregalas a mano en Flow y activá “Ya adjunté estas referencias”.`,
          );
        }
      }
    }

    const runId = runIdFromDate(new Date());
    state.runId = runId;
    state.results = [];
    state.lastRunStatus = null;
    state.logLines = state.logLines.slice(-50);
    els.runId.textContent = runId;
    els.downloadManifest.disabled = true;
    save(RESULTS_KEY, [], 0);

    const total = state.prompts.length;
    const engine = new QueueEngine({
      prompts: state.prompts,
      delayMs: Math.max(0, Number(state.settings.delaySeconds) || 0) * 1_000,
      continueOnError: Boolean(state.settings.continueOnError),
      runPrompt: async (prompt, index) => {
        log(`[${index + 1}/${total}] ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}`);
        const response = await sendToTab({
          type: 'FLOWQ_RUN_PROMPT',
          prompt,
          timeoutMs: Math.max(30, Number(state.settings.timeoutSeconds) || 180) * 1_000,
        });
        const image = response.image;
        if (!image) throw new Error('Flow no devolvió una imagen');
        const filename = resultFileName({
          index,
          total,
          prompt,
          mime: image.mime,
          runId,
        });
        if (image.dataUrl) {
          await downloadDataUrl(image.dataUrl, filename);
        } else if (image.url) {
          await downloadRemoteUrl(image.url, filename);
        } else {
          throw new Error(image.note || 'la imagen no se pudo descargar');
        }
        const record = {
          index,
          prompt,
          filename,
          mime: image.mime || 'image/png',
          bytes: image.bytes ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
          sourceUrl: image.src ?? image.url ?? null,
          downloadedAt: new Date().toISOString(),
        };
        state.results.push(record);
        save(RESULTS_KEY, state.results, 0);
        log(`✓ ${filename}`);
        return record;
      },
      onUpdate: (snapshot) => {
        renderQueueProgress(snapshot);
        const current = snapshot.items.find((item) => item.status === 'running');
        if (current) {
          els.startSummary.textContent = `Generando ${current.index + 1} de ${snapshot.items.length} · ${snapshot.completedCount} lista(s)`;
        }
      },
    });

    state.queue = engine;
    els.start.disabled = true;
    els.pause.disabled = false;
    els.stop.disabled = false;
    els.pause.textContent = 'Pausar';
    const final = await engine.start();
    state.lastRunStatus = final.status;
    log(
      `Cola ${statusLabel(final.status)}: ${final.completedCount} imagen(es), ${final.failedCount} error(es).`,
    );
    if (state.results.length > 0) {
      els.downloadManifest.disabled = false;
      await downloadManifest();
      setBadge(final.completedCount === total ? '✓' : '!', final.completedCount === total ? '#37d38a' : '#ff6272');
    } else {
      setBadge('!', '#ff6272');
    }
  } catch (error) {
    log(`✗ ${messageOf(error)}`);
    setBadge('!', '#ff6272');
  } finally {
    state.busy = false;
    state.queue = null;
    els.pause.disabled = true;
    els.stop.disabled = true;
    els.pause.textContent = 'Pausar';
    renderStartSummary();
  }
}

function togglePause() {
  if (!state.queue) return;
  const status = state.queue.state().status;
  if (status === 'running') {
    state.queue.pause();
    log('Cola en pausa; termina el prompt en curso.');
  } else if (status === 'paused') {
    state.queue.resume();
    log('Cola reanudada.');
  }
}

function stopQueue() {
  if (!state.queue) return;
  state.queue.stop();
  log('Deteniendo la cola…');
}

async function downloadDataUrl(dataUrl, filename) {
  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
  } catch (error) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = filename.split('/').pop() || 'imagen.png';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (!dataUrl.startsWith('data:')) throw error;
    log('Descarga por enlace local (chrome.downloads no aceptó el data URL).');
  }
}

async function downloadRemoteUrl(url, filename) {
  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
}

async function downloadText(text, filename, mime = 'text/plain') {
  const dataUrl = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  await downloadDataUrl(dataUrl, filename);
}

function manifestData() {
  return buildManifest({
    runId: state.runId,
    model: effectiveModel(),
    referenceUse: state.settings.referenceUse,
    references: state.references,
    settings: {
      delaySeconds: Number(state.settings.delaySeconds) || 0,
      timeoutSeconds: Number(state.settings.timeoutSeconds) || 180,
      continueOnError: Boolean(state.settings.continueOnError),
      skipModel: Boolean(state.settings.skipModel),
      skipReferences: Boolean(state.settings.skipReferences),
      mode: state.settings.mode,
      aspect: state.settings.aspect,
      count: Number(state.settings.count) || 1,
    },
    status: state.lastRunStatus,
    prompts: state.prompts,
    results: state.results,
  });
}

async function downloadManifest() {
  if (!state.runId || state.results.length === 0) {
    log('Todavía no hay resultados para el manifiesto.');
    return;
  }
  const filename = manifestFileName(state.runId);
  await downloadText(JSON.stringify(manifestData(), null, 2), filename, 'application/json');
  log(`Manifiesto: ${filename}`);
}

async function exportPrompts() {
  if (!state.prompts.length) {
    log('No hay prompts para exportar.');
    return;
  }
  const name = `flow-prompts-${runIdFromDate(new Date())}.txt`;
  await downloadText(state.prompts.join('\n'), name);
  log(`Prompts exportados: ${name}`);
}

function bindEvents() {
  els.connect.addEventListener('click', () => void connect());
  els.start.addEventListener('click', () => void startQueue());
  els.pause.addEventListener('click', togglePause);
  els.stop.addEventListener('click', stopQueue);
  els.downloadManifest.addEventListener('click', () => void downloadManifest());
  els.exportPrompts.addEventListener('click', () => void exportPrompts());

  els.model.addEventListener('change', () => {
    const custom = els.model.value === '__custom';
    els.modelCustom.classList.toggle('hidden', !custom);
    state.settings.customModel = custom ? els.modelCustom.value.trim() : '';
    state.settings.model = custom ? state.settings.customModel : els.model.value;
    save(SETTINGS_KEY, state.settings);
    renderStartSummary();
  });
  els.modelCustom.addEventListener('input', () => {
    state.settings.customModel = els.modelCustom.value.trim();
    state.settings.model = state.settings.customModel;
    save(SETTINGS_KEY, state.settings);
    renderStartSummary();
  });
  els.mode.addEventListener('change', () => {
    state.settings.mode = els.mode.value === 'video' ? 'video' : 'image';
    save(SETTINGS_KEY, state.settings);
    renderStartSummary();
  });
  els.aspect.addEventListener('change', () => {
    state.settings.aspect = els.aspect.value;
    save(SETTINGS_KEY, state.settings);
    renderStartSummary();
  });
  els.count.addEventListener('change', () => {
    state.settings.count = Math.max(1, Math.min(4, Number(els.count.value) || 1));
    save(SETTINGS_KEY, state.settings);
    renderStartSummary();
  });
  els.referenceUse.addEventListener('change', () => {
    state.settings.referenceUse = els.referenceUse.value;
    save(SETTINGS_KEY, state.settings);
  });
  els.delay.addEventListener('input', () => {
    state.settings.delaySeconds = Math.max(0, Math.min(120, Number(els.delay.value) || 0));
    save(SETTINGS_KEY, state.settings);
  });
  els.timeout.addEventListener('input', () => {
    state.settings.timeoutSeconds = Math.max(30, Math.min(600, Number(els.timeout.value) || 180));
    save(SETTINGS_KEY, state.settings);
  });
  els.continueOnError.addEventListener('change', () => {
    state.settings.continueOnError = els.continueOnError.checked;
    save(SETTINGS_KEY, state.settings);
  });
  els.skipModel.addEventListener('change', () => {
    state.settings.skipModel = els.skipModel.checked;
    save(SETTINGS_KEY, state.settings);
  });
  els.skipReferences.addEventListener('change', () => {
    state.settings.skipReferences = els.skipReferences.checked;
    save(SETTINGS_KEY, state.settings);
  });

  let promptTimer = null;
  els.prompts.addEventListener('input', () => {
    if (promptTimer) clearTimeout(promptTimer);
    promptTimer = setTimeout(() => refreshPrompts(), 250);
  });
  els.clearPrompts.addEventListener('click', () => {
    if (!els.prompts.value.trim() || window.confirm('¿Limpiar todos los prompts?')) {
      els.prompts.value = '';
      refreshPrompts();
      log('Prompts borrados.');
    }
  });
  els.promptFile.addEventListener('change', async () => {
    const file = els.promptFile.files?.[0];
    els.promptFile.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      els.prompts.value = text;
      refreshPrompts();
      log(`Importado ${file.name}: ${state.prompts.length} prompt(s).`);
    } catch (error) {
      log(`No se pudo importar ${file.name}: ${messageOf(error)}`);
    }
  });

  els.referenceInput.addEventListener('change', async () => {
    const files = els.referenceInput.files ?? [];
    els.referenceInput.value = '';
    try {
      await addReferenceFiles(files);
    } catch (error) {
      log(`No se pudieron agregar referencias: ${messageOf(error)}`);
    }
  });
  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropzone.classList.add('drag');
  });
  els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('drag'));
  els.dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('drag');
    try {
      await addReferenceFiles(event.dataTransfer?.files ?? []);
    } catch (error) {
      log(`No se pudieron agregar referencias: ${messageOf(error)}`);
    }
  });

  window.addEventListener('beforeunload', () => {
    state.queue?.stop();
  });
}

async function init() {
  bindEvents();
  await loadState();
  renderQueue();
  void connect();
}

void init();
