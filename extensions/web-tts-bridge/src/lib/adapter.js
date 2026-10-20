/**
 * Conservative DOM adapter for TTS websites.
 *
 * The adapter never clicks a control it cannot name in Chinese/English and
 * never handles login, payment or CAPTCHA. It returns diagnostics instead of
 * guessing. Tests use jsdom; the content script uses the same functions.
 */

const INPUT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  'input[type="text"]',
  'input:not([type])',
];

const CLICKABLE_SELECTORS = [
  'button',
  '[role="button"]',
  'input[type="submit"]',
  'a[href]',
];

const TEXT_HINT = /(?:文本|文字|输入|内容|台词|配音|语音|朗读|text|content|script|prompt)/i;
const SEARCH_HINT = /(?:搜索|查找|search)/i;
const GENERATE_WORDS =
  /(?:生成|合成|转换|开始|朗读|播放|试听|创建|配音|generate|synthesi[sz]e|convert|speak|start)/i;
const DOWNLOAD_WORDS = /(?:下载|导出|保存|download|export|save)/i;
const FORBIDDEN_WORDS =
  /(?:登录|注册|购买|订阅|升级|充值|支付|login|log in|sign in|sign up|subscribe|buy|purchase|upgrade|pay)/i;
const AUDIO_URL = /(?:\.mp3|\.wav|\.m4a|\.ogg|\.opus|\.aac|\.flac)(?:[?#]|$)/i;

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

export function isVisible(element, window) {
  if (!element || element.nodeType !== 1) return false;
  if (element.hidden || element.disabled) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.closest?.('[hidden]')) return false;
  const view = window ?? element.ownerDocument?.defaultView;
  if (view?.getComputedStyle) {
    const style = view.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity && Number(style.opacity) === 0)
    ) {
      return false;
    }
  }
  return true;
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
    element.getAttribute?.('download')?.trim() ||
    element.textContent?.replace(/\s+/g, ' ').trim() ||
    ''
  );
}

export function findTextInput(document, window) {
  const view = window ?? document.defaultView;
  const candidates = elements(document, INPUT_SELECTORS).filter(
    (element) => isVisible(element, view) && !element.readOnly,
  );
  let best = null;
  let bestScore = -Infinity;
  for (const element of candidates) {
    const hint = accessibleName(element);
    if (SEARCH_HINT.test(hint)) continue;
    const tag = element.tagName?.toLowerCase();
    let score = 0;
    if (TEXT_HINT.test(hint)) score += 5;
    if (tag === 'textarea') score += 3;
    if (element.isContentEditable) score += 3;
    if (tag === 'input') score += 1;
    const rect = element.getBoundingClientRect?.();
    if (rect) score += Math.min(3, Math.log10(Math.max(1, rect.width * rect.height)) / 3);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function setTextValue(element, text, window) {
  const view = window ?? element.ownerDocument?.defaultView;
  if (!element) return false;
  if (element.isContentEditable) {
    element.focus?.();
    element.textContent = text;
  } else {
    const prototype =
      element.tagName?.toLowerCase() === 'textarea'
        ? view?.HTMLTextAreaElement?.prototype
        : view?.HTMLInputElement?.prototype;
    const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;
    if (setter) setter.call(element, text);
    else element.value = text;
  }
  element.dispatchEvent?.(new view.Event('input', { bubbles: true }));
  element.dispatchEvent?.(new view.Event('change', { bubbles: true }));
  return true;
}

export function findGenerateButton(document, window) {
  const view = window ?? document.defaultView;
  const candidates = elements(document, CLICKABLE_SELECTORS).filter(
    (element) => isVisible(element, view) && !element.disabled,
  );
  let best = null;
  let bestScore = -1;
  for (const element of candidates) {
    const label = accessibleName(element);
    if (!label || FORBIDDEN_WORDS.test(label)) continue;
    if (DOWNLOAD_WORDS.test(label)) continue;
    if (/(?:视频|图片|video|image)/i.test(label) && !/(?:语音|配音|speech|voice|audio)/i.test(label)) {
      continue;
    }
    if (!GENERATE_WORDS.test(label)) continue;
    let score = 1;
    if (/^(?:生成|合成|转换|开始|朗读|generate|synthesi[sz]e|convert|speak)$/i.test(label)) {
      score += 3;
    }
    if (label.length <= 24) score += 1;
    if (score > bestScore) {
      best = { element, label };
      bestScore = score;
    }
  }
  return best;
}

export function findDownloadControl(document, window) {
  const view = window ?? document.defaultView;
  const candidates = elements(document, ['a[download]', ...CLICKABLE_SELECTORS]).filter(
    (element) => isVisible(element, view) && !element.disabled,
  );
  for (const element of candidates) {
    const label = accessibleName(element);
    if (FORBIDDEN_WORDS.test(label)) continue;
    const href = element.getAttribute?.('href') ?? '';
    if (element.hasAttribute?.('download') || AUDIO_URL.test(href) || DOWNLOAD_WORDS.test(label)) {
      return { element, label };
    }
  }
  return null;
}

export function findAudioSource(document, window) {
  const view = window ?? document.defaultView;
  for (const audio of document.querySelectorAll('audio')) {
    if (!isVisible(audio, view)) continue;
    const source =
      audio.getAttribute('src') ||
      audio.querySelector('source[src]')?.getAttribute('src') ||
      '';
    if (source.trim()) return { url: source.trim(), element: audio };
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (AUDIO_URL.test(href) && isVisible(anchor, view)) {
      return { url: href, element: anchor };
    }
  }
  return null;
}

export function findPageBlock(document, window) {
  const view = window ?? document.defaultView;
  for (const frame of document.querySelectorAll('iframe')) {
    if (!isVisible(frame, view)) continue;
    const signature = `${frame.getAttribute('src') ?? ''} ${frame.getAttribute('title') ?? ''}`;
    if (/(?:captcha|recaptcha|hcaptcha|turnstile|验证)/i.test(signature)) {
      return { kind: 'captcha', detail: 'hay un desafío de verificación visible' };
    }
  }
  const text = (document.body?.innerText ?? document.body?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 20_000);
  if (/(?:验证码|人机验证|滑动验证|点击验证)/i.test(text)) {
    return { kind: 'captcha', detail: 'la página pide una verificación' };
  }
  if (/(?:请先登录|登录后继续|登录后使用|请登录后|sign in to continue|log in to continue)/i.test(text)) {
    return { kind: 'login', detail: 'la página pide iniciar sesión' };
  }
  return null;
}

export async function waitForAudio(document, window, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 700;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const started = now();
  while (now() - started < timeoutMs) {
    const block = findPageBlock(document, window);
    if (block) return { block };
    const audio = findAudioSource(document, window);
    if (audio) return { audio };
    await sleep(intervalMs);
  }
  return { timeout: true };
}

export function slugify(value, max = 40) {
  const clean = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return clean || 'audio';
}

export function timestampName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
