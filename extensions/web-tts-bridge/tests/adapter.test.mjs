import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  findAudioSource,
  findDownloadControl,
  findGenerateButton,
  findPageBlock,
  findTextInput,
  setTextValue,
  slugify,
  timestampName,
  waitForAudio,
} from '../src/lib/adapter.js';

function setup(html, url = 'https://voice.example.com/tts') {
  const dom = new JSDOM(`<!doctype html><html><head><title>Voz</title></head><body>${html}</body></html>`, {
    pretendToBeVisual: true,
    url,
  });
  return { document: dom.window.document, window: dom.window };
}

test('encuentra el cuadro de texto chino y evita el buscador', () => {
  const { document, window } = setup(`
    <input type="search" placeholder="搜索" />
    <textarea id="search" placeholder="搜索文本"></textarea>
    <textarea id="tts" placeholder="请输入要转换的文本"></textarea>
  `);
  assert.equal(findTextInput(document, window)?.id, 'tts');
});

test('escribe el texto y dispara input/change', () => {
  const { document, window } = setup(`<textarea id="tts"></textarea>`);
  const input = document.querySelector('#tts');
  let inputEvents = 0;
  let changeEvents = 0;
  input.addEventListener('input', () => (inputEvents += 1));
  input.addEventListener('change', () => (changeEvents += 1));
  setTextValue(input, 'Hola mundo', window);
  assert.equal(input.value, 'Hola mundo');
  assert.equal(inputEvents, 1);
  assert.equal(changeEvents, 1);
});

test('elige el botón generar chino e ignora login, descarga y video', () => {
  const { document, window } = setup(`
    <button>登录</button>
    <button>生成视频</button>
    <button>下载</button>
    <button id="go">生成语音</button>
  `);
  assert.equal(findGenerateButton(document, window)?.element.id, 'go');
});

test('encuentra el botón o enlace de descarga', () => {
  const { document, window } = setup(`
    <a id="dl" href="/audio/demo.mp3" download>下载音频</a>
  `);
  assert.equal(findDownloadControl(document, window)?.element.id, 'dl');
});

test('detecta audio y resuelve el elemento', () => {
  const { document, window } = setup(`
    <audio src="/media/result.mp3" controls></audio>
  `);
  assert.equal(findAudioSource(document, window)?.url, '/media/result.mp3');
});

test('detecta login y captcha sin intentar evadirlos', () => {
  const login = setup(`<div>请先登录后继续</div>`);
  assert.equal(findPageBlock(login.document, login.window)?.kind, 'login');
  const captcha = setup(`<iframe title="captcha" src="https://captcha.example/frame"></iframe>`);
  assert.equal(findPageBlock(captcha.document, captcha.window)?.kind, 'captcha');
});

test('waitForAudio devuelve el audio inmediato y el bloqueo', async () => {
  const audio = setup(`<audio src="/a.mp3"></audio>`);
  const result = await waitForAudio(audio.document, audio.window, { timeoutMs: 10 });
  assert.equal(result.audio?.url, '/a.mp3');

  const blocked = setup(`<div>验证码</div>`);
  const blockedResult = await waitForAudio(blocked.document, blocked.window, { timeoutMs: 10 });
  assert.equal(blockedResult.block?.kind, 'captcha');
});

test('slug y timestamp son seguros para nombres de archivo', () => {
  assert.equal(slugify('Voz en Español / Prueba'), 'voz-en-espanol-prueba');
  assert.match(timestampName(new Date(2026, 9, 19, 7, 5, 9)), /^20261019-070509$/);
});
