/**
 * DOM adapter for Google Flow.
 *
 * Flow can change its markup at any time, so the adapter follows several
 * conservative heuristics and never clicks a control it cannot name. When a
 * required control is missing, the caller gets a diagnostic instead of a
 * random click. The functions are pure enough to be tested with jsdom.
 */

const PROMPT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
];

const CLICKABLE_SELECTORS = [
  'button',
  '[role="button"]',
  'input[type="submit"]',
];

const MODEL_SELECTORS = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  'li',
];

const CREATE_WORDS = /(?:crear|create|prompt|describe|describ)/i;
const GENERATE_WORDS = /(?:generar|generate|crear|create|enviar|send|submit|ejecutar|run)/i;
const EXCLUDED_BUTTON_WORDS = /(?:modelo|model|nano|banana|referencia|reference|añadir|anadir|add|upload|subir|ajustes|settings|menú|menu)/i;

function elements(document, selectors) {
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!seen.has(element)) {
        seen.add(element);
        out.push(element);
      }
    }
  }
  return out;
}

export function accessibleName(element) {
  if (!element) return '';
  const document = element.ownerDocument;
  const labelledBy = element.getAttribute?.('aria-labelledby');
  if (labelledBy && document) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return (
    element.getAttribute?.('aria-label')?.trim() ||
    element.getAttribute?.('title')?.trim() ||
    element.getAttribute?.('placeholder')?.trim() ||
    element.getAttribute?.('alt')?.trim() ||
    element.textContent?.replace(/\s+/g, ' ').trim() ||
    ''
  );
}

export function isVisible(element, window, options = {}) {
  if (!element || element.nodeType !== 1) return false;
  if (element.hidden) return false;
  if (element.disabled && !options.allowDisabled) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.closest?.('[hidden]')) return false;
  const view = window ?? element.ownerDocument?.defaultView;
  if (view?.getComputedStyle) {
    const style = view.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    ) {
      return false;
    }
  }
  return true;
}

function rectOf(element) {
  try {
    return element.getBoundingClientRect?.() ?? { width: 0, height: 0, top: 0, left: 0 };
  } catch {
    return { width: 0, height: 0, top: 0, left: 0 };
  }
}

