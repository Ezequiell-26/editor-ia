const PORTS = Array.from({ length: 11 }, (_, index) => 47615 + index);
const STAGE_LABELS = {
  engine: 'Motor',
  probing: 'Analizando',
  downloading: 'Descargando',
  compressing: 'Comprimiendo',
  starting: 'Preparando',
  done: 'Listo',
  error: 'Error',
};

const $ = (id) => document.getElementById(id);

const state = {
  port: null,
  token: null,
  probe: null,
  directImage: false,
  polling: null,
  tabId: null,
};

function setHidden(id, hidden) {
  $(id).classList.toggle('hidden', hidden);
}

function setConnection(connected) {
  $('connection').classList.toggle('connected', connected);
  $('connection').title = connected ? 'Conectado a Editor IA' : 'Sin conectar';
}

function error(message) {
  $('error').textContent = message || '';
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), milliseconds)),
  ]);
}

async function findPort() {
  for (const port of PORTS) {
    try {
      const response = await withTimeout(
        fetch(`http://127.0.0.1:${port}/v1/health`, { cache: 'no-store' }),
        700,
      );
      if (response.ok) return port;
    } catch {
      // Probamos el siguiente puerto.
    }
  }
  return null;
}

async function ping(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, {
    headers: { 'X-EditorIA-Token': token },
    cache: 'no-store',
  });
  return response.ok;
}

async function api(path, body) {
  if (!state.port || !state.token) throw new Error('Conectá la extensión con Editor IA.');
  const response = await fetch(`http://127.0.0.1:${state.port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-EditorIA-Token': state.token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Editor IA respondió ${response.status}.`);
  }
  return data;
}

function showReady() {
  setHidden('pair', true);
  setHidden('ready', false);
  setConnection(true);
}

function showPair(message) {
  setHidden('ready', true);
  setHidden('pair', false);
  setConnection(false);
  $('pairError').textContent = message || '';
}

async function pair() {
  error('');
  $('pairError').textContent = '';
  const raw = $('token').value.trim();
  if (!raw) {
    $('pairError').textContent = 'Pegá la conexión que muestra Editor IA.';
    return;
  }
  try {
    let port;
    let token = raw;
    const pairMatch = raw.match(/^(\d{2,5}):([0-9a-fA-F]{32,})$/);
    if (pairMatch) {
      port = Number(pairMatch[1]);
      token = pairMatch[2];
    } else {
      port = await findPort();
    }
    if (!port || !(await ping(port, token).catch(() => false))) {
      port = await findPort();
    }
    if (!port) {
      throw new Error('Abrí Editor IA para que la extensión pueda conectarse.');
    }
    if (!(await ping(port, token))) {
      throw new Error('El token no coincide. Copiá la conexión de nuevo desde Editor IA.');
    }
    state.port = port;
    state.token = token;
    await chrome.storage.local.set({ editoriaPort: port, editoriaToken: token });
    $('token').value = '';
    showReady();
    const pending = new URLSearchParams(location.search).get('url');
    if (pending) {
      $('url').value = pending;
      await analyze();
    }
  } catch (reason) {
    $('pairError').textContent =
      reason instanceof Error ? reason.message : 'No se pudo conectar.';
  }
}

async function restoreConnection() {
  const stored = await chrome.storage.local.get(['editoriaPort', 'editoriaToken']);
  if (!stored.editoriaToken) {
    showPair('');
    return false;
  }
  try {
    let port = stored.editoriaPort;
    if (!port || !(await ping(port, stored.editoriaToken).catch(() => false))) {
      port = await findPort();
    }
    if (!port || !(await ping(port, stored.editoriaToken))) {
      showPair('Abrí Editor IA para reconectar la extensión.');
      return false;
    }
    state.port = port;
    state.token = stored.editoriaToken;
    await chrome.storage.local.set({ editoriaPort: port });
    showReady();
    return true;
  } catch {
    showPair('Abrí Editor IA para reconectar la extensión.');
    return false;
  }
}

function collectMedia() {
  const clean = (value) => (value && !/^(blob:|data:)/i.test(value) ? value : '');
  const images = [];
  const seen = new Set();
  for (const image of document.images) {
    const url = clean(image.currentSrc || image.src);
    if (!url || seen.has(url) || image.naturalWidth < 180 || image.naturalHeight < 120) continue;
    seen.add(url);
    images.push({
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      alt: image.alt || '',
    });
    if (images.length >= 12) break;
  }
  const videos = [];
  for (const video of document.querySelectorAll('video')) {
    const poster = clean(video.poster);
    if (!poster && !video.currentSrc) continue;
    videos.push({
      poster,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    });
    if (videos.length >= 6) break;
  }
  return { images, videos };
}

