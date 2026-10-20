/**
 * Download bridge for Web TTS.
 *
 * Only accepts audio data URLs or HTTPS/HTTP URLs under `web-tts/`. It never
 * reads cookies or credentials.
 */

const MAX_DATA_URL_CHARS = 35 * 1024 * 1024;

function safeFilename(value) {
  const base = String(value ?? 'audio')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'audio'}.mp3`;
}

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'download-tts-audio') return false;
  const filename = `web-tts/${safeFilename(message.filename)}`;
  let url = '';
  if (typeof message.dataUrl === 'string') {
    if (!/^data:audio\//i.test(message.dataUrl) && !/^data:application\/octet-stream/i.test(message.dataUrl)) {
      sendResponse({ ok: false, error: 'el data URL no es de audio' });
      return false;
    }
    if (message.dataUrl.length > MAX_DATA_URL_CHARS) {
      sendResponse({ ok: false, error: 'el audio supera el límite de descarga' });
      return false;
    }
    url = message.dataUrl;
  } else if (typeof message.url === 'string' && isAllowedUrl(message.url)) {
    url = message.url;
  } else {
    sendResponse({ ok: false, error: 'URL de descarga no válida' });
    return false;
  }

  chrome.downloads.download(
    { url, filename, saveAs: false, conflictAction: 'uniquify' },
    (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error || !downloadId) {
        sendResponse({ ok: false, error: error?.message ?? 'Chrome rechazó la descarga' });
        return;
      }
      sendResponse({ ok: true, downloadId });
    },
  );
  return true;
});
