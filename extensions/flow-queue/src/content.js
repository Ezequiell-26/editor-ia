/**
 * Flow Queue content script.
 *
 * Runs in Flow's page, uses the conservative adapter, and only acts when the
 * side panel explicitly asks for it. It never reads credentials or leaves the
 * Flow origin. Images are converted to data URLs so the side panel can save
 * them with chrome.downloads, even when Flow serves them from a signed URL.
 */

(() => {
  if (globalThis.__FLOWQ_CONTENT__) return;
  globalThis.__FLOWQ_CONTENT__ = true;

  let adapterPromise = null;
  let running = false;

  function getAdapter() {
    if (!adapterPromise) {
      adapterPromise = import(chrome.runtime.getURL('src/lib/adapter.js'));
    }
    return adapterPromise;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function clickElement(element) {
    if (!element) return false;
    try {
      element.scrollIntoView?.({ block: 'center', inline: 'center' });
    } catch {
      // Detached or non-scrollable elements are still clickable.
    }
    element.click();
    return true;
  }

  async function findFileInputWithRetry(adapter) {
    let input = adapter.findFileInput(document);
    if (input) return input;
    const addButton = [...document.querySelectorAll('button, [role="button"], label')].find(
      (element) =>
        adapter.isVisible(element, window) &&
        /(?:añadir|anadir|add|subir|upload)\s+(?:imágenes|imagenes|images?|referencias?)/i.test(
          adapter.accessibleName(element),
        ) &&
        !/modelo|model/i.test(adapter.accessibleName(element)),
    );
    if (addButton) {
      clickElement(addButton);
      await sleep(400);
      input = adapter.findFileInput(document);
    }
    return input ?? null;
  }

  async function dataUrlToFile(image) {
    const response = await fetch(image.dataUrl);
    if (!response.ok) throw new Error('la referencia guardada ya no se pudo leer');
    const blob = await response.blob();
    return new File([blob], image.name || 'reference.png', {
      type: image.type || blob.type || 'image/png',
    });
  }

  async function applyReferences(images) {
    const adapter = await getAdapter();
    if (!Array.isArray(images) || images.length === 0) {
      return { count: 0, note: 'sin referencias' };
    }
    if (images.length > 4) {
      throw new Error('Flow admite como máximo 4 referencias');
    }
    const input = await findFileInputWithRetry(adapter);
    if (!input) {
      throw new Error(
        'no encontré el input de imágenes de Flow; abrí el selector de referencias y reintentá',
      );
    }

    const transfer = new DataTransfer();
    for (const image of images) {
      transfer.items.add(await dataUrlToFile(image));
    }

    let assigned = false;
    try {
      input.files = transfer.files;
      assigned = input.files?.length === transfer.files.length;
    } catch {
      assigned = false;
    }

    if (!assigned) {
      const dropTarget = input.closest('label, [role="button"], [data-testid]') ?? document.body;
      try {
        const drop = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        });
        dropTarget.dispatchEvent(drop);
        assigned = true;
      } catch {
        assigned = false;
      }
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500);

    if (!assigned) {
      throw new Error('Flow no aceptó las referencias; agregalas manualmente y reintentá');
    }
    return {
      count: transfer.files.length,
      names: [...transfer.files].map((file) => file.name),
    };
  }

  async function applyModel(model) {
    const adapter = await getAdapter();
    const wanted = String(model ?? '').trim();
    if (!wanted) throw new Error('elegí un modelo antes de iniciar la cola');

    const before = adapter.findModelCandidates(document, wanted);
    if (before.length === 0) {
      throw new Error(
        `no encontré "${wanted}" en el selector de Flow; verificá el nombre exacto del modelo`,
      );
    }

    const isOption = (element) =>
      element.matches?.('[role="menuitem"], [role="option"], [role="radio"]') ?? false;
    const exactOption = before.find(
      (element) =>
        isOption(element) &&
        adapter.accessibleName(element).trim().toLocaleLowerCase('es') ===
          wanted.toLocaleLowerCase('es'),
    );
    if (exactOption) {
      clickElement(exactOption);
      await sleep(350);
      return { verified: true, model: wanted, via: 'option' };
    }

    const trigger = before.find(
      (element) =>
        !isOption(element) &&
        (element.matches?.('button, [role="button"]') ||
          element.getAttribute?.('aria-haspopup')),
    );

    if (trigger) {
      const triggerName = adapter.accessibleName(trigger).toLocaleLowerCase('es');
      clickElement(trigger);
      await sleep(500);
      const options = adapter
        .findModelCandidates(document, wanted)
        .filter((element) => element !== trigger && !trigger.contains(element));
      if (options.length > 0) {
        const exact =
          options.find(
            (element) =>
              adapter.accessibleName(element).trim().toLocaleLowerCase('es') ===
              wanted.toLocaleLowerCase('es'),
          ) ?? options[0];
        clickElement(exact);
        await sleep(350);
        return { verified: true, model: wanted, via: 'menu' };
      }
      if (triggerName.includes(wanted.toLocaleLowerCase('es'))) {
        return {
          verified: false,
          model: wanted,
          via: 'trigger',
          note: 'el selector ya muestra el modelo; Flow no abrió un menú para verificarlo',
        };
      }
    }

    if (before.length === 1 && isOption(before[0])) {
      clickElement(before[0]);
      await sleep(350);
      return { verified: true, model: wanted, via: 'option' };
    }

    throw new Error(`no pude seleccionar "${wanted}" en Flow; elegilo a mano y reintentá`);
  }

  const MODE_LABELS = { image: 'Imagen', video: 'Video' };
  const ASPECTS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);

  async function applySettings({ model, mode = 'image', aspect = '16:9', count = 1 }) {
    const adapter = await getAdapter();
    const wanted = String(model ?? '').trim();
    if (!wanted) throw new Error('elegí un modelo antes de iniciar la cola');
    const settingsButton = adapter.findSettingsButton(document);
    if (!settingsButton) {
      throw new Error('no encontré el botón de configuración de Flow');
    }

    clickElement(settingsButton);
    await sleep(500);

    const clickOption = async (label, what) => {
      const option = adapter.findOptionByText(document, label);
      if (!option) throw new Error(`no encontré la opción de ${what} "${label}" en Flow`);
      clickElement(option);
      await sleep(220);
    };

    await clickOption(MODE_LABELS[mode] ?? 'Imagen', 'modo');
    const safeAspect = ASPECTS.has(aspect) ? aspect : '16:9';
    await clickOption(safeAspect, 'relación de aspecto');
    const safeCount = Math.max(1, Math.min(4, Number(count) || 1));
    await clickOption(`x${safeCount}`, 'cantidad de resultados');

    const familyButton = adapter.findOptionByText(
      document,
      'Seleccionar familia de modelos',
    );
    if (!familyButton) {
      throw new Error('no encontré el selector de familia de modelos de Flow');
    }
    const currentFamily = (familyButton.textContent ?? '').replace(/\s+/g, ' ').trim();
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchesWanted = new RegExp(`${escaped}(?![.\\d])`, 'i').test(currentFamily);
    if (!matchesWanted) {
      clickElement(familyButton);
      await sleep(400);
      const familyOption = adapter.findOptionByText(document, wanted);
      if (!familyOption) {
        throw new Error(`no encontré el modelo "${wanted}" en la familia de Flow`);
      }
      clickElement(familyOption);
      await sleep(300);
    }

    const prompt = adapter.findPromptInput(document);
    if (prompt) clickElement(prompt);
    await sleep(300);

    const observed = (adapter.findSettingsButton(document)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      model: wanted,
      mode,
      aspect: safeAspect,
      count: safeCount,
      observed,
      verified: new RegExp(`${escaped}(?![.\\d])`, 'i').test(observed),
    };
  }

  function confirmGenerationIfNeeded() {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((element) =>
      /generar|generate|continuar|continue|aceptar|confirm/i.test(element.textContent ?? ''),
    );
    if (!dialog) return false;
    const button = [...dialog.querySelectorAll('button, [role="button"]')].find((element) =>
      /^(?:generar|generate|continuar|continue|aceptar|confirmar|ok)$/i.test(
        (element.textContent ?? '').trim() || element.getAttribute('aria-label') || '',
      ),
    );
    if (button) {
      clickElement(button);
      return true;
    }
    return false;
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('no se pudo leer la imagen generada'));
      reader.readAsDataURL(blob);
    });
  }

  async function imageToDataUrl(result) {
    if (!result?.src) throw new Error('la imagen generada no tiene una fuente legible');
    if (result.src.startsWith('data:')) {
      const semicolon = result.src.indexOf(';');
      const mime = semicolon > 5 ? result.src.slice(5, semicolon) : 'image/png';
      return { dataUrl: result.src, mime };
    }
    try {
      const response = await fetch(result.src, { credentials: 'include' });
      if (!response.ok) throw new Error(`la descarga devolvió ${response.status}`);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('la imagen generada llegó vacía');
      if (blob.size > 30_000_000) throw new Error('la imagen supera 30 MB; descargala a mano');
      return {
        dataUrl: await blobToDataUrl(blob),
        mime: blob.type || 'image/png',
        bytes: blob.size,
      };
    } catch (error) {
      if (result.element?.tagName?.toLowerCase() === 'img') {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = result.width;
          canvas.height = result.height;
          const context = canvas.getContext('2d');
          context.drawImage(result.element, 0, 0, result.width, result.height);
          return { dataUrl: canvas.toDataURL('image/png'), mime: 'image/png' };
        } catch {
          // Fall through to the URL fallback below.
        }
      }
      return {
        dataUrl: '',
        url: result.src,
        mime: 'image/png',
        note: `no se pudo leer la imagen: ${error instanceof Error ? error.message : 'error de red'}`,
      };
    }
  }

  async function runPrompt(prompt, options = {}) {
    const adapter = await getAdapter();
    if (running) throw new Error('ya hay un prompt en curso');
    const input = adapter.findPromptInput(document);
    const generate = adapter.findGenerateButton(document);
    if (!input || !generate) {
      throw new Error(
        'no encontré el cuadro de prompt o el botón de generar; revisá que Flow esté en la vista de proyecto',
      );
    }

    running = true;
    try {
      adapter.setPromptValue(input, prompt, window);
      await sleep(250);

      let button = adapter.findGenerateButton(document)?.element ?? null;
      for (let attempt = 0; attempt < 20 && (!button || button.disabled); attempt += 1) {
        await sleep(100);
        button = adapter.findGenerateButton(document)?.element ?? null;
      }
      if (!button || button.disabled) {
        throw new Error('el botón de generar sigue deshabilitado; revisá el prompt y la cuota de Flow');
      }

      const before = adapter.collectResultImages(document, window);
      clickElement(button);

      const fullTimeout = Math.max(30_000, Number(options.timeoutMs) || 180_000);
      let result = null;
      try {
        // Give Flow a short window first. If a confirmation dialog needs a
        // second click (credits, policy), handle it once, then keep waiting.
        result = await adapter.waitForResult(document, window, before, {
          timeoutMs: Math.min(8_000, fullTimeout),
          intervalMs: 500,
        });
      } catch {
        confirmGenerationIfNeeded();
        result = await adapter.waitForResult(document, window, before, {
          timeoutMs: fullTimeout,
          intervalMs: 1_000,
        });
      }

      if (!result) throw new Error('Flow no devolvió una imagen');
      const image = await imageToDataUrl(result);
      return {
        image: {
          ...image,
          src: result.src,
          width: result.width,
          height: result.height,
        },
        prompt,
      };
    } finally {
      running = false;
    }
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case 'FLOWQ_PING': {
        const adapter = await getAdapter();
        return { diagnostics: adapter.diagnostics(document, window) };
      }
      case 'FLOWQ_APPLY_MODEL': {
        return { model: await applyModel(message.model) };
      }
      case 'FLOWQ_APPLY_SETTINGS': {
        return { settings: await applySettings(message.settings ?? {}) };
      }
      case 'FLOWQ_SET_REFERENCES': {
        return { references: await applyReferences(message.images) };
      }
      case 'FLOWQ_RUN_PROMPT': {
        return await runPrompt(String(message.prompt ?? ''), {
          timeoutMs: message.timeoutMs,
        });
      }
      default:
        return null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('FLOWQ_')) {
      return false;
    }
    (async () => {
      try {
        const result = await handleMessage(message);
        sendResponse({ ok: true, ...(result ?? {}) });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'la operación falló sin detalle',
        });
      }
    })();
    return true;
  });
})();