function renderMedia(media) {
  const grid = $('mediaGrid');
  grid.textContent = '';
  const images = Array.isArray(media?.images) ? media.images : [];
  const videos = Array.isArray(media?.videos) ? media.videos : [];
  if (images.length === 0 && videos.length === 0) {
    setHidden('media', true);
    return;
  }
  setHidden('media', false);
  for (const image of images) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-thumb';
    button.title = image.alt || image.url;
    const thumbnail = document.createElement('img');
    thumbnail.src = image.url;
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    const dimensions = document.createElement('span');
    dimensions.textContent = `${image.width}×${image.height}`;
    button.append(thumbnail, dimensions);
    button.addEventListener('click', () => {
      for (const selected of grid.querySelectorAll('.selected')) {
        selected.classList.remove('selected');
      }
      button.classList.add('selected');
      state.directImage = true;
      $('url').value = image.url;
      void analyze();
    });
    grid.appendChild(button);
  }
  for (const video of videos) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-thumb';
    button.title = 'Video de la página';
    const label = document.createElement('span');
    label.textContent =
      video.width && video.height ? `Video ${video.width}×${video.height}` : 'Video';
    if (video.poster) {
      const thumbnail = document.createElement('img');
      thumbnail.src = video.poster;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      button.appendChild(thumbnail);
    }
    button.appendChild(label);
    button.addEventListener('click', () => {
      state.directImage = false;
      void analyze();
    });
    grid.appendChild(button);
  }
  $('pageBtn').onclick = () => {
    state.directImage = false;
    void analyze();
  };
}

async function detectMedia() {
  if (!state.tabId) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      func: collectMedia,
    });
    renderMedia(result?.result);
  } catch {
    setHidden('media', true);
  }
}

function fillQuality(probe) {
  const select = $('quality');
  select.textContent = '';
  const qualities = Array.isArray(probe?.qualities) ? probe.qualities : [];
  if (qualities.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'La mejor disponible';
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  for (const quality of qualities) {
    const option = document.createElement('option');
    option.value = String(quality.height);
    const pieces = [quality.label];
    if (quality.fps) pieces.push(`${Math.round(quality.fps)} fps`);
    if (quality.ext) pieces.push(String(quality.ext).toUpperCase());
    if (quality.filesize) pieces.push(`≈ ${formatBytes(quality.filesize)}`);
    option.textContent = pieces.join(' · ');
    select.appendChild(option);
  }
  select.value = String(probe.maxHeight || qualities[0].height);
  select.disabled = false;
}

function updateOptions() {
  const probe = state.probe;
  const isImage = state.directImage || probe?.kind === 'image';
  const format = $('format').value;
  const audioOnly = format === 'mp3' || format === 'm4a';
  setHidden('options', isImage);
  setHidden('imageNote', !isImage);
  if (isImage) {
    $('compression').value = 'none';
    return;
  }
  $('quality').disabled = audioOnly || !(probe?.qualities?.length > 0);
  $('compression').disabled = format !== 'mp4' || audioOnly;
  $('codec').disabled = format !== 'mp4' || $('compression').value === 'none' || audioOnly;
  if (format !== 'mp4' || audioOnly) {
    $('compression').value = 'none';
  }
}

function renderProbe(probe) {
  const pieces = [];
  if (probe.uploader) pieces.push(probe.uploader);
  if (probe.durationSeconds) pieces.push(formatDuration(probe.durationSeconds));
  if (probe.entryCount > 1) pieces.push(`${probe.entryCount} elementos`);
  if (probe.estimatedBytes) pieces.push(`≈ ${formatBytes(probe.estimatedBytes)}`);
  if (probe.maxHeight) pieces.push(`máx. ${probe.maxHeight}p`);
  $('probeTitle').textContent = probe.title || 'Contenido';
  $('probeMeta').textContent = pieces.join(' · ');
  $('format').value = state.directImage
    ? 'mp4'
    : probe.kind === 'audio'
      ? 'm4a'
      : 'mp4';
  $('compression').value = state.directImage || probe.kind === 'image' ? 'none' : 'balanced';
  fillQuality(probe);
  updateOptions();
  setHidden('probe', false);
  setHidden('result', true);
  $('downloadBtn').disabled = false;
}

async function analyze() {
  const url = $('url').value.trim();
  if (!url) {
    error('Pegá una URL o elegí una imagen de la página.');
    return;
  }
  error('');
  if (state.polling) {
    clearInterval(state.polling);
    state.polling = null;
  }
  setHidden('progress', true);
  setHidden('result', true);
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = 'Analizando…';
  try {
    const probe = await api('/v1/probe', {
      url,
      directImage: state.directImage,
    });
    state.probe = probe;
    renderProbe(probe);
  } catch (reason) {
    error(reason instanceof Error ? reason.message : 'No se pudo analizar la URL.');
    setHidden('probe', true);
  } finally {
    $('analyzeBtn').disabled = false;
    $('analyzeBtn').textContent = 'Analizar';
  }
}

function renderProgress(job) {
  setHidden('progress', false);
  $('stage').textContent = STAGE_LABELS[job.stage] || job.stage || 'Descargando';
  $('percent').textContent = job.percent != null ? `${Math.round(job.percent)}%` : '';
  $('barFill').style.width = `${Math.max(0, Math.min(100, job.percent || 0))}%`;
  $('message').textContent = job.message || '';
}

function renderResult(job) {
  const card = $('result');
  card.textContent = '';
  setHidden('result', false);
  const heading = document.createElement('p');
  heading.className = 'eyebrow';
  heading.textContent = 'Guardado en Descargas/Videos descargados';
  card.appendChild(heading);
  const list = document.createElement('ul');
  for (const file of job.files || []) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    const size = document.createElement('strong');
    size.textContent = formatBytes(file.bytes);
    item.append(name, size);
    list.appendChild(item);
  }
  card.appendChild(list);
}

