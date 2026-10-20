import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManifest } from '../src/lib/manifest.js';

test('maps every prompt to its downloaded file and keeps missing ones visible', () => {
  const manifest = buildManifest({
    runId: '20261019-103000',
    createdAt: '2026-10-19T10:30:05.000Z',
    model: 'Nano Banana 2',
    referenceUse: 'style',
    references: [{ name: 'ref.png', type: 'image/png', bytes: 1234, dataUrl: 'data:image/png;base64,AAAA' }],
    settings: { delaySeconds: 5, timeoutSeconds: 180, continueOnError: false },
    status: 'completed-with-errors',
    prompts: ['faro', 'bosque'],
    results: [
      {
        index: 0,
        prompt: 'faro',
        filename: 'flow-queue/20261019-103000/001_faro.png',
        mime: 'image/png',
        bytes: 100,
      },
    ],
  });

  assert.equal(manifest.format, 'editor-ia.flow-queue');
  assert.equal(manifest.prompts[0]?.status, 'downloaded');
  assert.equal(manifest.prompts[0]?.file, 'flow-queue/20261019-103000/001_faro.png');
  assert.equal(manifest.prompts[1]?.status, 'missing');
  assert.equal(manifest.prompts[1]?.file, null);
  assert.equal(manifest.references[0]?.name, 'ref.png');
  assert.equal(JSON.stringify(manifest).includes('data:image'), false);
  assert.match(manifest.editorIa.import, /Auto-montar lote/);
});