export function findPromptInput(document) {
  let best = null;
  let bestScore = -Infinity;
  for (const element of elements(document, PROMPT_SELECTORS)) {
    if (!isVisible(element, document.defaultView)) continue;
    if (element.disabled || element.readOnly) continue;
    const name = accessibleName(element);
    const tag = element.tagName?.toLowerCase() ?? '';
    let score = 0;
    if (CREATE_WORDS.test(name)) score += 100;
    if (tag === 'textarea') score += 30;
    if (tag === 'input') score += 10;
    if (element.getAttribute?.('contenteditable') === 'true') score += 20;
    if (element.getAttribute?.('role') === 'textbox') score += 15;
    if (score === 0) score += 5;
    const rect = rectOf(element);
    score += Math.min(20, Math.max(0, rect.top) / 100);
    if (score >= bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function findGenerateButton(document) {
  let best = null;
  let bestScore = -Infinity;
  for (const element of elements(document, CLICKABLE_SELECTORS)) {
    if (!isVisible(element, document.defaultView, { allowDisabled: true })) continue;
    const name = accessibleName(element);
    if (!name || EXCLUDED_BUTTON_WORDS.test(name)) continue;
    let score = 0;
    if (/(?:generar|generate|generación|generacion|iniciar|start)/i.test(name)) score += 100;
    else if (/(?:crear|create)/i.test(name)) score += 80;
    else if (/(?:enviar|send|submit)/i.test(name)) score += 60;
    else if (element.getAttribute?.('type') === 'submit') score += 40;
    if (score === 0) continue;
    if (/(?:imagen|image|foto|photo|ilustración|illustration)/i.test(name)) score += 15;
    if (/(?:video|vídeo|clip)/i.test(name)) score -= 10;
    if (element.getAttribute?.('type') === 'submit') score += 5;
    if (score >= bestScore) {
      best = { element, score, name };
      bestScore = score;
    }
  }
  return best;
}

export function findFileInput(document) {
  let best = null;
  let bestScore = -Infinity;
  for (const element of document.querySelectorAll('input[type="file"]')) {
    const accept = (element.getAttribute('accept') ?? '').toLowerCase();
    let score = 0;
    if (accept.includes('image')) score += 50;
    if (/(?:png|jpe?g|webp)/.test(accept)) score += 20;
    if (!accept) score += 10;
    if (accept.includes('txt') || accept.includes('text/plain')) score -= 100;
    if (score >= bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function findModelCandidates(document, model) {
  const wanted = String(model ?? '').trim().toLocaleLowerCase('es');
  if (!wanted) return [];
  return elements(document, MODEL_SELECTORS).filter((element) => {
    if (!isVisible(element, document.defaultView)) return false;
    const haystack = `${accessibleName(element)} ${element.textContent ?? ''}`.toLocaleLowerCase('es');
    return haystack.includes(wanted);
  });
}

/** The settings button in Flow hides the model name in a child, not in its
 * accessible name ("Botón de configuración"). This finds it by its visible
 * model/fomat text while still requiring a clickable control. */
export function findSettingsButton(document) {
  const explicit = document.querySelector('[aria-label="Botón de configuración"]');
  if (explicit && isVisible(explicit, document.defaultView)) return explicit;
  return (
    elements(document, CLICKABLE_SELECTORS).find((element) => {
      if (!isVisible(element, document.defaultView)) return false;
      const text = `${element.textContent ?? ''} ${accessibleName(element)}`;
      return /nano banana|crop_\d|x[1-4]/i.test(text);
    }) ?? null
  );
}

/** Find a visible radio/menu option by its exact or contained label. */
export function findOptionByText(document, text) {
  const wanted = String(text ?? '').trim().toLocaleLowerCase('es');
  if (!wanted) return null;
  const candidates = elements(document, [
    '[role="radio"]',
    '[role="menuitem"]',
    '[role="option"]',
    'button',
    'mat-button-toggle',
  ]);
  return (
    candidates.find((element) => {
      if (!isVisible(element, document.defaultView)) return false;
      const haystack = `${accessibleName(element)} ${element.textContent ?? ''}`
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('es');
      return haystack === wanted || haystack.includes(wanted);
    }) ?? null
  );
}

export function setPromptValue(element, value, window) {
  if (!element) return false;
  const text = String(value ?? '');
  const tag = element.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'input') {
    const prototype =
      tag === 'textarea'
        ? window?.HTMLTextAreaElement?.prototype
        : window?.HTMLInputElement?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'value')
      : undefined;
    if (descriptor?.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }
  } else {
    try {
      element.focus?.();
    } catch {
      // A detached node cannot be focused; setting the text still works.
    }
    const document = element.ownerDocument;
    const selection = window?.getSelection?.() ?? document?.getSelection?.();
    const range = document?.createRange?.();
    if (selection && range) {
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    if (document?.execCommand) {
      try {
        inserted = document.execCommand('insertText', false, text) === true;
      } catch {
        inserted = false;
      }
    }
    if (!inserted || element.textContent !== text) {
      element.textContent = text;
    }
  }

  const view = window ?? element.ownerDocument?.defaultView;
  const InputEventCtor = view?.InputEvent ?? view?.Event;
  const event = InputEventCtor
    ? new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text })
    : null;
  if (event) element.dispatchEvent(event);
  const change = view?.Event ? new view.Event('change', { bubbles: true }) : null;
  if (change) element.dispatchEvent(change);
  return true;
}

export function collectResultImages(document, window) {
  const view = window ?? document.defaultView;
  const candidates = new Set(document.querySelectorAll('img, [style*="background-image"]'));
  const out = [];
  for (const element of candidates) {
    let src = '';
    let width = 0;
    let height = 0;
    if (element.tagName?.toLowerCase() === 'img') {
      src = element.currentSrc || element.getAttribute('src') || element.getAttribute('poster') || '';
      width = Number(element.naturalWidth) || rectOf(element).width || Number(element.getAttribute('width')) || 0;
      height = Number(element.naturalHeight) || rectOf(element).height || Number(element.getAttribute('height')) || 0;
    } else {
      const inline = element.style?.backgroundImage ?? '';
      const computed = view?.getComputedStyle ? view.getComputedStyle(element).backgroundImage : '';
      const match = /url\((['"]?)(.*?)\1\)/i.exec(inline || computed);
      src = match?.[2] ?? '';
      const rect = rectOf(element);
      width = rect.width;
      height = rect.height;
    }
    if (!src || /^data:image\/svg/i.test(src)) continue;
    if (width < 64 || height < 64) continue;
    out.push({ element, src, width, height });
  }
  return out;
}

export function diagnostics(document, window) {
  const prompt = findPromptInput(document);
  const generate = findGenerateButton(document);
  const fileInput = findFileInput(document);
  const settings = findSettingsButton(document);
  const images = collectResultImages(document, window);
  return {
    url: document.location?.href ?? '',
    title: document.title ?? '',
    hasPrompt: Boolean(prompt),
    promptLabel: prompt ? accessibleName(prompt) : null,
    hasGenerate: Boolean(generate),
    generateLabel: generate?.name ?? null,
    hasSettings: Boolean(settings),
    settingsLabel: settings ? (settings.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    hasImageInput: Boolean(fileInput),
    imageInputAccept: fileInput?.getAttribute('accept') ?? null,
    resultImages: images.length,
    ready: Boolean(prompt && generate),
  };
}

/** Flow shows a short percentage while a result is still a placeholder. */
export function hasVisibleProgress(document, window) {
  for (const element of document.querySelectorAll('[role="progressbar"], [aria-valuenow]')) {
    if (isVisible(element, window)) return true;
  }
  for (const element of document.querySelectorAll('span, div, p')) {
    const text = element.textContent?.trim();
    if (text && text.length <= 5 && /^\d{1,3}%$/.test(text) && isVisible(element, window)) {
      return true;
    }
  }
  return false;
}

/** Wait until the page yields a stable result image that was not present before. */
export async function waitForResult(document, window, before, options = {}) {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 180_000);
  const intervalMs = Math.max(100, options.intervalMs ?? 1_000);
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseline = new Map(before.map((item) => [item.element, item.src]));
  const stable = new Map();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (hasVisibleProgress(document, window)) {
      stable.clear();
      await sleep(intervalMs);
      continue;
    }
    const current = collectResultImages(document, window);
    const fresh = current.filter(
      (item) => !baseline.has(item.element) || baseline.get(item.element) !== item.src,
    );
    const freshElements = new Set(fresh.map((item) => item.element));
    for (const element of stable.keys()) {
      if (!freshElements.has(element)) stable.delete(element);
    }
    for (const item of fresh) {
      const count = (stable.get(item.element) ?? 0) + 1;
      stable.set(item.element, count);
      if (count >= 2) {
        return item;
      }
    }
    await sleep(intervalMs);
  }
  throw new Error('Flow no mostró una imagen nueva dentro del tiempo configurado');
}
