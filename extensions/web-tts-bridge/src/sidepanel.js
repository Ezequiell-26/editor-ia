const $ = (id) => document.getElementById(id);
const urlInput = $('url');
const textArea = $('text');
const statusNode = $('status');
const tabInfo = $('tab-info');
const runButton = $('run');
const openButton = $('open');
const refreshButton = $('refresh');
const clearButton = $('clear');
const downloadsButton = $('downloads');

let activeTabId = null;
let activeTabUrl = '';

function setStatus(kind, message) {
  statusNode.className = `status ${kind}`;
  statusNode.textContent = message;
}

function setBusy(busy) {
  runButton.disabled = busy;
  runButton.textContent = busy ? 'Trabajando…' : 'Generar y descargar';
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function refreshActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  activeTabId = tab?.id ?? null;
  activeTabUrl = tab?.url ?? '';
  if (activeTabUrl && isHttps(activeTabUrl)) {
    urlInput.value = activeTabUrl;
    tabInfo.textContent = `Pestaña activa: ${activeTabUrl}`;
  } else {
    tabInfo.textContent = activeTabUrl
      ? `La pestaña activa no es HTTPS: ${activeTabUrl}`
      : 'No hay una pestaña HTTPS activa. Abrí la web de voz en una pestaña.';
  }
}

async function openWeb() {
  const value = urlInput.value.trim();
  if (!isHttps(value)) {
    setStatus('failed', 'Escribí una URL HTTPS válida.');
    return;
  }
  await chrome.storage.local.set({ lastUrl: value });
  await chrome.tabs.create({ url: value });
  setStatus('working', 'Web abierta. Iniciá sesión manualmente si la web lo pide y volvé a esta pestaña.');
}

async function runTask() {
  const text = textArea.value.trim();
  if (!text) {
    setStatus('failed', 'Pegá el texto que querés convertir.');
    return;
  }
  if (!activeTabId || !isHttps(activeTabUrl)) {
    setStatus('failed', 'Abrí la web de voz en una pestaña HTTPS y volvé a intentar.');
    return;
  }
  const requested = urlInput.value.trim();
  try {
    if (new URL(requested).origin !== new URL(activeTabUrl).origin) {
      setStatus('failed', 'La URL escrita no coincide con la pestaña activa. Abrila y volvé a intentar.');
      return;
    }
  } catch {
    setStatus('failed', 'La URL escrita no es válida.');
    return;
  }

  setBusy(true);
  setStatus('working', 'Pidiendo permiso para este sitio…');
  try {
    const origin = `${new URL(activeTabUrl).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      setStatus('failed', 'No se concedió permiso para este sitio. La tarea no se ejecutó.');
      return;
    }

    setStatus('working', 'Inyectando el asistente en la página…');
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['src/tts-content.js'],
    });

    setStatus('working', 'Escribiendo el texto y esperando el audio…');
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: 'editoria-tts-run',
      text,
    });
    if (!response) {
      setStatus('failed', 'La página no respondió. Recargala y volvé a intentar.');
      return;
    }
    if (response.status === 'success') {
      setStatus('success', response.message ?? 'Audio generado y descargado correctamente.');
      downloadsButton.hidden = false;
    } else if (response.status === 'blocked') {
      setStatus('blocked', response.error ?? 'La página requiere una acción manual.');
      downloadsButton.hidden = true;
    } else {
      setStatus('failed', response.error ?? 'La tarea falló sin detalle.');
      downloadsButton.hidden = true;
    }
  } catch (error) {
    setStatus('failed', error instanceof Error ? error.message : 'la tarea web falló');
  } finally {
    setBusy(false);
  }
}

async function restore() {
  const stored = await chrome.storage.local.get(['lastUrl', 'lastText']);
  if (stored.lastText) textArea.value = stored.lastText;
  if (stored.lastUrl) urlInput.value = stored.lastUrl;
  downloadsButton.hidden = true;
  await refreshActiveTab();
}

textArea.addEventListener('input', () => {
  chrome.storage.local.set({ lastText: textArea.value }).catch(() => {});
});
urlInput.addEventListener('input', () => {
  chrome.storage.local.set({ lastUrl: urlInput.value }).catch(() => {});
});

openButton.addEventListener('click', () => {
  void openWeb();
});
refreshButton.addEventListener('click', () => {
  void refreshActiveTab();
});
runButton.addEventListener('click', () => {
  void runTask();
});
clearButton.addEventListener('click', () => {
  textArea.value = '';
  chrome.storage.local.remove('lastText').catch(() => {});
  setStatus('idle', 'Esperando una tarea.');
});
downloadsButton.addEventListener('click', () => {
  chrome.downloads.showDefaultFolder();
});
chrome.tabs.onActivated.addListener(() => {
  void refreshActiveTab();
});
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.status === 'complete') void refreshActiveTab();
});

void restore();