async function poll(jobId) {
  const started = Date.now();
  state.polling = setInterval(async () => {
    if (Date.now() - started > 30 * 60 * 1000) {
      clearInterval(state.polling);
      state.polling = null;
      $('downloadBtn').disabled = false;
      error('La descarga sigue en la app, pero la extensión dejó de esperar.');
      return;
    }
    try {
      const job = await api(`/v1/jobs/${jobId}`);
      renderProgress(job);
      if (job.status === 'done') {
        clearInterval(state.polling);
        state.polling = null;
        setHidden('progress', true);
        renderResult(job);
        $('downloadBtn').disabled = false;
        $('downloadBtn').textContent = 'Descargar otra vez';
      } else if (job.status === 'error') {
        clearInterval(state.polling);
        state.polling = null;
        $('downloadBtn').disabled = false;
        error(job.error || job.message || 'La descarga falló.');
      }
    } catch (reason) {
      clearInterval(state.polling);
      state.polling = null;
      $('downloadBtn').disabled = false;
      error(reason instanceof Error ? reason.message : 'Se perdió la conexión con Editor IA.');
    }
  }, 900);
}

async function download() {
  const probe = state.probe;
  if (!probe) return;
  error('');
  $('downloadBtn').disabled = true;
  $('downloadBtn').textContent = 'Descargando…';
  try {
    const job = await api('/v1/download', {
      url: $('url').value.trim(),
      maxHeight: $('quality').value ? Number($('quality').value) : null,
      format: $('format').value,
      compression: state.directImage ? 'none' : $('compression').value,
      codec: $('codec').value,
      kind: state.directImage ? 'image' : probe.kind,
      playlist: probe.kind === 'gallery',
      directImage: state.directImage,
    });
    renderProgress(job);
    await poll(job.id);
  } catch (reason) {
    $('downloadBtn').disabled = false;
    $('downloadBtn').textContent = 'Descargar';
    error(reason instanceof Error ? reason.message : 'No se pudo iniciar la descarga.');
  }
}

async function boot() {
  $('pairBtn').addEventListener('click', () => void pair());
  $('token').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void pair();
  });
  $('analyzeBtn').addEventListener('click', () => void analyze());
  $('url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void analyze();
  });
  $('downloadBtn').addEventListener('click', () => void download());
  $('format').addEventListener('change', updateOptions);
  $('compression').addEventListener('change', updateOptions);

  const ready = await restoreConnection();
  const params = new URLSearchParams(location.search);
  const directImage = params.get('directImage') === '1';
  const providedUrl = params.get('url');
  if (providedUrl) {
    state.directImage = directImage;
    $('url').value = providedUrl;
    if (ready) await analyze();
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id ?? null;
    if (tab?.url && !/^(chrome|edge|about|extension):/i.test(tab.url)) {
      $('url').value = tab.url;
    }
    if (ready) void detectMedia();
  } catch {
    // Sin pestaña activa la URL se puede pegar a mano.
  }
}

void boot();
