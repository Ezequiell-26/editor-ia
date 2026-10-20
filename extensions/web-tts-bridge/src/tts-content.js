/**
 * Web TTS Bridge content script.
 *
 * Injected on demand by the side panel after the user grants host permission.
 * It fills the visible text box, clicks a named generate control, waits for an
 * audio source and asks the background worker to download it. It never handles
 * login, payment or CAPTCHA; those return a blocked status.
 */

(() => {
  if (globalThis.__EDITORIA_TTS_CONTENT__) return;
  globalThis.__EDITORIA_TTS_CONTENT__ = true;

  let adapterPromise = null;
  function getAdapter() {
    if (!adapterPromise) {
      adapterPromise = import(chrome.runtime.getURL('src/lib/adapter.js'));
    }
    return adapterPromise;
  }

  function absoluteUrl(raw) {
    try {
      return new URL(raw, location.href).toString();
    } catch {
      return '';
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('no se pudo leer el audio generado'));
      reader.readAsDataURL(blob);
    });
  }

  async function downloadFromUrl(url, filename) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size > 25 * 1024 * 1024) throw new Error('el audio supera 25 MB');
      const dataUrl = await blobToDataUrl(blob);
      const result = await chrome.runtime.sendMessage({
        type: 'download-tts-audio',
        dataUrl,
        filename,
      });
      if (!result?.ok) throw new Error(result?.error ?? 'la descarga falló');
      return { status: 'success', message: 'Audio generado y descargado correctamente.', source: 'data' };
    } catch {
      // Signed URLs or cross-origin CDNs may reject fetch; let Chrome download
      // the URL directly, preserving normal browser cookies.
      const result = await chrome.runtime.sendMessage({
        type: 'download-tts-audio',
        url,
        filename,
      });
      if (result?.ok) {
        return { status: 'success', message: 'Audio generado y descargado correctamente.', source: 'url' };
      }
      return { status: 'failed', error: result?.error ?? 'no se pudo descargar el audio' };
    }
  }

  async function run(text) {
    const adapter = await getAdapter();
    const initialBlock = adapter.findPageBlock(document, window);
    if (initialBlock) {
      return {
        status: 'blocked',
        error: `La página está bloqueada por ${initialBlock.kind}: ${initialBlock.detail}. Iniciá sesión o resolvé el desafío manualmente y volvé a intentar; la extensión no los evita.`,
      };
    }

    const input = adapter.findTextInput(document, window);
    if (!input) {
      return {
        status: 'failed',
        error: 'No encontré un cuadro de texto visible. Abrí el generador de voz de la web y volvé a intentar.',
      };
    }
    adapter.setTextValue(input, text, window);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const generate = adapter.findGenerateButton(document, window);
    if (!generate) {
      return {
        status: 'failed',
        error: 'No encontré un botón de generar/sintetizar con un nombre reconocible (生成, 合成, 转换, 朗读…).',
      };
    }
    generate.element.click();

    const result = await adapter.waitForAudio(document, window, { timeoutMs: 120_000 });
    if (result.block) {
      return {
        status: 'blocked',
        error: `La página pasó a un bloqueo de ${result.block.kind}: ${result.block.detail}. La extensión no evade login ni captcha.`,
      };
    }
    if (result.timeout || !result.audio) {
      return {
        status: 'failed',
        error: 'La síntesis no produjo un audio detectable en 120 segundos. Revisá la web y volvé a intentar.',
      };
    }

    const url = absoluteUrl(result.audio.url);
    const filename = `web-tts/${adapter.timestampName()}-${adapter.slugify(document.title || text)}.mp3`;
    if (url && /^https?:/i.test(url)) {
      return downloadFromUrl(url, filename);
    }

    const control = adapter.findDownloadControl(document, window);
    if (control) {
      control.element.click();
      return {
        status: 'success',
        message: 'Se pulsó el botón de descarga de la web. Revisá la carpeta de Descargas; la extensión no pudo verificar el archivo.',
        source: 'download-control',
      };
    }

    return {
      status: 'failed',
      error: 'Encontré audio pero no pude descargarlo (URL no HTTP y sin botón de descarga reconocible).',
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'editoria-tts-run') return false;
    const text = String(message.text ?? '').trim();
    if (!text) {
      sendResponse({ status: 'failed', error: 'El texto está vacío.' });
      return false;
    }
    if (text.length > 4_000) {
      sendResponse({ status: 'failed', error: 'El texto supera los 4000 caracteres.' });
      return false;
    }
    run(text)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          status: 'failed',
          error: error instanceof Error ? error.message : 'la tarea web falló',
        });
      });
    return true;
  });
})();
