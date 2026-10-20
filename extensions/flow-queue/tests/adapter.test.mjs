import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  accessibleName,
  collectResultImages,
  findFileInput,
  findGenerateButton,
  findModelCandidates,
  findOptionByText,
  findPromptInput,
  findSettingsButton,
  hasVisibleProgress,
  isVisible,
  setPromptValue,
  waitForResult,
} from '../src/lib/adapter.js';

function setup(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
    url: 'https://flow.google.com/project/demo',
  });
  return { document: dom.window.document, window: dom.window };
}

test('finds the Flow prompt textarea and prefers the visible one', () => {
  const { document } = setup(`
    <textarea id="hidden" style="display:none"></textarea>
    <textarea id="prompt" placeholder="¿Qué quieres crear?"></textarea>
    <div contenteditable="true" role="textbox">otro</div>
  `);

  assert.equal(findPromptInput(document)?.id, 'prompt');
});

test('falls back to a contenteditable textbox when Flow changes the markup', () => {
  const { document } = setup(`
    <div contenteditable="true" role="textbox" aria-label="Prompt"></div>
  `);

  assert.equal(findPromptInput(document)?.getAttribute('role'), 'textbox');
});

test('finds the generate button and ignores model and reference controls', () => {
  const { document } = setup(`
    <button>Modelo Nano Banana 2</button>
    <button>Añadir imágenes</button>
    <button aria-label="Generar imagen">→</button>
    <button>Generar video</button>
  `);

  const found = findGenerateButton(document);
  assert.equal(found?.element.getAttribute('aria-label'), 'Generar imagen');
});

test('recognizes English Flow labels', () => {
  const { document } = setup(`
    <button>Add images</button>
    <button>Generate</button>
  `);

  assert.equal(findGenerateButton(document)?.element.textContent, 'Generate');
});

test('finds the disabled Flow generation button and matches "generación"', () => {
  const { document } = setup(`
    <button aria-label="Iniciar generación" disabled>arrow_forward</button>
  `);

  const found = findGenerateButton(document);
  assert.equal(found?.element.getAttribute('aria-label'), 'Iniciar generación');
  assert.equal(found?.element.disabled, true);
});

test('finds the settings button and its hidden model text', () => {
  const { document } = setup(`
    <button aria-label="Botón de configuración">
      <span>🍌 Nano Banana 2.1</span><span>crop_16_9</span><span>x2</span>
    </button>
    <div role="radio" aria-checked="true">16:9</div>
    <div role="radio" aria-checked="false">9:16</div>
    <div role="menuitem">🍌 Nano Banana Pro</div>
  `);

  assert.equal(findSettingsButton(document)?.getAttribute('aria-label'), 'Botón de configuración');
  const candidates = findModelCandidates(document, 'Nano Banana 2.1');
  assert.equal(candidates.length, 1);
  assert.equal(findOptionByText(document, '9:16')?.textContent, '9:16');
  assert.equal(findOptionByText(document, 'Nano Banana Pro')?.textContent?.trim(), '🍌 Nano Banana Pro');
});

test('finds the image file input and the model menu candidates', () => {
  const { document } = setup(`
    <input type="file" accept=".txt" />
    <input id="images" type="file" accept="image/png,image/jpeg,image/webp" />
    <button aria-haspopup="menu">Nano Banana 2</button>
    <div role="menuitem">Nano Banana 2</div>
    <div role="menuitem">Imagen 4</div>
  `);

  assert.equal(findFileInput(document)?.id, 'images');
  const candidates = findModelCandidates(document, 'Nano Banana 2');
  assert.equal(candidates.length, 2);
  assert.equal(accessibleName(candidates[0]), 'Nano Banana 2');
});

test('sets a textarea value through the native setter and emits input', () => {
  const { document, window } = setup('<textarea id="prompt"></textarea>');
  const input = document.querySelector('#prompt');
  let events = 0;
  input.addEventListener('input', () => {
    events += 1;
  });

  assert.equal(setPromptValue(input, 'Un faro al atardecer', window), true);
  assert.equal(input.value, 'Un faro al atardecer');
  assert.equal(events, 1);
});

test('sets a contenteditable value without leaving stale text', () => {
  const { document, window } = setup(
    '<div id="prompt" contenteditable="true" role="textbox">texto viejo</div>',
  );
  const input = document.querySelector('#prompt');

  assert.equal(setPromptValue(input, 'texto nuevo', window), true);
  assert.equal(input.textContent, 'texto nuevo');
});

test('collects only plausible result images, not toolbar icons', () => {
  const { document, window } = setup(`
    <img id="icon" src="icon.png" width="16" height="16" />
    <img id="result" src="https://lh3.googleusercontent.com/result=s2048" width="512" height="512" />
    <div id="bg" style="background-image:url('https://lh3.googleusercontent.com/bg=s2048')"></div>
  `);
  const result = document.querySelector('#result');
  Object.defineProperty(result, 'naturalWidth', { value: 512, configurable: true });
  Object.defineProperty(result, 'naturalHeight', { value: 512, configurable: true });
  const bg = document.querySelector('#bg');
  bg.getBoundingClientRect = () => ({ width: 512, height: 512, top: 0, left: 0, right: 512, bottom: 512 });
  document.querySelector('#icon').getBoundingClientRect = () => ({ width: 16, height: 16, top: 0, left: 0, right: 16, bottom: 16 });

  const found = collectResultImages(document, window);
  assert.equal(found.length, 2);
  assert.ok(found.some((item) => item.element.id === 'result'));
  assert.ok(found.some((item) => item.element.id === 'bg'));
});

test('isVisible rejects hidden and disabled controls', () => {
  const { document, window } = setup(`
    <button id="a" style="display:none">Generar</button>
    <button id="b" disabled>Generar</button>
    <button id="c">Generar</button>
  `);

  assert.equal(isVisible(document.querySelector('#a'), window), false);
  assert.equal(isVisible(document.querySelector('#b'), window), false);
  assert.equal(isVisible(document.querySelector('#c'), window), true);
});


test('detects a visible percentage or progressbar while Flow is rendering', () => {
  const first = setup('<span>37%</span>');
  assert.equal(hasVisibleProgress(first.document, first.window), true);
  const second = setup('<div role="progressbar"></div>');
  assert.equal(hasVisibleProgress(second.document, second.window), true);
  const third = setup('<span>Listo</span>');
  assert.equal(hasVisibleProgress(third.document, third.window), false);
  const fourth = setup('<span>100% completado</span>');
  assert.equal(hasVisibleProgress(fourth.document, fourth.window), false);
});

test('does not accept a result until the progress indicator disappears', async () => {
  const { document, window } = setup(`
    <span id="progress">37%</span>
    <img id="result" src="https://lh3.googleusercontent.com/result=s2048" width="512" height="512" />
  `);
  const image = document.querySelector('#result');
  Object.defineProperty(image, 'naturalWidth', { value: 512, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 512, configurable: true });
  let sleeps = 0;
  const sleep = async () => {
    sleeps += 1;
    document.querySelector('#progress')?.remove();
  };
  const result = await waitForResult(document, window, [], {
    timeoutMs: 2_000,
    intervalMs: 1,
    sleep,
  });
  assert.equal(result.element.id, 'result');
  assert.ok(sleeps >= 2);
});
