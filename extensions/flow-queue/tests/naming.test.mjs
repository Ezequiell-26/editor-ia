import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extensionForMime,
  manifestFileName,
  resultFileName,
  runIdFromDate,
  slugify,
} from '../src/lib/naming.js';

test('builds stable zero-padded names so Editor IA can sort the batch', () => {
  assert.equal(
    resultFileName({
      index: 0,
      total: 12,
      prompt: 'Un faro en el acantilado',
      mime: 'image/png',
      runId: '20261019-103000',
    }),
    'flow-queue/20261019-103000/001_un-faro-en-el-acantilado.png',
  );

  assert.equal(
    resultFileName({
      index: 9,
      total: 12,
      prompt: '¿¡Acentos y símbolos!?',
      mime: 'image/jpeg',
      runId: 'run',
    }),
    'flow-queue/run/010_acentos-y-simbolos.jpg',
  );
});

test('slugify is ASCII, bounded and never empty', () => {
  assert.equal(slugify('  Mi Obra: capítulo 1/2  '), 'mi-obra-capitulo-1-2');
  assert.equal(slugify('///'), 'prompt');
  assert.equal(slugify('a'.repeat(200)).length, 60);
});

test('maps mime types and unknown types to png', () => {
  assert.equal(extensionForMime('image/png'), 'png');
  assert.equal(extensionForMime('image/jpeg'), 'jpg');
  assert.equal(extensionForMime('image/webp'), 'webp');
  assert.equal(extensionForMime('application/octet-stream'), 'png');
});

test('run ids and manifest paths are filesystem safe', () => {
  assert.equal(runIdFromDate(new Date(2026, 9, 19, 10, 30, 5)), '20261019-103005');
  assert.equal(manifestFileName('20261019-103005'), 'flow-queue/20261019-103005/manifest.json');
});
